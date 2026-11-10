// Fallback geocoder: OpenStreetMap Nominatim, used only when GeoNames has no match.
// Follows https://operations.osmfoundation.org/policies/nominatim/ : a descriptive
// User-Agent, at most one request per second from this process, and results cached.
import { normalizePostal } from './postal.js';

export interface NominatimMatch {
  lat: number;
  lon: number;
  label: string;
}

let nextSlot = 0;
async function waitForSlot(minGapMs: number, maxWaitMs: number): Promise<boolean> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  if (slot - now > maxWaitMs) return false;
  nextSlot = slot + minGapMs;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  return true;
}

const cache = new Map<string, NominatimMatch | null>();

export async function nominatimPostal(
  country: string,
  code: string,
  opts: { userAgent: string; timeoutMs?: number; fetchInit?: RequestInit },
): Promise<NominatimMatch | null> {
  const key = `${country}:${normalizePostal(code)}`;
  if (cache.has(key)) return cache.get(key)!;
  if (!(await waitForSlot(1100, 4000))) throw new Error('Geocoder is busy, try again in a moment');
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('postalcode', code.trim());
  url.searchParams.set('countrycodes', country.toLowerCase());
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');
  const res = await fetch(url, {
    ...opts.fetchInit,
    headers: { 'User-Agent': opts.userAgent, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    address?: { postcode?: string };
  }>;
  const row = rows[0];
  // Nominatim can return a fuzzy match; accept it only if the postcode really matches.
  const ok = row && row.address?.postcode && normalizePostal(row.address.postcode).startsWith(normalizePostal(code));
  const match = ok ? { lat: Number(row.lat), lon: Number(row.lon), label: row.display_name } : null;
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  cache.set(key, match);
  return match;
}
