#!/usr/bin/env node
// Download every source dataset into <data-dir>/raw (default .data/raw).
// Usage: node scripts/fetch-data.mjs [--data-dir .data] [--only hybas,grdc] [--force]
import { createWriteStream, existsSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { SOURCES } from './sources.mjs';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string', default: '.data' },
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});
const rawDir = resolve(values['data-dir'], 'raw');
const only = values.only ? values.only.split(',') : null;
const UA = 'watershed-lookup-data-fetch/1.0 (+https://github.com/johnellison/watershed-lookup)';

for (const s of SOURCES) {
  if (only && !only.some((o) => s.id.startsWith(o))) continue;
  const dest = join(rawDir, s.file);
  if (existsSync(dest) && !values.force) {
    console.log(`skip  ${s.id} (${(statSync(dest).size / 1e6).toFixed(1)} MB already present)`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(s.url, { headers: { 'User-Agent': UA } });
  if (!res.ok || !res.body) throw new Error(`${s.id}: HTTP ${res.status} from ${s.url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest + '.part'));
  renameSync(dest + '.part', dest);
  console.log(`fetch ${s.id} ${(statSync(dest).size / 1e6).toFixed(1)} MB`);
}
