// Reader for WSL1 layer files written by scripts/lib/layerfile.mjs.
// Point-in-polygon lookups over a uniform grid index, with a nearest-polygon
// fallback for points that land in a simplification gap or just offshore.

interface FieldDef {
  name: string;
  type: 'num' | 'str';
  section?: string;
  values?: string[];
}

interface Header {
  format: 'WSL1';
  name: string;
  geometry?: 'polygon' | 'line';
  count: number;
  scale: number;
  grid: { cell: number; nx: number; ny: number; x0: number; y0: number };
  fields: FieldDef[];
  meta: Record<string, unknown>;
  sections: Record<string, { offset: number; length: number }>;
}

export interface LayerHit {
  index: number;
  /** 0 when the point is inside the polygon, else the distance in km to its edge. */
  distanceKm: number;
  props: Record<string, string | number | null>;
}

export class WslLayer {
  readonly header: Header;
  private readonly bytes: Uint8Array;
  private readonly bbox: Int32Array;
  private readonly geomOffsets: Uint32Array;
  private readonly gridStart: Uint32Array;
  private readonly gridItems: Uint32Array;
  private readonly geometry: Uint8Array;
  private readonly columns = new Map<string, Float64Array>();

  constructor(input: Uint8Array) {
    // Typed-array views need 8-byte alignment of the underlying buffer.
    const bytes = input.byteOffset % 8 === 0 ? input : new Uint8Array(input);
    this.bytes = bytes;
    const magic = new TextDecoder().decode(bytes.subarray(0, 4));
    if (magic !== 'WSL1') throw new Error('Not a WSL1 layer file');
    const headerLen = new DataView(bytes.buffer, bytes.byteOffset, 8).getUint32(4, true);
    this.header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as Header;
    const s = this.header.sections;
    const view = <T>(Ctor: new (b: ArrayBufferLike, o: number, n: number) => T, key: string, size: number): T =>
      new Ctor(bytes.buffer, bytes.byteOffset + s[key].offset, s[key].length / size);
    this.bbox = view(Int32Array, 'bbox', 4);
    this.geomOffsets = view(Uint32Array, 'geomOffsets', 4);
    this.gridStart = view(Uint32Array, 'gridStart', 4);
    this.gridItems = view(Uint32Array, 'gridItems', 4);
    this.geometry = bytes.subarray(s.geometry.offset, s.geometry.offset + s.geometry.length);
    for (const f of this.header.fields) {
      if (f.type === 'num' && f.section) this.columns.set(f.name, view(Float64Array, f.section, 8));
    }
  }

  get name(): string {
    return this.header.name;
  }

  props(index: number): Record<string, string | number | null> {
    const out: Record<string, string | number | null> = {};
    for (const f of this.header.fields) {
      if (f.type === 'num') {
        const v = this.columns.get(f.name)![index];
        out[f.name] = Number.isNaN(v) ? null : v;
      } else {
        out[f.name] = f.values?.[index] ?? null;
      }
    }
    return out;
  }

  /** Decode a feature's rings as quantized integer coordinate arrays. */
  rings(index: number): Int32Array[] {
    const g = this.geometry;
    let pos = this.geomOffsets[index];
    const read = (): number => {
      let result = 0;
      let mul = 1;
      for (;;) {
        const b = g[pos++];
        result += (b & 0x7f) * mul;
        if (b < 0x80) return result;
        mul *= 128;
      }
    };
    const unzig = (v: number) => (v % 2 === 0 ? v / 2 : -(v + 1) / 2);
    const nRings = read();
    const rings: Int32Array[] = [];
    for (let r = 0; r < nRings; r++) {
      const n = read();
      const ring = new Int32Array(n * 2);
      let x = 0;
      let y = 0;
      for (let k = 0; k < n; k++) {
        x += unzig(read());
        y += unzig(read());
        ring[k * 2] = x;
        ring[k * 2 + 1] = y;
      }
      rings.push(ring);
    }
    return rings;
  }

  private cellItems(cx: number, cy: number): Uint32Array {
    const { nx, ny } = this.header.grid;
    if (cx < 0 || cy < 0 || cx >= nx || cy >= ny) return new Uint32Array(0);
    const c = cy * nx + cx;
    return this.gridItems.subarray(this.gridStart[c], this.gridStart[c + 1]);
  }

  /**
   * Find the polygon containing (lon, lat). If none contains it, return the nearest
   * polygon within maxDistanceKm (default 0, i.e. containment only). Line layers
   * only ever return the nearest line within maxDistanceKm.
   */
  query(lon: number, lat: number, maxDistanceKm = 0): LayerHit | null {
    const { scale, grid } = this.header;
    const px = lon * scale;
    const py = lat * scale;
    const cx = Math.floor((lon - grid.x0) / grid.cell);
    const cy = Math.floor((lat - grid.y0) / grid.cell);
    const hits: number[] = [];
    const isLine = this.header.geometry === 'line';
    for (const i of isLine ? [] : this.cellItems(cx, cy)) {
      const b = i * 4;
      if (px < this.bbox[b] || px > this.bbox[b + 2] || py < this.bbox[b + 1] || py > this.bbox[b + 3]) continue;
      if (containsPoint(this.rings(i), px, py)) hits.push(i);
    }
    if (hits.length) {
      // Overlaps can occur along simplified edges; prefer the smallest polygon.
      hits.sort((a, b) => bboxArea(this.bbox, a) - bboxArea(this.bbox, b));
      return { index: hits[0], distanceKm: 0, props: this.props(hits[0]) };
    }
    if (maxDistanceKm <= 0) return null;

    const kmPerUnitY = 111.32 / scale;
    const kmPerUnitX = (111.32 * Math.cos((lat * Math.PI) / 180)) / scale;
    const reachCells = Math.max(1, Math.ceil(maxDistanceKm / 111.32 / grid.cell / Math.max(0.2, Math.cos((lat * Math.PI) / 180))));
    let best = -1;
    let bestD = Infinity;
    const seen = new Set<number>();
    for (let dy = -reachCells; dy <= reachCells; dy++) {
      for (let dx = -reachCells; dx <= reachCells; dx++) {
        for (const i of this.cellItems(cx + dx, cy + dy)) {
          if (seen.has(i)) continue;
          seen.add(i);
          const d = distanceToParts(this.rings(i), px, py, kmPerUnitX, kmPerUnitY, !isLine);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    if (best < 0 || bestD > maxDistanceKm) return null;
    return { index: best, distanceKm: bestD, props: this.props(best) };
  }
}

function bboxArea(b: Int32Array, i: number): number {
  return (b[i * 4 + 2] - b[i * 4]) * (b[i * 4 + 3] - b[i * 4 + 1]);
}

/** Even-odd rule across all rings, so holes work without orientation checks. */
function containsPoint(rings: Int32Array[], px: number, py: number): boolean {
  let inside = false;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[i * 2], yi = r[i * 2 + 1];
      const xj = r[j * 2], yj = r[j * 2 + 1];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function distanceToParts(parts: Int32Array[], px: number, py: number, kx: number, ky: number, closed: boolean): number {
  let best = Infinity;
  for (const r of parts) {
    const n = r.length / 2;
    for (let i = closed ? 0 : 1, j = closed ? n - 1 : 0; i < n; j = i++) {
      const ax = r[j * 2] * kx, ay = r[j * 2 + 1] * ky;
      const bx = r[i * 2] * kx, by = r[i * 2 + 1] * ky;
      const qx = px * kx, qy = py * ky;
      const dx = bx - ax, dy = by - ay;
      let t = dx === 0 && dy === 0 ? 0 : ((qx - ax) * dx + (qy - ay) * dy) / (dx * dx + dy * dy);
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - qx, ey = ay + t * dy - qy;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < best) best = d;
    }
  }
  return best;
}
