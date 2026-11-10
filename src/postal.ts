// Offline postal-code geocoding from the GeoNames postal dataset (CC BY 4.0).
// The build step writes one gzipped JSON object per country:
//   { "<NORMALIZED CODE>": [lat, lon, placeName, admin2, admin1, placeCount] }

export type PostalRow = [number, number, string, string, string, number];
export type PostalTable = Record<string, PostalRow>;

export interface PostalMatch {
  lat: number;
  lon: number;
  place: string;
  admin2: string;
  admin1: string;
  /** How many GeoNames places share this code. */
  places: number;
  /** The key that matched, which can be a prefix for countries GeoNames stores partially. */
  matched: string;
  partial: boolean;
}

export function normalizePostal(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export function isPlausiblePostal(code: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(code.trim());
}

/**
 * GeoNames stores only part of the code for some countries (see its readme), so a
 * full code is reduced to the stored part before giving up.
 */
const PARTIAL: Record<string, (k: string) => string[]> = {
  GB: (k) => (k.length >= 5 ? [k.slice(0, -3)] : []),
  CA: (k) => [k.slice(0, 3)],
  NL: (k) => [k.slice(0, 4)],
  IE: (k) => [k.slice(0, 3)],
  MT: (k) => [k.slice(0, 3)],
  AR: (k) => [k.slice(0, 5), k.replace(/^[A-Z]/, '').slice(0, 4)],
  CL: (k) => [k.slice(0, 3)],
  BR: (k) => [k.slice(0, 5) + '000', k.slice(0, 5)],
};

export function matchPostal(table: PostalTable, country: string, code: string): PostalMatch | null {
  const key = normalizePostal(code);
  const tries = [key, ...(PARTIAL[country]?.(key) ?? [])].filter((k, i, a) => k && a.indexOf(k) === i);
  for (const k of tries) {
    const row = table[k];
    if (!row) continue;
    const [lat, lon, place, admin2, admin1, places] = row;
    return { lat, lon, place, admin2, admin1, places, matched: k, partial: k !== key };
  }
  return null;
}
