// First stewards: a link to Native Land Digital's own map, centered on the place.
//
// This library deliberately does NOT call the Native Land API. Its Data Sovereignty
// Treaty limits commercial use and forbids storing or distributing API data without
// permission. Linking to their map keeps the knowledge with the people who hold it.
//
// URL format (read from native-land.ca's map code, 2026-11): /maps/native-land takes
// `bbox` (JSON [[west, south], [east, north]]) and `center` ("lon,lat"); the map fits
// the box and selects the territories at the center point.

export function nativeLandMapUrl(lat: number, lon: number, spanDeg = 0.25): string {
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const bbox = [
    [r(lon - spanDeg), r(lat - spanDeg * 0.7)],
    [r(lon + spanDeg), r(lat + spanDeg * 0.7)],
  ];
  const u = new URL('https://native-land.ca/maps/native-land');
  u.searchParams.set('bbox', JSON.stringify(bbox));
  u.searchParams.set('center', `${r(lon)},${r(lat)}`);
  return u.toString();
}

export const NATIVE_LAND_CAVEAT =
  'Territories shown on Native Land’s map are a starting point. Ask the nations themselves.';
