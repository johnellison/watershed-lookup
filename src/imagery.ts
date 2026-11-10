// Earth imagery: EOX Sentinel-2 cloudless 2016 (CC BY 4.0), Web Mercator tiles.
// Only the 2016 (and 2017) layers are CC BY 4.0; later years are CC BY-NC-SA 4.0.

export const EOX_2016_TILE = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
export const GIBS_FALLBACK_TILE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-08/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';

export interface MosaicPlan {
  zoom: number;
  size: number;
  /** Tiles to fetch and where to draw them on a canvas of size x size. */
  tiles: { x: number; y: number; left: number; top: number }[];
  /** Ground meters per pixel at this latitude. */
  metersPerPixel: number;
}

/** Plan a size x size pixel window centered exactly on (lat, lon). */
export function planMosaic(lat: number, lon: number, zoom = 12, size = 768): MosaicPlan {
  const n = 2 ** zoom;
  const latR = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const gx = ((lon + 180) / 360) * n * 256;
  const gy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * 256;
  const left = gx - size / 2;
  const top = gy - size / 2;
  const tiles: MosaicPlan['tiles'] = [];
  for (let ty = Math.floor(top / 256); ty * 256 < top + size; ty++) {
    for (let tx = Math.floor(left / 256); tx * 256 < left + size; tx++) {
      if (ty < 0 || ty >= n) continue;
      tiles.push({ x: ((tx % n) + n) % n, y: ty, left: Math.round(tx * 256 - left), top: Math.round(ty * 256 - top) });
    }
  }
  const metersPerPixel = (156543.03392 * Math.cos(latR)) / n;
  return { zoom, size, tiles, metersPerPixel };
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/**
 * Fetch the tiles and composite them into one WebP with sharp (optional dependency).
 * Fetch server-side and cache the output: do not hotlink EOX from every browser.
 */
export async function renderMosaic(
  lat: number,
  lon: number,
  opts: { userAgent: string; zoom?: number; size?: number; fetchInit?: RequestInit },
): Promise<{ image: Buffer; source: 'eox-s2cloudless-2016' | 'nasa-gibs-blue-marble' }> {
  const sharp = (await import('sharp')).default;
  const attempt = async (template: string, zoom: number) => {
    const plan = planMosaic(lat, lon, zoom, opts.size ?? 768);
    const layers = await Promise.all(
      plan.tiles.map(async (t) => {
        const res = await fetch(tileUrl(template, plan.zoom, t.x, t.y), {
          ...opts.fetchInit,
          headers: { 'User-Agent': opts.userAgent },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1500) throw new Error('empty tile');
        return { input: buf, left: t.left, top: t.top };
      }),
    );
    // sharp cannot composite at negative offsets; pad the canvas and crop back.
    const pad = 256;
    const canvas = sharp({
      create: { width: plan.size + pad * 2, height: plan.size + pad * 2, channels: 3, background: '#0b0f0e' },
    }).composite(layers.map((l) => ({ ...l, left: l.left + pad, top: l.top + pad })));
    const raw = await canvas.png().toBuffer();
    return sharp(raw).extract({ left: pad, top: pad, width: plan.size, height: plan.size }).webp({ quality: 78 }).toBuffer();
  };
  try {
    return { image: await attempt(EOX_2016_TILE, opts.zoom ?? 12), source: 'eox-s2cloudless-2016' };
  } catch {
    return { image: await attempt(GIBS_FALLBACK_TILE, 8), source: 'nasa-gibs-blue-marble' };
  }
}
