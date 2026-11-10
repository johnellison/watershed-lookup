// Minimal HTTP API over the lookup, no framework.
//   node scripts/fetch-data.mjs && node --max-old-space-size=8192 scripts/build-index.mjs
//   npm run build && node dist/examples/server.js
//   curl 'http://localhost:8787/api/watershed?country=DE&postal=10115'
//   curl -o view.webp 'http://localhost:8787/api/watershed/imagery?lat=52.532&lon=13.385'
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createLookup, createRateLimiter, renderMosaic, attributions, type PostalTable } from '../src/index.js';

const INDEX = process.env.WATERSHED_INDEX ?? join(process.cwd(), '.data/index');
const USER_AGENT = process.env.WATERSHED_USER_AGENT ?? 'watershed-lookup-example/1.0 (+https://github.com/johnellison/watershed-lookup)';

const postalCache = new Map<string, PostalTable | null>();
const lookup = createLookup({
  userAgent: USER_AGENT,
  loadLayer: (name) => readFileSync(join(INDEX, `${name}.wsl`)),
  loadPostal: (cc) => {
    if (!postalCache.has(cc)) {
      const f = join(INDEX, 'postal', `${cc}.json.gz`);
      postalCache.set(cc, existsSync(f) ? (JSON.parse(gunzipSync(readFileSync(f)).toString('utf8')) as PostalTable) : null);
    }
    return postalCache.get(cc)!;
  },
});
const limit = createRateLimiter({ capacity: 10, refillPerMinute: 10 });

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ip = req.socket.remoteAddress ?? 'unknown';
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!limit(ip).ok) return send(429, { ok: false, message: 'Too many requests' });
  if (url.pathname === '/api/watershed') {
    const result = await lookup(url.searchParams.get('country') ?? '', url.searchParams.get('postal') ?? '');
    return send(result.ok ? 200 : result.code === 'invalid_input' ? 400 : 404, { ...result, attribution: attributions('watershed-lookup') });
  }
  if (url.pathname === '/api/watershed/imagery') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return send(400, { ok: false });
    const { image } = await renderMosaic(lat, lon, { userAgent: USER_AGENT });
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.end(image);
  }
  send(404, { ok: false });
}).listen(8787, () => console.log('http://localhost:8787/api/watershed?country=DE&postal=10115'));
