// Douglas-Peucker simplification for closed rings, iterative (no recursion), plus
// quantization to an integer grid. Rings are flat arrays [x0, y0, x1, y1, ...].

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  let t = dx === 0 && dy === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

function dpKeep(ring, first, last, tol2, keep) {
  const stack = [first, last];
  while (stack.length) {
    const b = stack.pop();
    const a = stack.pop();
    let maxD = -1;
    let idx = -1;
    const ax = ring[a * 2], ay = ring[a * 2 + 1], bx = ring[b * 2], by = ring[b * 2 + 1];
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(ring[i * 2], ring[i * 2 + 1], ax, ay, bx, by);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
}

/**
 * Simplify a closed ring and quantize it. Returns an Int32Array of quantized
 * coordinates without the closing duplicate, or null if the ring vanishes.
 */
export function simplifyRing(ring, tolerance, scale) {
  const n = ring.length / 2;
  if (n < 3) return null;
  // Anchor on the first point and the point farthest from it so the ring cannot collapse.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const dx = ring[i * 2] - ring[0];
    const dy = ring[i * 2 + 1] - ring[1];
    const d = dx * dx + dy * dy;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  if (far > 0) dpKeep(ring, 0, far, tol2, keep);
  if (far < n - 1) dpKeep(ring, far, n - 1, tol2, keep);

  const out = [];
  let px = NaN, py = NaN;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const x = Math.round(ring[i * 2] * scale);
    const y = Math.round(ring[i * 2 + 1] * scale);
    if (x === px && y === py) continue;
    out.push(x, y);
    px = x;
    py = y;
  }
  // Drop the closing duplicate.
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  if (out.length < 6) {
    // Tiny ring (an islet smaller than the tolerance): keep a triangle from the source.
    const pick = [0, Math.floor(n / 3), Math.floor((2 * n) / 3)];
    const tri = [];
    for (const i of pick) tri.push(Math.round(ring[i * 2] * scale), Math.round(ring[i * 2 + 1] * scale));
    const uniq = new Set([`${tri[0]},${tri[1]}`, `${tri[2]},${tri[3]}`, `${tri[4]},${tri[5]}`]);
    if (uniq.size < 3) return null;
    return Int32Array.from(tri);
  }
  return Int32Array.from(out);
}

/** Approximate spherical area of a ring in km² (lon/lat degrees). */
export function ringAreaKm2(ring) {
  const R = 6371.0088;
  const rad = Math.PI / 180;
  let sum = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const l1 = ring[i * 2] * rad, p1 = ring[i * 2 + 1] * rad;
    const l2 = ring[j * 2] * rad, p2 = ring[j * 2 + 1] * rad;
    sum += (l2 - l1) * (2 + Math.sin(p1) + Math.sin(p2));
  }
  return Math.abs((sum * R * R) / 2);
}

/** Simplify an open polyline and quantize it. Returns null if fewer than 2 points remain. */
export function simplifyLine(line, tolerance, scale) {
  const n = line.length / 2;
  if (n < 2) return null;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  dpKeep(line, 0, n - 1, tolerance * tolerance, keep);
  const out = [];
  let px = NaN, py = NaN;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const x = Math.round(line[i * 2] * scale);
    const y = Math.round(line[i * 2 + 1] * scale);
    if (x === px && y === py) continue;
    out.push(x, y);
    px = x;
    py = y;
  }
  return out.length >= 4 ? Int32Array.from(out) : null;
}
