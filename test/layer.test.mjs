// Synthetic round-trip test: no downloaded data needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLayer } from '../scripts/lib/layerfile.mjs';
import { simplifyRing } from '../scripts/lib/simplify.mjs';
import { WslLayer } from '../dist/src/layer.js';
import { matchPostal } from '../dist/src/postal.js';
import { planMosaic } from '../dist/src/imagery.js';
import { nativeLandMapUrl } from '../dist/src/nativeland.js';

const SCALE = 3600;
const square = (x0, y0, s) => Float64Array.from([x0, y0, x0, y0 + s, x0 + s, y0 + s, x0 + s, y0, x0, y0]);

test('layer round trip: containment, holes, nearest fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wsl-'));
  const file = join(dir, 't.wsl');
  writeLayer(file, {
    name: 't',
    scale: SCALE,
    cell: 1,
    fields: [
      { name: 'ID', type: 'num' },
      { name: 'NAME', type: 'str' },
    ],
    features: [
      { rings: [simplifyRing(square(10, 10, 2), 0.001, SCALE), simplifyRing(square(10.5, 10.5, 0.5), 0.001, SCALE)], props: { ID: 1, NAME: 'outer with hole' } },
      { rings: [simplifyRing(square(-73.5, 6.5, 0.4), 0.001, SCALE)], props: { ID: 5080011750, NAME: 'west' } },
    ],
  });
  const layer = new WslLayer(readFileSync(file));
  assert.equal(layer.query(11.5, 11.5)?.props.NAME, 'outer with hole');
  assert.equal(layer.query(10.7, 10.7), null, 'point in the hole');
  assert.equal(layer.query(-73.2, 6.6)?.props.ID, 5080011750, 'large ids survive');
  const near = layer.query(12.01, 11, 5);
  assert.equal(near?.props.ID, 1);
  assert.ok(near.distanceKm > 0.5 && near.distanceKm < 2);
  assert.equal(layer.query(50, 50, 5), null);
});

test('postal matching with partial countries', () => {
  const table = { SW1A: [51.5, -0.14, 'London', '', 'England', 1], 80571: [-8.5, 115.26, 'Ubud', 'Gianyar', 'Bali', 8] };
  assert.equal(matchPostal(table, 'ID', '80571')?.place, 'Ubud');
  const gb = matchPostal(table, 'GB', 'sw1a 1aa');
  assert.equal(gb?.matched, 'SW1A');
  assert.equal(gb?.partial, true);
  assert.equal(matchPostal(table, 'ID', '80570'), null);
});

test('mosaic plan is centered and covers the window', () => {
  const p = planMosaic(-8.509, 115.258, 12, 768);
  assert.ok(p.tiles.length >= 9 && p.tiles.length <= 16);
  for (const t of p.tiles) assert.ok(t.left > -256 && t.left < 768 && t.top > -256 && t.top < 768);
});

test('native land link centers on the point', () => {
  const u = new URL(nativeLandMapUrl(45.5078, -122.6897));
  assert.equal(u.pathname, '/maps/native-land');
  assert.equal(u.searchParams.get('center'), '-122.6897,45.5078');
  assert.deepEqual(JSON.parse(u.searchParams.get('bbox')).length, 2);
});
