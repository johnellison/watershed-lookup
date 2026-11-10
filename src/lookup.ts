// The whole lookup: postal code -> place -> watershed, ecoregion, first stewards link
// and imagery plan. Each part fails on its own, so one outage never blanks the result.
import { WslLayer } from './layer.js';
import { isPlausiblePostal, matchPostal, normalizePostal, type PostalTable } from './postal.js';
import { nominatimPostal } from './nominatim.js';
import { nearestWaterways, type Waterway } from './waterways.js';
import { nativeLandMapUrl, NATIVE_LAND_CAVEAT } from './nativeland.js';

export const LAYERS = ['hybas05', 'hybas08', 'grdc', 'rivers', 'resolve', 'land', 'islands'] as const;
export type LayerName = (typeof LAYERS)[number];

/** GeoNames admin2 values that read as wrong to locals (e.g. 10115 Berlin-Mitte lists Schöneberg). */
const ADMIN2_UNRELIABLE = new Set(['DE']);

/** Landmasses smaller than this count as islands (Greenland is about 2.1 million km²). */
const ISLAND_MAX_KM2 = 2_500_000;

export interface LookupOptions {
  /** Return the raw bytes of a built layer file (e.g. readFileSync of `${name}.wsl`). */
  loadLayer: (name: LayerName) => Promise<Uint8Array> | Uint8Array;
  /** Return the parsed postal table for an ISO-2 country, or null if GeoNames has none. */
  loadPostal: (country: string) => Promise<PostalTable | null> | PostalTable | null;
  /** Identifies your deployment to Nominatim, Overpass and EOX. Include a URL or contact. */
  userAgent: string;
  /** Extra fetch options (e.g. Next.js `{ next: { revalidate } }`) for outbound calls. */
  fetchInit?: RequestInit;
  /**
   * Set false to skip the live Overpass waterway call (the offline GRDC river name is
   * still used). Useful when the host fetches waterway names in a separate request,
   * since public Overpass servers can take 10 to 20 seconds.
   */
  waterways?: boolean;
}

type Card<T> = ({ status: 'ok' } & T) | { status: 'empty'; message: string } | { status: 'error'; message: string };

export interface PlaceResult {
  lat: number;
  lon: number;
  label: string;
  region: string;
  source: 'geonames' | 'nominatim';
  note: string;
}

export interface WatershedCard {
  major: { name: string; sea: string; ocean: string; areaKm2: number | null } | null;
  island: { name: string | null; areaKm2: number } | null;
  summary: string;
  level5: { id: number; pfaf: number; areaKm2: number } | null;
  level8: { id: number; pfaf: number; areaKm2: number; upstreamKm2: number } | null;
  waterway: Card<{ source: 'osm' | 'grdc'; nearest: Waterway; others: Waterway[] }>;
  /** Whether the live OpenStreetMap lookup answered. 'failed' results should be cached briefly. */
  osm: 'ok' | 'failed' | 'skipped';
}

export interface EcoregionCard {
  name: string;
  biome: string;
  realm: string;
  id: number;
}

export interface LookupResult {
  ok: true;
  query: { country: string; postalCode: string };
  place: PlaceResult;
  watershed: Card<WatershedCard>;
  ecoregion: Card<EcoregionCard>;
  stewards: { status: 'ok'; mapUrl: string; caveat: string };
  imagery: { lat: number; lon: number; zoom: number };
  /** True when a live source failed and the result should only be cached briefly. */
  degraded: boolean;
}

export interface LookupError {
  ok: false;
  code: 'invalid_input' | 'not_found' | 'geocoder_unavailable';
  message: string;
}

export function createLookup(opts: LookupOptions) {
  const layers = new Map<LayerName, Promise<WslLayer>>();
  const layer = (name: LayerName) => {
    if (!layers.has(name)) layers.set(name, Promise.resolve(opts.loadLayer(name)).then((b) => new WslLayer(b)));
    return layers.get(name)!;
  };

  async function geocode(country: string, postalCode: string): Promise<PlaceResult | LookupError> {
    const table = await opts.loadPostal(country);
    const m = table ? matchPostal(table, country, postalCode) : null;
    if (m) {
      const label = m.places > 1 ? `${m.place} and ${m.places - 1} nearby place${m.places > 2 ? 's' : ''}` : m.place;
      return {
        lat: m.lat,
        lon: m.lon,
        label,
        region: [ADMIN2_UNRELIABLE.has(country) || m.admin2 === m.place ? '' : m.admin2, m.admin1].filter(Boolean).join(', '),
        source: 'geonames',
        note: m.partial
          ? `Matched the postal district ${m.matched}, so this describes the wider district.`
          : 'A postal code covers an area, so this describes the neighborhood, not an address.',
      };
    }
    try {
      const n = await nominatimPostal(country, postalCode, { userAgent: opts.userAgent, fetchInit: opts.fetchInit });
      if (n) {
        const parts = n.label.split(',').map((s) => s.trim());
        return {
          lat: n.lat,
          lon: n.lon,
          label: parts[1] ?? parts[0],
          region: parts.slice(2, 4).join(', '),
          source: 'nominatim',
          note: 'A postal code covers an area, so this describes the neighborhood, not an address.',
        };
      }
    } catch {
      return { ok: false, code: 'geocoder_unavailable', message: 'The postal code service did not answer. Try again in a minute.' };
    }
    return {
      ok: false,
      code: 'not_found',
      message: 'That postal code was not found for this country. Check the code, or try a neighboring one.',
    };
  }

  async function watershed(lat: number, lon: number): Promise<Card<WatershedCard>> {
    try {
      const [h5, h8, grdc, rivers, land, islands] = await Promise.all(
        (['hybas05', 'hybas08', 'grdc', 'rivers', 'land', 'islands'] as const).map(layer),
      );
      const b5 = h5.query(lon, lat, 3);
      const b8 = h8.query(lon, lat, 3);
      const g = grdc.query(lon, lat, 1);
      const l = land.query(lon, lat, 3);
      const isl = islands.query(lon, lat, 2);
      if (!b5 && !b8 && !g) {
        return { status: 'empty', message: 'HydroBASINS does not cover this place (it leaves out some remote islands, including Hawaii).' };
      }
      const landArea = l ? Number(l.props.AREA_KM2) : Infinity;
      const isIsland = landArea < ISLAND_MAX_KM2;
      const islandName = isIsland && isl ? String(isl.props.NAME) : null;
      const major = g
        ? {
            name: titleCase(String(g.props.RIVERBASIN)),
            sea: String(g.props.SEA ?? ''),
            ocean: String(g.props.OCEAN ?? ''),
            areaKm2: g.props.AREA_KM2 as number | null,
          }
        : null;
      let summary: string;
      if (major) {
        summary = `The ${major.name} basin, draining to the ${major.sea || major.ocean}.`;
      } else if (isIsland) {
        summary = islandName
          ? `${islandName} is its own island watershed system: its rivers run straight to the sea.`
          : 'This island is its own watershed system: its rivers run straight to the sea.';
      } else {
        summary = 'A coastal basin: rivers here run straight to the sea instead of joining one of the world’s major river systems.';
      }
      // Name the local water: OpenStreetMap first, then GRDC's named main rivers offline.
      let waterway: WatershedCard['waterway'] = { status: 'empty', message: 'No named waterway was found nearby.' };
      let osmFailed = false;
      if (opts.waterways !== false) {
        try {
          const ways = await nearestWaterways(lat, lon, { userAgent: opts.userAgent, fetchInit: opts.fetchInit });
          if (ways.length) waterway = { status: 'ok', source: 'osm', nearest: ways[0], others: ways.slice(1, 4) };
        } catch {
          osmFailed = true;
        }
      }
      if (waterway.status !== 'ok') {
        const r = rivers.query(lon, lat, 12);
        if (r) {
          waterway = {
            status: 'ok',
            source: 'grdc',
            nearest: { name: String(r.props.RIVER), kind: 'river', distanceKm: r.distanceKm },
            others: [],
          };
        } else if (osmFailed) {
          waterway = { status: 'error', message: 'The waterway name service did not answer this time.' };
        } else if (opts.waterways === false) {
          waterway = { status: 'empty', message: 'No major named river is mapped nearby.' };
        } else {
          waterway = { status: 'empty', message: 'No named waterway is mapped in OpenStreetMap within 4 km.' };
        }
      }
      return {
        status: 'ok',
        major,
        island: isIsland ? { name: islandName, areaKm2: landArea } : null,
        summary,
        level5: b5 ? { id: b5.props.HYBAS_ID as number, pfaf: b5.props.PFAF_ID as number, areaKm2: b5.props.SUB_AREA as number } : null,
        level8: b8
          ? {
              id: b8.props.HYBAS_ID as number,
              pfaf: b8.props.PFAF_ID as number,
              areaKm2: b8.props.SUB_AREA as number,
              upstreamKm2: b8.props.UP_AREA as number,
            }
          : null,
        waterway,
        osm: opts.waterways === false ? 'skipped' : osmFailed ? 'failed' : 'ok',
      };
    } catch {
      return { status: 'error', message: 'The watershed index could not be read.' };
    }
  }

  async function ecoregion(lat: number, lon: number): Promise<Card<EcoregionCard>> {
    try {
      const hit = (await layer('resolve')).query(lon, lat, 5);
      if (!hit || Number(hit.props.ECO_ID) === 0) return { status: 'empty', message: 'No ecoregion is mapped at this point.' };
      return {
        status: 'ok',
        name: String(hit.props.ECO_NAME),
        biome: String(hit.props.BIOME_NAME).replace(/ & /g, ' and '),
        realm: String(hit.props.REALM),
        id: Number(hit.props.ECO_ID),
      };
    } catch {
      return { status: 'error', message: 'The ecoregion index could not be read.' };
    }
  }

  return async function lookup(countryIn: string, postalIn: string): Promise<LookupResult | LookupError> {
    const country = String(countryIn ?? '').trim().toUpperCase();
    const postalCode = String(postalIn ?? '').trim();
    if (!/^[A-Z]{2}$/.test(country) || !isPlausiblePostal(postalCode)) {
      return { ok: false, code: 'invalid_input', message: 'Choose a country and enter a postal code.' };
    }
    const place = await geocode(country, postalCode);
    if ('ok' in place) return place;
    const [w, e] = await Promise.all([watershed(place.lat, place.lon), ecoregion(place.lat, place.lon)]);
    return {
      ok: true,
      query: { country, postalCode: normalizePostal(postalCode) },
      place,
      watershed: w,
      ecoregion: e,
      stewards: { status: 'ok', mapUrl: nativeLandMapUrl(place.lat, place.lon), caveat: NATIVE_LAND_CAVEAT },
      imagery: { lat: Math.round(place.lat * 1e3) / 1e3, lon: Math.round(place.lon * 1e3) / 1e3, zoom: 12 },
      degraded: w.status === 'error' || e.status === 'error' || (w.status === 'ok' && w.osm === 'failed'),
    };
  };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}
