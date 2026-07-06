// ── Watchlist cloud sync — Cloudflare Worker ────────────────────────────────
// Free, private, and completely separate from any other app.
//
// It stores one list per "sync code" (a long random secret each device makes).
// You can only read or write a list if you know its code — the Worker never
// lists codes and never exposes anyone else's data. Storage is a KV namespace
// bound to this Worker under the variable name  LISTS.
//
// Deploy steps are in the app's README (Cloud sync section).

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, cors); }

    const code = String(body.code || '');
    // codes are long random secrets — reject anything that isn't one
    if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
    const key = 'list:' + code;

    if (body.op === 'pull') {
      const stored = await env.LISTS.get(key);
      return json(stored ? JSON.parse(stored) : { data: null, updatedAt: 0 }, 200, cors);
    }

    if (body.op === 'push') {
      const payload = JSON.stringify({ data: body.data ?? null, updatedAt: Date.now() });
      if (payload.length > 3_000_000) return json({ error: 'too big' }, 413, cors);
      await env.LISTS.put(key, payload);
      return json({ ok: true, updatedAt: Date.now() }, 200, cors);
    }

    return json({ error: 'bad op' }, 400, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
