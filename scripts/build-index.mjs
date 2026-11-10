#!/usr/bin/env node
// Build the lookup index from the raw downloads.
// Usage: node --max-old-space-size=8192 scripts/build-index.mjs [--data-dir .data] [--out .data/index] [--only hybas05,postal]
//
// Writes one WSL1 layer file per polygon layer plus one gzipped JSON file per country
// for postal codes. The output contains HydroSHEDS-derived data: keep it private
// (see README, "License constraints").
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { readPolygons, readDbf } from './lib/shapefile.mjs';
import { simplifyRing, simplifyLine, ringAreaKm2 } from './lib/simplify.mjs';
import { writeLayer } from './lib/layerfile.mjs';
import { HYBAS_REGIONS } from './sources.mjs';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string', default: '.data' },
    out: { type: 'string' },
    only: { type: 'string' },
    tolerance: { type: 'string', default: '0.004' },
  },
});
const dataDir = resolve(values['data-dir']);
const rawDir = join(dataDir, 'raw');
const outDir = resolve(values.out ?? join(dataDir, 'index'));
const tmpDir = join(dataDir, 'tmp');
const only = values.only ? values.only.split(',') : null;
const TOL = Number(values.tolerance);
const SCALE = 3600; // 1 arc-second grid; HydroBASINS vertices (1/240 degree) land exactly on it.
mkdirSync(outDir, { recursive: true });

const want = (k) => !only || only.includes(k);

function extract(zip, dest, patterns = []) {
  if (!existsSync(zip)) throw new Error(`Missing ${zip}. Run scripts/fetch-data.mjs first.`);
  mkdirSync(dest, { recursive: true });
  // Uses the system `unzip` (macOS and most Linux images ship it).
  execFileSync('unzip', ['-o', '-q', '-j', zip, ...patterns, '-d', dest], { stdio: 'inherit' });
  return dest;
}

function findShp(dir, re) {
  const f = readdirSync(dir).find((n) => re.test(n) && n.toLowerCase().endsWith('.shp'));
  if (!f) throw new Error(`No shapefile matching ${re} in ${dir}`);
  return join(dir, f);
}

function simplifyRings(rings, tol = TOL) {
  const out = [];
  for (const r of rings) {
    const s = simplifyRing(r, tol, SCALE);
    if (s) out.push(s);
  }
  return out;
}

function report(name, file, info) {
  const mb = (statSync(file).size / 1e6).toFixed(1);
  console.log(`${name.padEnd(10)} ${String(info.count).padStart(7)} features  ${mb} MB  ${file}`);
}

// HydroBASINS: merge all nine regions per level (Bali, for example, is in region "au").
for (const level of ['05', '08']) {
  const key = `hybas${level}`;
  if (!want(key)) continue;
  const features = [];
  for (const region of HYBAS_REGIONS) {
    const dir = extract(join(rawDir, `hybas/hybas_${region}_lev${level}_v1c.zip`), join(tmpDir, `hybas_${region}_${level}`));
    const shp = findShp(dir, /hybas_/);
    const { rows } = readDbf(shp.replace(/\.shp$/, '.dbf'));
    for (const { index, rings } of readPolygons(shp)) {
      const r = rows[index];
      features.push({
        rings: simplifyRings(rings),
        props: { HYBAS_ID: r.HYBAS_ID, PFAF_ID: r.PFAF_ID, SUB_AREA: r.SUB_AREA, UP_AREA: r.UP_AREA, COAST: r.COAST, ENDO: r.ENDO },
      });
    }
    console.log(`  ${key} ${region}: ${features.length} features so far`);
  }
  const file = join(outDir, `${key}.wsl`);
  const info = writeLayer(file, {
    name: key,
    scale: SCALE,
    cell: level === '08' ? 0.5 : 1,
    fields: ['HYBAS_ID', 'PFAF_ID', 'SUB_AREA', 'UP_AREA', 'COAST', 'ENDO'].map((name) => ({ name, type: 'num' })),
    features,
    meta: { source: 'HydroBASINS v1c', level: Number(level), tolerance: TOL, license: 'HydroSHEDS v1 License Agreement' },
  });
  report(key, file, info);
}

if (want('grdc')) {
  const dir = extract(join(rawDir, 'grdc/GRDC_Major_River_Basins_shp.zip'), join(tmpDir, 'grdc'), ['*mrb_basins.*']);
  const shp = findShp(dir, /^mrb_basins/);
  const { rows } = readDbf(shp.replace(/\.shp$/, '.dbf'));
  const features = [];
  for (const { index, rings } of readPolygons(shp)) {
    const r = rows[index];
    features.push({
      rings: simplifyRings(rings),
      props: { MRBID: r.MRBID, RIVERBASIN: r.RIVERBASIN, SEA: r.SEA, OCEAN: r.OCEAN, CONTINENT: r.CONTINENT, AREA_KM2: r.SUM_SUB_AR },
    });
  }
  const file = join(outDir, 'grdc.wsl');
  const info = writeLayer(file, {
    name: 'grdc',
    scale: SCALE,
    cell: 1,
    fields: [
      { name: 'MRBID', type: 'num' },
      { name: 'AREA_KM2', type: 'num' },
      { name: 'RIVERBASIN', type: 'str' },
      { name: 'SEA', type: 'str' },
      { name: 'OCEAN', type: 'str' },
      { name: 'CONTINENT', type: 'str' },
    ],
    features,
    meta: { source: 'GRDC Major River Basins of the World, 2nd rev. ed. 2020', tolerance: TOL },
  });
  report('grdc', file, info);
}

// GRDC named main rivers: an offline fallback for naming the nearest river when
// OpenStreetMap (Overpass) does not answer.
if (want('rivers')) {
  const dir = extract(join(rawDir, 'grdc/GRDC_Major_River_Basins_shp.zip'), join(tmpDir, 'grdc_rivers'), ['*mrb_named_rivers.*']);
  const shp = findShp(dir, /^mrb_named_rivers/);
  const { rows } = readDbf(shp.replace(/\.shp$/, '.dbf'));
  const features = [];
  for (const { index, rings: parts } of readPolygons(shp)) {
    const r = rows[index];
    const lines = parts.map((p) => simplifyLine(p, TOL, SCALE)).filter(Boolean);
    if (lines.length) features.push({ rings: lines, props: { MRBID: r.MRBID, RIVER: r.RIVER } });
  }
  const file = join(outDir, 'rivers.wsl');
  const info = writeLayer(file, {
    name: 'rivers',
    geometry: 'line',
    scale: SCALE,
    cell: 1,
    fields: [
      { name: 'MRBID', type: 'num' },
      { name: 'RIVER', type: 'str' },
    ],
    features,
    meta: { source: 'GRDC Major River Basins of the World: named main rivers', tolerance: TOL },
  });
  report('rivers', file, info);
}

if (want('resolve')) {
  const dir = extract(join(rawDir, 'resolve/Ecoregions2017.zip'), join(tmpDir, 'resolve'));
  const shp = findShp(dir, /^Ecoregions2017/);
  const { rows } = readDbf(shp.replace(/\.shp$/, '.dbf'), 'latin1'); // the DBF is latin-1, not UTF-8
  const features = [];
  for (const { index, rings } of readPolygons(shp)) {
    const r = rows[index];
    features.push({
      rings: simplifyRings(rings),
      props: { ECO_ID: r.ECO_ID, ECO_NAME: r.ECO_NAME, BIOME_NAME: r.BIOME_NAME, REALM: r.REALM },
    });
  }
  const file = join(outDir, 'resolve.wsl');
  const info = writeLayer(file, {
    name: 'resolve',
    scale: SCALE,
    cell: 1,
    fields: [
      { name: 'ECO_ID', type: 'num' },
      { name: 'ECO_NAME', type: 'str' },
      { name: 'BIOME_NAME', type: 'str' },
      { name: 'REALM', type: 'str' },
    ],
    features,
    meta: { source: 'RESOLVE Ecoregions 2017', license: 'CC BY 4.0', tolerance: TOL },
  });
  report('resolve', file, info);
}

// Natural Earth land: one feature per landmass, with its area, to tell islands from continents.
if (want('land')) {
  const dir = extract(join(rawDir, 'ne/ne_10m_land.zip'), join(tmpDir, 'ne_land'));
  const shp = findShp(dir, /^ne_10m_land/);
  const features = [];
  for (const { rings } of readPolygons(shp)) {
    for (const ring of rings) {
      // Shapefile outer rings are clockwise; skip holes (counter-clockwise).
      if (signedArea(ring) > 0) continue;
      const s = simplifyRing(ring, TOL, SCALE);
      if (s) features.push({ rings: [s], props: { AREA_KM2: Math.round(ringAreaKm2(ring)) } });
    }
  }
  const file = join(outDir, 'land.wsl');
  const info = writeLayer(file, {
    name: 'land',
    scale: SCALE,
    cell: 1,
    fields: [{ name: 'AREA_KM2', type: 'num' }],
    features,
    meta: { source: 'Natural Earth 10m land', license: 'Public domain', tolerance: TOL },
  });
  report('land', file, info);
}

if (want('islands')) {
  const dir = extract(join(rawDir, 'ne/ne_10m_geography_regions_polys.zip'), join(tmpDir, 'ne_regions'));
  const shp = findShp(dir, /^ne_10m_geography_regions_polys/);
  const { rows } = readDbf(shp.replace(/\.shp$/, '.dbf'), 'utf8');
  const features = [];
  for (const { index, rings } of readPolygons(shp)) {
    const r = rows[index];
    if (r.FEATURECLA !== 'Island' && r.FEATURECLA !== 'Island group') continue;
    features.push({ rings: simplifyRings(rings), props: { NAME: r.NAME_EN || r.NAME, KIND: r.FEATURECLA } });
  }
  const file = join(outDir, 'islands.wsl');
  const info = writeLayer(file, {
    name: 'islands',
    scale: SCALE,
    cell: 1,
    fields: [
      { name: 'NAME', type: 'str' },
      { name: 'KIND', type: 'str' },
    ],
    features,
    meta: { source: 'Natural Earth 10m geography regions (islands)', license: 'Public domain', tolerance: TOL },
  });
  report('islands', file, info);
}

if (want('postal')) {
  const zip = join(rawDir, 'geonames/allCountries.zip');
  if (!existsSync(zip)) throw new Error(`Missing ${zip}. Run scripts/fetch-data.mjs first.`);
  const text = execFileSync('unzip', ['-p', zip, 'allCountries.txt'], { maxBuffer: 1 << 30 }).toString('utf8');
  /** @type {Map<string, Map<string, string[][]>>} */
  const byCountry = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const [cc, code] = c;
    const key = normalizePostal(code);
    if (!key) continue;
    if (!byCountry.has(cc)) byCountry.set(cc, new Map());
    const m = byCountry.get(cc);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(c);
  }
  const postalDir = join(outDir, 'postal');
  mkdirSync(postalDir, { recursive: true });
  let total = 0;
  let bytes = 0;
  const countries = [];
  for (const [cc, m] of [...byCountry].sort()) {
    const out = {};
    for (const [key, rows] of m) {
      const good = rows.filter((r) => Number(r[11]) >= 4);
      const use = good.length ? good : rows;
      const lat = mean(use.map((r) => Number(r[9])));
      const lon = mean(use.map((r) => Number(r[10])));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const names = [...new Set(rows.map((r) => r[2]).filter(Boolean))];
      out[key] = [round4(lat), round4(lon), names[0] ?? '', rows[0][5] ?? '', rows[0][3] ?? '', names.length];
    }
    const buf = gzipSync(JSON.stringify(out), { level: 9 });
    writeFileSync(join(postalDir, `${cc}.json.gz`), buf);
    total += Object.keys(out).length;
    bytes += buf.length;
    countries.push(cc);
  }
  writeFileSync(join(postalDir, 'countries.json'), JSON.stringify(countries));
  console.log(`postal     ${total} codes in ${countries.length} countries, ${(bytes / 1e6).toFixed(1)} MB gzipped`);
}

function normalizePostal(code) {
  return String(code ?? '').toUpperCase().replace(/[\s-]/g, '');
}
function mean(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}
function signedArea(ring) {
  let s = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return s / 2;
}
