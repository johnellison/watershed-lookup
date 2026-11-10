// Nearest named waterway from OpenStreetMap (Overpass API). HydroBASINS polygons carry
// no names, so this is how the local basin gets a human name. Public Overpass servers
// are slow and intermittent (in November 2026 often 10 to 20 seconds, or no answer):
// call this off the critical path, cache results, and treat failure as "unnamed".
// For production volume, run your own Overpass instance and pass it in `endpoints`.

export interface Waterway {
  name: string;
  kind: string;
  distanceKm: number;
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/**
 * Ask the public Overpass servers one after another, starting the next one if the
 * previous has not answered within `staggerMs`, and return the first good answer.
 */
export async function nearestWaterways(
  lat: number,
  lon: number,
  opts: { userAgent: string; radiusM?: number; timeoutMs?: number; staggerMs?: number; fetchInit?: RequestInit; endpoints?: string[] },
): Promise<Waterway[]> {
  const r = opts.radiusM ?? 4000;
  const q = `[out:json][timeout:8];way(around:${r},${lat.toFixed(4)},${lon.toFixed(4)})[waterway~"^(river|stream|canal)$"][name];out tags geom qt;`;
  const endpoints = opts.endpoints ?? ENDPOINTS;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 20000);
  const controllers: AbortController[] = [];

  const ask = async (ep: string, delayMs: number): Promise<Waterway[]> => {
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    if (deadline.aborted) throw new Error('deadline');
    const c = new AbortController();
    controllers.push(c);
    // POST: some public instances only serve GET from a cache layer that times out.
    const res = await fetch(ep, {
      ...opts.fetchInit,
      method: 'POST',
      body: new URLSearchParams({ data: q }),
      headers: { 'User-Agent': opts.userAgent, Accept: 'application/json' },
      signal: AbortSignal.any([c.signal, deadline]),
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const body = (await res.json()) as {
      elements?: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[];
    };
    if (!Array.isArray(body.elements)) throw new Error('Overpass returned no elements');
    const best = new Map<string, Waterway>();
    for (const el of body.elements) {
      const name = el.tags?.name ?? el.tags?.['name:en'];
      if (!name || !el.geometry?.length) continue;
      const d = distanceToLineKm(lat, lon, el.geometry);
      const prev = best.get(name);
      if (!prev || d < prev.distanceKm) best.set(name, { name, kind: el.tags?.waterway ?? 'waterway', distanceKm: d });
    }
    return [...best.values()].sort((a, b) => a.distanceKm - b.distanceKm);
  };

  try {
    return await Promise.any(endpoints.map((ep, i) => ask(ep, i * (opts.staggerMs ?? 1500))));
  } catch {
    throw new Error('Overpass unavailable');
  } finally {
    for (const c of controllers) c.abort();
  }
}

function distanceToLineKm(lat: number, lon: number, pts: { lat: number; lon: number }[]): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const ax = (pts[i].lon - lon) * kx, ay = (pts[i].lat - lat) * ky;
    if (i === 0) {
      best = Math.min(best, Math.hypot(ax, ay));
      continue;
    }
    const bx = (pts[i - 1].lon - lon) * kx, by = (pts[i - 1].lat - lat) * ky;
    const dx = ax - bx, dy = ay - by;
    let t = dx === 0 && dy === 0 ? 0 : (-bx * dx - by * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(bx + t * dx, by + t * dy));
  }
  return best;
}
