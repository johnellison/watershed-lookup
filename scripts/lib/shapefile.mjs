// Minimal, dependency-free ESRI Shapefile reader for polygon layers (.shp + .dbf).
// Supports polygons (types 5, 15, 25) and polylines (types 3, 13, 23). Parts are
// returned as flat Float64Arrays [x0, y0, x1, y1, ...] in source coordinates.
import { readFileSync, existsSync } from 'node:fs';

export function* readPolygons(shpPath) {
  const buf = readFileSync(shpPath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fileBytes = dv.getInt32(24, false) * 2;
  let pos = 100;
  let index = 0;
  while (pos + 8 <= Math.min(fileBytes, buf.byteLength)) {
    const contentBytes = dv.getInt32(pos + 4, false) * 2;
    const rec = pos + 8;
    const type = dv.getInt32(rec, true);
    if (type === 0) {
      yield { index, rings: [] };
    } else if ([3, 5, 13, 15, 23, 25].includes(type)) {
      const numParts = dv.getInt32(rec + 36, true);
      const numPoints = dv.getInt32(rec + 40, true);
      const partsAt = rec + 44;
      const pointsAt = partsAt + numParts * 4;
      const rings = [];
      for (let p = 0; p < numParts; p++) {
        const start = dv.getInt32(partsAt + p * 4, true);
        const end = p + 1 < numParts ? dv.getInt32(partsAt + (p + 1) * 4, true) : numPoints;
        const ring = new Float64Array((end - start) * 2);
        for (let i = start, j = 0; i < end; i++, j += 2) {
          ring[j] = dv.getFloat64(pointsAt + i * 16, true);
          ring[j + 1] = dv.getFloat64(pointsAt + i * 16 + 8, true);
        }
        rings.push(ring);
      }
      yield { index, rings };
    } else {
      throw new Error(`Unsupported shape type ${type} in ${shpPath}`);
    }
    pos = rec + contentBytes;
    index++;
  }
}

export function readDbf(dbfPath, encoding) {
  const buf = readFileSync(dbfPath);
  const n = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const cpgPath = dbfPath.replace(/\.dbf$/i, '.cpg');
  const enc = encoding ?? (existsSync(cpgPath) && /utf-?8/i.test(readFileSync(cpgPath, 'utf8')) ? 'utf8' : 'latin1');
  const fields = [];
  for (let off = 32; off < headerLen - 1 && buf[off] !== 0x0d; off += 32) {
    const name = buf.toString('latin1', off, off + 11).replace(/\0.*$/, '').trim();
    fields.push({ name, type: String.fromCharCode(buf[off + 11]), length: buf[off + 16] });
  }
  const decoder = new TextDecoder(enc === 'utf8' ? 'utf-8' : 'latin1');
  const rows = new Array(n);
  for (let r = 0; r < n; r++) {
    let off = headerLen + r * recLen + 1;
    const row = {};
    for (const f of fields) {
      const raw = decoder.decode(buf.subarray(off, off + f.length)).trim();
      off += f.length;
      if (f.type === 'N' || f.type === 'F') row[f.name] = raw === '' ? null : Number(raw);
      else row[f.name] = raw;
    }
    rows[r] = row;
  }
  return { fields, rows };
}
