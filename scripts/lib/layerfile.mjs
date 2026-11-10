// Writer for the WSL1 layer format: a compact, read-only point-in-polygon index.
//
//   bytes 0..3   "WSL1"
//   bytes 4..7   u32 LE length of the JSON header
//   header JSON  (padded with spaces to an 8-byte boundary)
//   sections     8-byte aligned, offsets recorded in the header:
//     num columns   Float64Array(count) per numeric field
//     bbox          Int32Array(count * 4)  quantized minX, minY, maxX, maxY
//     geomOffsets   Uint32Array(count + 1) byte offsets into geometry
//     gridStart     Uint32Array(cells + 1)
//     gridItems     Uint32Array(n)        feature indexes per grid cell (by bbox)
//     geometry      varint stream: nParts, then per part nPts and zigzag deltas
//                   (closed rings for polygon layers, open lines for line layers)
//
// String fields are stored in the JSON header (layers with string fields are small).
import { writeFileSync } from 'node:fs';

function zigzag(n) {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

class ByteSink {
  constructor(initial = 1 << 20) {
    this.buf = new Uint8Array(initial);
    this.len = 0;
  }
  ensure(extra) {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  varint(v) {
    this.ensure(10);
    while (v >= 0x80) {
      this.buf[this.len++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.len++] = v;
  }
  bytes() {
    return this.buf.subarray(0, this.len);
  }
}

/**
 * @param {string} path
 * @param {{name: string, scale: number, cell: number, meta?: object,
 *          fields: {name: string, type: 'num'|'str'}[],
 *          features: {rings: Int32Array[], props: Record<string, any>}[]}} layer
 */
export function writeLayer(path, layer) {
  const { features, scale, cell } = layer;
  const count = features.length;
  const geom = new ByteSink();
  const geomOffsets = new Uint32Array(count + 1);
  const bbox = new Int32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const { rings } = features[i];
    geomOffsets[i] = geom.len;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    geom.varint(rings.length);
    for (const r of rings) {
      const n = r.length / 2;
      geom.varint(n);
      let px = 0, py = 0;
      for (let k = 0; k < n; k++) {
        const x = r[k * 2], y = r[k * 2 + 1];
        geom.varint(zigzag(x - px));
        geom.varint(zigzag(y - py));
        px = x;
        py = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (rings.length === 0) minX = minY = maxX = maxY = 0;
    bbox.set([minX, minY, maxX, maxY], i * 4);
  }
  geomOffsets[count] = geom.len;

  // Uniform grid over the globe, cell size in degrees.
  const nx = Math.ceil(360 / cell);
  const ny = Math.ceil(180 / cell);
  const cellOf = (v, origin, n) => Math.min(n - 1, Math.max(0, Math.floor((v / scale - origin) / cell)));
  const counts = new Uint32Array(nx * ny + 1);
  const ranges = new Int32Array(count * 4);
  for (let i = 0; i < count; i++) {
    if (features[i].rings.length === 0) {
      ranges.set([1, 1, 0, 0], i * 4);
      continue;
    }
    const x0 = cellOf(bbox[i * 4], -180, nx), y0 = cellOf(bbox[i * 4 + 1], -90, ny);
    const x1 = cellOf(bbox[i * 4 + 2], -180, nx), y1 = cellOf(bbox[i * 4 + 3], -90, ny);
    ranges.set([x0, y0, x1, y1], i * 4);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) counts[y * nx + x + 1]++;
  }
  const gridStart = new Uint32Array(nx * ny + 1);
  for (let c = 1; c <= nx * ny; c++) gridStart[c] = gridStart[c - 1] + counts[c];
  const fill = gridStart.slice(0, nx * ny);
  const gridItems = new Uint32Array(gridStart[nx * ny]);
  for (let i = 0; i < count; i++) {
    const [x0, y0, x1, y1] = ranges.subarray(i * 4, i * 4 + 4);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) gridItems[fill[y * nx + x]++] = i;
  }

  // Columns.
  const numCols = [];
  const fieldsOut = [];
  for (const f of layer.fields) {
    if (f.type === 'num') {
      const col = new Float64Array(count);
      for (let i = 0; i < count; i++) col[i] = Number(features[i].props[f.name] ?? NaN);
      numCols.push(col);
      fieldsOut.push({ name: f.name, type: 'num' });
    } else {
      fieldsOut.push({ name: f.name, type: 'str', values: features.map((ft) => String(ft.props[f.name] ?? '')) });
    }
  }

  const sections = [];
  const header = {
    format: 'WSL1',
    name: layer.name,
    geometry: layer.geometry ?? 'polygon',
    count,
    scale,
    grid: { cell, nx, ny, x0: -180, y0: -90 },
    fields: fieldsOut,
    meta: layer.meta ?? {},
    sections: {},
  };
  const addSection = (key, arr) => sections.push({ key, arr });
  numCols.forEach((col, k) => addSection(`col:${k}`, col));
  addSection('bbox', bbox);
  addSection('geomOffsets', geomOffsets);
  addSection('gridStart', gridStart);
  addSection('gridItems', gridItems);
  addSection('geometry', geom.bytes());

  // Two passes: offsets depend on header length, which depends on offsets.
  let headerBytes = new Uint8Array(0);
  for (let pass = 0; pass < 3; pass++) {
    let off = align8(8 + headerBytes.length);
    for (const s of sections) {
      header.sections[s.key] = { offset: off, length: s.arr.byteLength };
      off = align8(off + s.arr.byteLength);
    }
    let numK = 0;
    for (const f of header.fields) if (f.type === 'num') f.section = `col:${numK++}`;
    const json = JSON.stringify(header);
    const padded = json + ' '.repeat(align8(8 + Buffer.byteLength(json)) - 8 - Buffer.byteLength(json));
    const next = new TextEncoder().encode(padded);
    if (next.length === headerBytes.length) {
      headerBytes = next;
      break;
    }
    headerBytes = next;
  }
  const last = sections[sections.length - 1];
  const total = header.sections[last.key].offset + last.arr.byteLength;
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode('WSL1'), 0);
  new DataView(out.buffer).setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  for (const s of sections) {
    const { offset } = header.sections[s.key];
    if (offset < 8 + headerBytes.length) throw new Error('header overlaps sections');
    out.set(new Uint8Array(s.arr.buffer, s.arr.byteOffset, s.arr.byteLength), offset);
  }
  writeFileSync(path, out);
  return { bytes: total, count, vertices: null };
}

function align8(n) {
  return Math.ceil(n / 8) * 8;
}
