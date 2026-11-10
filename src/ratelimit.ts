// In-memory token bucket per key (e.g. client IP). Per process only: pair it with a
// CDN cache or a platform firewall rule for real abuse protection.
export function createRateLimiter(opts: { capacity: number; refillPerMinute: number; maxKeys?: number }) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const perMs = opts.refillPerMinute / 60000;
  return function take(key: string): { ok: boolean; retryAfterS: number } {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      if (buckets.size >= (opts.maxKeys ?? 10000)) buckets.delete(buckets.keys().next().value!);
      b = { tokens: opts.capacity, at: now };
      buckets.set(key, b);
    }
    b.tokens = Math.min(opts.capacity, b.tokens + (now - b.at) * perMs);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, retryAfterS: 0 };
    }
    return { ok: false, retryAfterS: Math.ceil((1 - b.tokens) / perMs / 1000) };
  };
}
