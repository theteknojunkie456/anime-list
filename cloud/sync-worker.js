// ── WatchList cloud sync + watch parties — Cloudflare Worker ────────────────
// Free, private, and completely separate from any other app.
// (deploys automatically on push via .github/workflows/deploy-workers.yml)
//
//  • Sync — one list per long random "sync code", stored in KV (bound as LISTS).
//    POST {op:'pull'|'push', code, data}. Keys: list:<code>
//  • Watch parties — REAL-TIME over WebSockets via a Durable Object (PARTY).
//    Each room code is one Durable Object instance holding the live state in
//    memory, pushing updates to every connected member instantly (no polling,
//    no eventual-consistency staleness — that was the old KV design's lag).
//    Connect: GET wss://…/party/<CODE>?uid=…&name=…&create=1
//
// Deploy: `wrangler deploy -c sync-wrangler.toml`
//   (needs the [[durable_objects]] + [[migrations]] blocks in that config).

const CHAT_CAP = 60;
const QUEUE_CAP = 30;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── watch-party WebSocket → route to the room's Durable Object ──────────
    const m = url.pathname.match(/^\/party\/([A-Za-z0-9]{4,8})$/);
    if (m) {
      const code = m[1].toUpperCase();
      const id = env.PARTY.idFromName(code);
      return env.PARTY.get(id).fetch(request);
    }

    // ── friend live channel: a per-user WebSocket so friend requests and
    // recommendations arrive instantly (no polling / no re-open needed). The
    // client keeps this open; rec_send/fr_send/fr_accept ping the recipient's
    // channel, which pushes a tiny message so their app pulls the fresh data.
    if (url.pathname === '/friend') {
      const code = (url.searchParams.get('code') || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return new Response('bad code', { status: 400 });
      return env.CHAN.get(env.CHAN.idFromName(code)).fetch(request);
    }

    // ── TURN relay credentials — reliable cross-network media (screen-share + voice).
    // The client fetches live ICE credentials from Metered.ca's free TURN service (no
    // credit card, 50GB/mo). Without a real relay ~a third of connections (cellular /
    // strict NAT) fail with "couldn't reach the host". Degrades to STUN-only if the
    // Metered secrets aren't configured yet, so nothing breaks before they're added.
    if (url.pathname === '/turn') {
      const tcors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (request.method === 'OPTIONS') return new Response(null, { headers: tcors });
      // No-card default: Google STUN + the public openrelay TURN. Best-effort and
      // sometimes flaky (that's the nature of a free relay), but needs no billing.
      // If Metered credentials are configured, prepend those (reliable) first.
      const base = [
        // Lots of free STUN → more direct connections succeed without any relay.
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302', 'stun:stun4.l.google.com:19302'] },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        // Free public relay for when a direct path can't be found (best-effort, no billing).
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      ];
      if (!env.METERED_APP || !env.METERED_API_KEY) return json({ iceServers: base }, 200, tcors);
      try {
        const r = await fetch(`https://${env.METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${env.METERED_API_KEY}`);
        const arr = await r.json();
        const ice = Array.isArray(arr) ? arr : [];
        return json({ iceServers: ice.length ? [...ice, ...base] : base }, 200, tcors);
      } catch (e) { return json({ iceServers: base }, 200, tcors); }
    }

    // ── list sync (KV, unchanged) ──────────────────────────────────────────
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
    const op = String(body.op || '');
    if (op === 'pull' || op === 'push') {
      const code = String(body.code || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
      const key = 'list:' + code;
      if (op === 'pull') {
        const stored = await env.LISTS.get(key);
        return json(stored ? JSON.parse(stored) : { data: null, updatedAt: 0 }, 200, cors);
      }
      const payload = JSON.stringify({ data: body.data ?? null, updatedAt: Date.now() });
      // The blob now carries the whole setup (list + themes + friends + settings), not
      // just titles, so give it real room. Cloudflare KV allows 25 MB/value; keep headroom.
      if (payload.length > 20_000_000) return json({ error: 'too big' }, 413, cors);
      await env.LISTS.put(key, payload);
      return json({ ok: true, updatedAt: Date.now() }, 200, cors);
    }

    // ── who's around ────────────────────────────────────────────────────────
    // Your friends' codes are already in your list, and each one has a live
    // channel while their app is open. Asking those channels directly means
    // presence needs no heartbeat, no stored timestamp and no cleanup — close
    // the app and you are offline the same instant.
    if (op === 'presence') {
      const codes = (Array.isArray(body.codes) ? body.codes : [])
        .map(c => String(c || '')).filter(c => /^[A-Za-z0-9]{10,64}$/.test(c)).slice(0, 25);
      const online = {};
      await Promise.all(codes.map(async c => {
        try {
          const r = await env.CHAN.get(env.CHAN.idFromName(c)).fetch('https://chan/probe', { method: 'POST', body: '__probe__' });
          const j = await r.json();
          online[c] = !!(j && j.online);
        } catch { online[c] = false; }
      }));
      return json({ ok: true, online }, 200, cors);
    }

    // ── friend recommendations ──────────────────────────────────────────────
    // A tiny per-user mailbox: friends send show recommendations to your friend
    // code, you pull them and they surface as a "Your Friends Recommend" row.
    // Keyed by the RECIPIENT's code (a long random bearer token shared with
    // friends), stored in the same KV. Show metadata + a short note only — never
    // the encrypted list. Cap so a mailbox can't grow without bound.
    if (op === 'rec_send') {
      const to = String(body.to || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(to)) return json({ error: 'bad to' }, 400, cors);
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      const fromCode = String(from.code || '');
      const fromName = String(from.name || 'A friend').slice(0, 40);
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map(it => ({
        aniId: Number(it && it.aniId) || 0,
        title: String((it && it.title) || '').slice(0, 200),
        img: String((it && it.img) || '').slice(0, 400),
        genre: String((it && it.genre) || '').slice(0, 200),
        kind: (it && it.kind) === 'read' ? 'read' : 'watch',
        note: String((it && it.note) || '').slice(0, 500),   // per-show note
      })).filter(it => it.aniId || it.title);
      if (!items.length) return json({ error: 'no items' }, 400, cors);
      const key = 'rec:' + to;
      let list = [];
      try { const s = await env.LISTS.get(key); if (s) list = JSON.parse(s); } catch {}
      if (!Array.isArray(list)) list = [];
      const envelope = { id: fromCode.slice(0, 8) + Date.now().toString(36), from: { code: fromCode, name: fromName }, items, at: Date.now() };
      list.push(envelope);
      if (list.length > 200) list = list.slice(list.length - 200);
      while (JSON.stringify(list).length > 2_000_000 && list.length > 1) list = list.slice(Math.ceil(list.length / 2));
      await env.LISTS.put(key, JSON.stringify(list));
      ctx.waitUntil(notifyChan(env, to, 'rec', envelope));
      return json({ ok: true, id: envelope.id }, 200, cors);
    }
    // ── telling your friends a party started ─────────────────────────────────
    // The party was always capable and always invisible: you had to know it
    // existed, then send someone a code out-of-band.
    //
    // The obvious build — drop a row in each friend's mailbox — costs one KV
    // write per friend per party, and writes are the scarce thing here (a
    // thousand a day, shared with every list sync). Twenty friends would make
    // one party cost twenty writes and twenty round trips from the phone.
    //
    // So the host writes ONE key, their own, and friends read it. Fanning out
    // on read instead of on write makes a party cost exactly one write no
    // matter how many people are in it, and reads are the plentiful side.
    //
    // The trust model is unchanged and comes for free: pinv:<host> is only
    // findable if you already hold that host's friend code.
    if (op === 'party_tell') {
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      const fromCode = String(from.code || '');
      const fromName = String(from.name || 'A friend').slice(0, 40);
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      const room = String(body.room || '').toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(room)) return json({ error: 'bad room' }, 400, cors);
      const inv = {
        room,
        from: { code: fromCode, name: fromName },
        title: String(body.title || '').slice(0, 200),
        img: String(body.img || '').slice(0, 400),
        at: Date.now(),
      };
      // Six hours is far longer than any party lasts. It is a floor under the
      // read-side age check, so a key nobody clears still expires on its own.
      await env.LISTS.put('pinv:' + fromCode, JSON.stringify(inv), { expirationTtl: 21600 });
      return json({ ok: true }, 200, cors);
    }

    // Taking it down: you can only clear your own key, because the key IS your
    // code. Called when the party ends, so the row does not outlive the room.
    if (op === 'party_untell') {
      const fromCode = String((body.from && body.from.code) || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      await env.LISTS.delete('pinv:' + fromCode);
      return json({ ok: true }, 200, cors);
    }

    // ── read back what YOU sent ──────────────────────────────────────────────
    // Envelopes are filed under the RECIPIENT's code, which is what makes a
    // sender's own note unreadable to the sender: their app logs the titles it
    // sent, but the note travelled inside the envelope and stayed there. There
    // is no way to scan KV for "everything from this person", and there should
    // not be — but a sender already knows exactly which mailboxes and which
    // envelope ids are theirs, so they can ask for one at a time.
    //
    // The gate is the envelope's own `from.code`. Knowing a recipient's code and
    // an envelope id is not enough: the envelope has to say you sent it. That is
    // the same fact the recipient's app already shows them, so this reveals
    // nothing to a sender they did not write themselves.
    if (op === 'rec_peek') {
      const to = String(body.to || '');
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      const fromCode = String(from.code || '');
      const id = String(body.id || '').slice(0, 64);
      if (!/^[A-Za-z0-9]{10,64}$/.test(to)) return json({ error: 'bad to' }, 400, cors);
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      if (!id) return json({ error: 'bad id' }, 400, cors);
      let list = [];
      try { const s = await env.LISTS.get('rec:' + to); if (s) list = JSON.parse(s); } catch {}
      if (!Array.isArray(list)) list = [];
      const env0 = list.find(e => e && e.id === id && e.from && e.from.code === fromCode);
      // Gone is a normal answer, not an error: they may have dealt with it, or it
      // may have aged out of the last 200.
      if (!env0) return json({ ok: true, gone: true }, 200, cors);
      return json({
        ok: true,
        at: env0.at || 0,
        items: (env0.items || []).map(it => ({ title: it.title || '', aniId: it.aniId || 0, img: it.img || '', note: it.note || '' })),
      }, 200, cors);
    }

    // ── shared source setups ─────────────────────────────────────────────────
    // Someone who has their streaming site working can hand that setup to a
    // friend instead of talking them through it. Same mailbox shape as rec_send:
    // it lands as a pending offer, and nothing is applied until they accept.
    if (op === 'src_send') {
      const to = String(body.to || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(to)) return json({ error: 'bad to' }, 400, cors);
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      const fromCode = String(from.code || '');
      const fromName = String(from.name || 'A friend').slice(0, 40);
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      const p = (body.pack && typeof body.pack === 'object') ? body.pack : {};
      const str = (v, n) => String(v == null ? '' : v).slice(0, n);
      const pack = {
        src: str(p.src, 400),
        slugPref: ['romaji', 'english'].includes(String(p.slugPref)) ? String(p.slugPref) : '',
        services: (Array.isArray(p.services) ? p.services : []).slice(0, 30)
          .map(x => ({ name: str(x && x.name, 60), url: str(x && x.url, 400) }))
          .filter(x => x.name && /^https?:\/\//i.test(x.url)),
        hidden: (Array.isArray(p.hidden) ? p.hidden : []).slice(0, 60).map(x => str(x, 60)).filter(Boolean),
        // The learned material: links they taught it, and what this site calls
        // each show (keyed by AniList id). Bounded so a mailbox entry stays small.
        examples: (Array.isArray(p.examples) ? p.examples : []).slice(0, 8)
          .map(x => ({ url: str(x && x.url, 400), note: str(x && x.note, 80) }))
          .filter(x => /^https?:\/\//i.test(x.url)),
        host: str(p.host, 120).toLowerCase(),
        slugs: (() => {
          const src = (p.slugs && typeof p.slugs === 'object') ? p.slugs : {};
          const out = {};
          let n = 0;
          for (const k of Object.keys(src)) {
            if (n >= 400) break;
            if (!/^\d{1,9}$/.test(k)) continue;
            const v = str(src[k], 120);
            if (!v) continue;
            out[k] = v; n++;
          }
          return out;
        })(),
      };
      if (!pack.src && !pack.services.length) return json({ error: 'empty pack' }, 400, cors);
      const key = 'src:' + to;
      let list = [];
      try { const s2 = await env.LISTS.get(key); if (s2) list = JSON.parse(s2); } catch {}
      if (!Array.isArray(list)) list = [];
      list = list.filter(e => !(e && e.from && e.from.code === fromCode));   // one pending offer per sender
      const envelope = { id: fromCode.slice(0, 8) + Date.now().toString(36), from: { code: fromCode, name: fromName }, pack, at: Date.now() };
      list.push(envelope);
      if (list.length > 40) list = list.slice(list.length - 40);
      await env.LISTS.put(key, JSON.stringify(list));
      ctx.waitUntil(notifyChan(env, to, 'src', envelope));
      return json({ ok: true }, 200, cors);
    }

    // ── a shareable setup link ───────────────────────────────────────────────
    // Publishing to a short code means a setup can be handed to ANYONE — a text
    // message, a Discord line — with no friend request first. Read-only and
    // opaque: the code reveals nothing about who made it.
    if (op === 'src_pub') {
      const p2 = (body.pack && typeof body.pack === 'object') ? body.pack : {};
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      if (!p2.src && !(Array.isArray(p2.services) && p2.services.length)) return json({ error: 'empty pack' }, 400, cors);
      const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';                 // no look-alikes
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      let code = '';
      for (const b of bytes) code += A[b % A.length];
      await env.LISTS.put('pub:' + code, JSON.stringify({
        pack: p2,
        from: { name: String(from.name || 'A friend').slice(0, 40) },
        at: Date.now(),
      }), { expirationTtl: 60 * 60 * 24 * 180 });                  // 6 months
      return json({ ok: true, code }, 200, cors);
    }

    if (op === 'src_get') {
      const code = String(body.code || '').toUpperCase();
      if (!/^[A-Z0-9]{6,16}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
      let rec = null;
      try { const s2 = await env.LISTS.get('pub:' + code); if (s2) rec = JSON.parse(s2); } catch {}
      if (!rec) return json({ error: 'not found' }, 404, cors);
      return json({ ok: true, pack: rec.pack, from: rec.from, at: rec.at }, 200, cors);
    }

    if (op === 'src_pull') {
      const code = String(body.code || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
      let list = [];
      try { const s2 = await env.LISTS.get('src:' + code); if (s2) list = JSON.parse(s2); } catch {}
      if (!Array.isArray(list)) list = [];
      return json({ packs: list }, 200, cors);
    }

    // Accepting or dismissing clears the offer, so it doesn't ask again.
    if (op === 'src_clear') {
      const code = String(body.code || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
      const id = String(body.id || '');
      let list = [];
      try { const s2 = await env.LISTS.get('src:' + code); if (s2) list = JSON.parse(s2); } catch {}
      if (!Array.isArray(list)) list = [];
      list = id ? list.filter(e => e && e.id !== id) : [];
      await env.LISTS.put('src:' + code, JSON.stringify(list));
      return json({ ok: true }, 200, cors);
    }

    // Unsend. A recommendation is a message sitting in someone's mailbox, so it
    // can be taken back out — but only by whoever put it there: the sender's own
    // code has to match the envelope's, which is the same trust model rec_send
    // already uses. Silent about whether anything matched, so this can't be used
    // to probe another person's mailbox.
    if (op === 'rec_unsend') {
      const to = String(body.to || '');
      const fromCode = String((body.from && body.from.code) || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(to)) return json({ error: 'bad to' }, 400, cors);
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      const id = String(body.id || '');
      const key = 'rec:' + to;
      let list = [];
      try { const s2 = await env.LISTS.get(key); if (s2) list = JSON.parse(s2); } catch {}
      if (!Array.isArray(list)) list = [];
      const before = list.length;
      list = list.filter(e => {
        if (!e || !e.from || e.from.code !== fromCode) return true;   // never touch anyone else's
        return id ? e.id !== id : false;                              // no id → withdraw all of mine
      });
      if (list.length !== before) await env.LISTS.put(key, JSON.stringify(list));
      ctx.waitUntil(notifyChan(env, to, 'rec', { removed: true }));   // so their app refreshes
      return json({ ok: true, removed: before - list.length }, 200, cors);
    }

    // Your mailbox in one call: what people sent you, and what they made of what
    // you sent them. Passes ride along on the pull the app already makes.
    if (op === 'rec_pull') {
      const code = String(body.code || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
      let list = [];
      try { const s = await env.LISTS.get('rec:' + code); if (s) list = JSON.parse(s); } catch {}
      if (!Array.isArray(list)) list = [];
      let passes = [];
      try { const p = await env.LISTS.get('pass:' + code); if (p) passes = JSON.parse(p); } catch {}
      if (!Array.isArray(passes)) passes = [];
      let echoes = [];
      try { const e = await env.LISTS.get('echo:' + code); if (e) echoes = JSON.parse(e); } catch {}
      if (!Array.isArray(echoes)) echoes = [];
      // Party rows ride along on the pull the app already makes, so a friend's
      // party costs no extra round trip from the phone. The caller names the
      // codes to check — which can only be friends it already holds — and each
      // is one cheap read against that host's own key.
      //
      // Anything older than three hours is dropped on the way out: a stale row
      // saying "join" that leads to a dead room is worse than no row at all,
      // and the host may have closed the tab without ever clearing it.
      let parties = [];
      const want = (Array.isArray(body.friends) ? body.friends : [])
        .map(c => String(c || '')).filter(c => /^[A-Za-z0-9]{10,64}$/.test(c) && c !== code)
        .slice(0, 60);
      if (want.length) {
        const cutoff = Date.now() - 3 * 3600 * 1000;
        const got = await Promise.all(want.map(async c => {
          try { const v = await env.LISTS.get('pinv:' + c, { cacheTtl: 60 }); return v ? JSON.parse(v) : null; }
          catch { return null; }
        }));
        parties = got.filter(x => x && x.room && Number(x.at) > cutoff);
      }
      return json({ recs: list, passes, echoes, parties }, 200, cors);
    }

    // ── passing on a recommendation ──────────────────────────────────────────
    // Turning one down is an answer, and the sender is the one person entitled to
    // hear it. It files under THEIR code, carries only the show they already sent,
    // and never pushes — it waits in their sent list until they look. A quiet
    // answer, not a callout.
    if (op === 'rec_pass') {
      const to = String(body.to || '');
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      const fromCode = String(from.code || '');
      const fromName = String(from.name || 'A friend').slice(0, 40);
      if (!/^[A-Za-z0-9]{10,64}$/.test(to)) return json({ error: 'bad to' }, 400, cors);
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      const title = String(body.title || '').slice(0, 200);
      const aniId = Number(body.aniId) || 0;
      if (!title && !aniId) return json({ error: 'no show' }, 400, cors);
      const key = 'pass:' + to;
      let list = [];
      try { const s = await env.LISTS.get(key); if (s) list = JSON.parse(s); } catch {}
      if (!Array.isArray(list)) list = [];
      // One pass per friend per show — hiding it twice isn't two answers.
      const same = p => p && p.from && p.from.code === fromCode &&
        (aniId ? p.aniId === aniId : String(p.title || '').toLowerCase() === title.toLowerCase());
      list = list.filter(p => !same(p));
      list.push({ from: { code: fromCode, name: fromName }, title, aniId, at: Date.now() });
      if (list.length > 200) list = list.slice(list.length - 200);
      await env.LISTS.put(key, JSON.stringify(list));
      ctx.waitUntil(notifyChan(env, to, 'pass', { title }));
      return json({ ok: true }, 200, cors);
    }

    // ── what became of it ───────────────────────────────────────────────────
    // Recommending something and never hearing another word about it is the
    // dullest possible version of sharing. A pass already travels back; so should
    // the good news — added, started, finished — and a note written by hand when
    // they have something to say about it.
    //
    // Same shape and the same manners as a pass: filed under the RECOMMENDER's
    // code, carrying only the show they themselves sent, never pushed. One entry
    // per friend per show per kind, so 'started' cannot arrive twice; notes are
    // the exception, because two things said are two things said.
    if (op === 'rec_echo') {
      const to = String(body.to || '');
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      const fromCode = String(from.code || '');
      const fromName = String(from.name || 'A friend').slice(0, 40);
      const kind = String(body.kind || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(to)) return json({ error: 'bad to' }, 400, cors);
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      if (!['added', 'started', 'finished', 'dropped', 'note'].includes(kind)) return json({ error: 'bad kind' }, 400, cors);
      const title = String(body.title || '').slice(0, 200);
      const aniId = Number(body.aniId) || 0;
      if (!title && !aniId) return json({ error: 'no show' }, 400, cors);
      const note = String(body.note || '').slice(0, 500);
      if (kind === 'note' && !note) return json({ error: 'empty note' }, 400, cors);
      const key = 'echo:' + to;
      let list = [];
      try { const s2 = await env.LISTS.get(key); if (s2) list = JSON.parse(s2); } catch {}
      if (!Array.isArray(list)) list = [];
      const sameShow = e => e && e.from && e.from.code === fromCode &&
        (aniId ? e.aniId === aniId : String(e.title || '').toLowerCase() === title.toLowerCase());
      if (kind !== 'note') list = list.filter(e => !(sameShow(e) && e.kind === kind));
      list.push({ from: { code: fromCode, name: fromName }, title, aniId, kind, note, at: Date.now() });
      if (list.length > 200) list = list.slice(list.length - 200);
      await env.LISTS.put(key, JSON.stringify(list));
      // The show travels, the person does not: the name is already in the pull,
      // and this is what a notification would be built from.
      ctx.waitUntil(notifyChan(env, to, 'echo', { title, kind }));
      return json({ ok: true }, 200, cors);
    }

    // ── friend requests (mutual) ─────────────────────────────────────────────
    // Adding a friend sends a REQUEST to their code's frq:<code> mailbox. They
    // accept → we post an 'accept' back to the requester's mailbox so BOTH sides
    // become friends. Same shape for request/accept: {type, from:{code,name}}.
    if (op === 'fr_send' || op === 'fr_accept') {
      const to = String(body.to || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(to)) return json({ error: 'bad to' }, 400, cors);
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      const fromCode = String(from.code || '');
      const fromName = String(from.name || 'A friend').slice(0, 40);
      if (!/^[A-Za-z0-9]{10,64}$/.test(fromCode)) return json({ error: 'bad from' }, 400, cors);
      if (fromCode === to) return json({ error: 'self' }, 400, cors);
      const key = 'frq:' + to;
      let list = [];
      try { const s = await env.LISTS.get(key); if (s) list = JSON.parse(s); } catch {}
      if (!Array.isArray(list)) list = [];
      const type = op === 'fr_accept' ? 'accept' : 'request';
      // de-dupe: one live message of each type per (from → to)
      list = list.filter(m => !(m && m.type === type && m.from && m.from.code === fromCode));
      // Accepting also settles the request that prompted it. Left in place, that
      // request sits in the accepter's mailbox forever and can resurface as a
      // pending invite between two people who are already friends.
      if (type === 'accept') {
        const mine = 'frq:' + fromCode;
        try {
          const s2 = await env.LISTS.get(mine);
          if (s2) {
            const l2 = JSON.parse(s2);
            if (Array.isArray(l2)) {
              const pruned = l2.filter(m => !(m && m.type === 'request' && m.from && m.from.code === to));
              if (pruned.length !== l2.length) await env.LISTS.put(mine, JSON.stringify(pruned));
            }
          }
        } catch {}
      }
      const message = { id: type[0] + fromCode.slice(0, 8) + Date.now().toString(36), type, from: { code: fromCode, name: fromName }, at: Date.now() };
      list.push(message);
      if (list.length > 200) list = list.slice(list.length - 200);
      await env.LISTS.put(key, JSON.stringify(list));
      ctx.waitUntil(notifyChan(env, to, 'fr', message));
      return json({ ok: true }, 200, cors);
    }
    // ── watch-party invite ──────────────────────────────────────
    // Live invite to your party code, pushed to a friend's channel. Real-time
    // only — an invite that lands after you've left the party is stale anyway.
    if (op === 'party_invite') {
      const to = String(body.to || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(to)) return json({ error: 'bad to' }, 400, cors);
      const from = (body.from && typeof body.from === 'object') ? body.from : {};
      const fromCode = String(from.code || '');
      const fromName = String(from.name || 'A friend').slice(0, 40);
      const party = String(body.party || '').slice(0, 12);
      if (!party) return json({ error: 'no party' }, 400, cors);
      ctx.waitUntil(notifyChan(env, to, 'party_invite', { from: { code: fromCode, name: fromName }, party }));
      return json({ ok: true }, 200, cors);
    }
    if (op === 'fr_pull') {
      const code = String(body.code || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
      let list = [];
      try { const s = await env.LISTS.get('frq:' + code); if (s) list = JSON.parse(s); } catch {}
      if (!Array.isArray(list)) list = [];
      return json({ reqs: list }, 200, cors);
    }

    return json({ error: 'bad op' }, 400, cors);
  },
};

// Push to a user's live channel (best-effort): carries the actual new item so the
// client shows it instantly without waiting on KV to become globally consistent.
async function notifyChan(env, code, kind, data) {
  try {
    const body = JSON.stringify({ kind: kind || 'ping', data: data || null });
    await env.CHAN.get(env.CHAN.idFromName(code)).fetch(new Request('https://chan/notify', { method: 'POST', body }));
  } catch (e) {}
}

// ── USER CHANNEL (Durable Object) ───────────────────────────────────────────
// One instance per friend code. Holds that user's open WebSocket(s). When a
// friend request / recommendation lands for them, the worker POSTs /notify here
// and we push a tiny message ("rec"/"fr") to every socket, so the app refreshes
// instantly. No stored state — just the live connections.
export class UserChannel {
  constructor(state, env) {
    this.state = state;
    // The client pings every 25s to hold the socket open. Answered by the
    // runtime itself, so a keepalive never wakes this object at all.
    try { this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('p', 'pong')); } catch (e) {}
  }
  async fetch(request) {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      // HIBERNATABLE, and this is the whole ballgame. server.accept() keeps the
      // Durable Object resident — and therefore billing DURATION — for as long
      // as anyone holds the socket open. This channel is opened by every app on
      // launch and reconnects automatically, so a handful of people with
      // WatchList open was enough to bill wall-clock time all day and blow the
      // free tier's 13,000 GB-s. acceptWebSocket lets it sleep between messages
      // and pay for nothing while idle; the socket stays connected either way.
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    const msg = (await request.text()) || 'ping';
    const socks = this.state.getWebSockets();
    // Presence probe. An open socket IS the presence signal, so there is nothing
    // to store, nothing to expire and nothing to go stale.
    if (msg === '__probe__') return new Response(JSON.stringify({ online: socks.length > 0 }), { headers: { 'Content-Type': 'application/json' } });
    for (const s of socks) {
      try { s.send(msg); } catch (e) {}
    }
    return new Response('ok');
  }
  // Hibernation delivers these instead of addEventListener. The client only ever
  // sends keepalives, which the auto-response above already handles.
  async webSocketMessage(ws, msg) {}
  async webSocketClose(ws) { try { ws.close(); } catch (e) {} }
  async webSocketError(ws) { try { ws.close(); } catch (e) {} }
}

// ── PARTY ROOM (Durable Object) ─────────────────────────────────────────────
// One instance per code. Holds the room in memory + durable storage, and pushes
// state to every socket the instant anything changes. Presence = who's connected
// (a socket closing removes them immediately — no heartbeats, no stale lists).
export class PartyRoom {
  constructor(state, env) { this.state = state; this.env = env; this.room = null; }

  async getRoom() {
    if (!this.room) this.room = (await this.state.storage.get('room')) || null;
    return this.room;
  }
  async save() { await this.state.storage.put('room', this.room); }

  async fetch(request) {
    const url = new URL(request.url);
    const uid = (url.searchParams.get('uid') || '').slice(0, 40);
    const name = (url.searchParams.get('name') || 'Guest').replace(/[<>]/g, '').slice(0, 24) || 'Guest';
    const create = url.searchParams.get('create') === '1';
    const code = (url.pathname.split('/').pop() || '').toUpperCase();
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (!uid) return new Response('no uid', { status: 400 });

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server, [uid]);            // hibernatable, tagged by uid
    server.serializeAttachment({ uid, name });

    let room = await this.getRoom();
    if (!room) {
      if (!create) { server.send(JSON.stringify({ t: 'error', msg: 'no such party' })); server.close(4404, 'no room'); return new Response(null, { status: 101, webSocket: client }); }
      room = this.room = { code, host: uid, title: '', animeId: '', ep: 0, img: '', playAt: 0, paused: false, sharing: '', members: {}, chat: [], reacts: [], queue: [], voice: {}, rev: 1 };
      this.sys(room, `${name} started the party`);
    }
    const fresh = !room.members[uid];
    room.members[uid] = { name };
    if (fresh && !create) this.sys(room, `${name} joined`);
    try { await this.state.storage.deleteAlarm(); } catch (e) {}   // someone's back → cancel the pending empty-room cleanup
    room.rev++;
    await this.save();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    const uid = att.uid, name = att.name || 'Guest';
    const room = await this.getRoom(); if (!room) return;
    const isHost = room.host === uid;

    switch (msg.t) {
      case 'chat': {
        const text = String(msg.msg || '').slice(0, 300).trim();
        if (text) { room.chat.push({ id: room.rev + '-' + Date.now(), uid, name, msg: text, t: Date.now() }); this.cap(room); room.rev++; await this.save(); this.broadcast(); }
        return;
      }
      case 'react': {
        const emoji = String(msg.emoji || '').slice(0, 8);
        // Reactions are transient confetti (8s life). Don't persist them to durable
        // storage and don't re-send the whole room — just fan out a tiny {t:'react'}.
        // That removes a disk write + a full-state broadcast from every single tap.
        if (emoji) { const rc = { id: uid + '-' + Date.now() + '-' + ((Math.random() * 1e4) | 0), emoji, uid, t: Date.now() }; room.reacts = (room.reacts || []).filter(r => Date.now() - r.t < 8000); room.reacts.push(rc); if (room.reacts.length > 24) room.reacts = room.reacts.slice(-24); this.broadcastReact(rc); }
        return;
      }
      case 'typing': {   // transient "X is typing…" — relay to everyone else, never persisted
        const s = JSON.stringify({ t: 'typing', uid, name });
        for (const w of this.state.getWebSockets()) { if (w !== ws) { try { w.send(s); } catch {} } }
        return;
      }
      case 'set': {
        if (!isHost) return;
        room.title = String(msg.title || '').slice(0, 160); room.animeId = String(msg.animeId || '').slice(0, 40);
        room.ep = Math.max(0, Math.min(9999, parseInt(msg.ep, 10) || 0)); room.img = String(msg.img || '').slice(0, 400);
        room.playAt = 0; room.paused = false; this.clearFlags(room);
        this.sys(room, `Now watching ${room.title}${room.ep ? ' · Ep ' + room.ep : ''}`); room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'play': { if (!isHost) return; room.playAt = Date.now() + 3600; room.paused = false; this.clearFlags(room); this.sys(room, '▶ Starting in 3…'); room.rev++; await this.save(); this.broadcast(); return; }
      case 'pause': { if (!isHost) return; room.paused = true; room.playAt = 0; this.sys(room, `⏸ ${name} paused`); room.rev++; await this.save(); this.broadcast(); return; }
      case 'queue-add': {   // anyone may queue a pick for later
        const title = String(msg.title || '').slice(0, 160); if (!title) return;
        room.queue = room.queue || []; if (room.queue.length >= QUEUE_CAP) return;
        // aniId travels with the item: animeId is the queuer's LOCAL list id and
        // means nothing on anyone else's device, so without it the rest of the
        // party can't match a queued show to their own copy (and its pinned link).
        room.queue.push({ id: uid + '-' + Date.now(), title, animeId: String(msg.animeId || '').slice(0, 40), aniId: Math.max(0, parseInt(msg.aniId, 10) || 0), ep: Math.max(0, Math.min(9999, parseInt(msg.ep, 10) || 0)), img: String(msg.img || '').slice(0, 400), by: name });
        this.sys(room, `${name} queued ${title}`); room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'queue-remove': {
        const qid = String(msg.qid || ''); const q = room.queue = room.queue || [];
        const i = q.findIndex(x => x.id === qid); if (i < 0) return;
        if (!isHost && !qid.startsWith(uid + '-')) return;   // host removes anything; others only their own
        q.splice(i, 1); room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'queue-move': {   // host reorders the up-next list
        if (!isHost) return;
        const q = room.queue = room.queue || [];
        const i = q.findIndex(x => x.id === String(msg.qid || ''));
        const j = i + (msg.dir === 'up' ? -1 : 1);
        if (i < 0 || j < 0 || j >= q.length) return;
        const t = q[i]; q[i] = q[j]; q[j] = t;
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'queue-vote': {   // anyone toggles a vote on a queued item (host decides using the counts)
        const q = room.queue = room.queue || [];
        const it = q.find(x => x.id === String(msg.qid || '')); if (!it) return;
        it.votes = it.votes || [];
        const k = it.votes.indexOf(uid);
        if (k >= 0) it.votes.splice(k, 1); else it.votes.push(uid);
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'host-set': {   // hand host to another member
        if (!isHost) return;
        const to = String(msg.to || ''); if (!to || !room.members[to]) return;
        room.host = to; this.sys(room, `${room.members[to].name} is now host`);
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'kick': {   // host removes a member and disconnects them
        if (!isHost) return;
        const target = String(msg.uid || ''); if (!target || target === uid || !room.members[target]) return;
        const nm = room.members[target].name; delete room.members[target];
        if (room.sharing === target) room.sharing = '';
        this.sys(room, `${nm} was removed`);
        this.sendTo(target, { t: 'error', msg: 'The host removed you from the party.' });
        for (const w of this.state.getWebSockets(target)) { try { w.close(1000, 'removed'); } catch {} }
        room.rev++; await this.save(); this.broadcast(); return;
      }
      // Re-sync: the host restarts the countdown on whatever is already playing,
      // so a party that has drifted apart lines back up without changing show.
      // Host's playback position, relayed to everyone else. Tiny and frequent —
      // it carries a timestamp and a state, never media.
      case 'ytsync': {
        if (!isHost) return;
        const at = Math.max(0, Math.min(86400, Number(msg.at) || 0));
        const playing = !!msg.playing;
        this.broadcastRaw({ t: 'ytsync', at, playing, vid: String(msg.vid || '').slice(0, 24), sentAt: Date.now() }, uid);
        return;
      }
      // The same idea as ytsync, but for a real streaming site. Only the app can
      // produce or act on this — it comes from a probe inside the playing frame —
      // so the room just relays it. Host only, bounded, and it carries a position
      // and a timestamp, never media and never a URL.
      case 'psync': {
        if (!isHost) return;
        const t2 = Math.max(0, Math.min(86400, Number(msg.t2) || 0));
        const ep = Math.max(0, Math.min(100000, Number(msg.ep) || 0));
        this.broadcastRaw({ t: 'psync', t2, ep, paused: !!msg.paused, sent: Date.now() }, uid);
        return;
      }
      // Two things a member says about themselves, because on the web nobody else
      // can see them. The room cannot read a cross-origin player, so "are you
      // ready" and "are you buffering" are answers only the person sitting there
      // can give — and without a way to give them, the host is guessing.
      case 'ready': {
        room.members[uid].ready = !!msg.on;
        if (msg.on) room.members[uid].wait = false;   // saying you're ready cancels holding everyone up
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'wait': {
        room.members[uid].wait = !!msg.on;
        if (msg.on) room.members[uid].ready = false;
        this.sys(room, msg.on ? `${name} needs a moment` : `${name} is good to go`);
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'resync': {
        // ANYONE may ask. Being out of sync is the one problem only the person
        // suffering it can see, and host-gating it meant saying so out loud and
        // hoping the host was listening. Everyone restarts together either way,
        // so a viewer asking costs the room the same three seconds a host does.
        room.paused = false;
        room.playAt = Date.now() + 3600;
        this.sys(room, isHost ? '▶ Re-syncing — pause and get ready'
                              : `▶ ${name} was out of sync — everyone gets ready`);
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'queue-next': {   // host advances the party to the first queued item + fires the 3·2·1
        if (!isHost) return;
        const next = (room.queue = room.queue || []).shift(); if (!next) return;
        room.title = next.title; room.animeId = next.animeId; room.aniId = next.aniId || 0; room.ep = next.ep; room.img = next.img;
        room.playAt = 0; room.paused = false;
        this.sys(room, `Now watching ${room.title}${room.ep ? ' · Ep ' + room.ep : ''}`);
        room.playAt = Date.now() + 3600; this.sys(room, '▶ Starting in 3…');
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'share': { room.sharing = msg.on ? uid : (room.sharing === uid ? '' : room.sharing); this.sys(room, msg.on ? `${name} started screen sharing` : `${name} stopped sharing`); room.rev++; await this.save(); this.broadcast(); return; }   // the broadcaster flags itself as the sharer — on iOS the ReplayKit extension joins under its own uid (not the room host), so a host-only gate would silently drop its "share" and viewers would never see the broadcast start
      case 'voice': {   // join/leave the voice channel; the audio itself is P2P (mesh), this just tracks presence
        room.voice = room.voice || {};
        if (msg.on) { if (!room.voice[uid]) { room.voice[uid] = 1; this.sys(room, `${name} joined voice chat`); } }
        else { if (room.voice[uid]) { delete room.voice[uid]; this.sys(room, `${name} left voice chat`); } }
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'signal': {
        const to = String(msg.to || ''); if (!to) return;
        this.sendTo(to, { t: 'signal', from: uid, kind: msg.kind, data: msg.data });
        return;
      }
      case 'pb': {   // precise playback state from the host's browser extension → relay to the rest
        if (!isHost) return;
        const s = JSON.stringify({ t: 'pb', playing: !!msg.playing, time: +msg.time || 0, ts: Date.now() });
        for (const w of this.state.getWebSockets()) { if (w !== ws) { try { w.send(s); } catch {} } }
        return;
      }
    }
  }

  async webSocketClose(ws) { await this.dropSocket(ws); }
  async webSocketError(ws) { await this.dropSocket(ws); }

  async dropSocket(ws) {
    const att = ws.deserializeAttachment() || {};
    const uid = att.uid; const room = await this.getRoom(); if (!room || !uid) return;
    // only drop the member if they have no other live sockets
    const stillOpen = this.state.getWebSockets(uid).filter(s => s !== ws && s.readyState === WebSocket.OPEN).length;
    if (stillOpen) return;
    if (room.members[uid]) { this.sys(room, `${room.members[uid].name} left`); delete room.members[uid]; }
    if (room.sharing === uid) room.sharing = '';
    if (room.voice) delete room.voice[uid];
    if (room.host === uid) { const rest = Object.keys(room.members); if (rest.length) { room.host = rest[0]; this.sys(room, `${room.members[rest[0]].name} is now host`); } }
    room.rev++;
    if (Object.keys(room.members).length) { await this.save(); this.broadcast(); }
    else { await this.save(); await this.state.storage.setAlarm(Date.now() + 300000); }   // empty → hold the room 5 min so a lock/reconnect can rejoin the same code; alarm() deletes it if still empty
  }
  // Grace period elapsed: only now do we actually discard the room, and only if no one
  // came back. This is what lets a party survive both phones auto-locking at once.
  async alarm() {
    const room = await this.getRoom();
    if (!room || !Object.keys(room.members || {}).length) { await this.state.storage.deleteAll(); this.room = null; }
  }

  cap(room) { if (room.chat.length > CHAT_CAP) room.chat = room.chat.slice(-CHAT_CAP); }
  sys(room, msg) { room.chat.push({ id: 's-' + Date.now() + '-' + ((Math.random() * 1e6) | 0), sys: true, msg, t: Date.now() }); this.cap(room); }
  view() {
    const r = this.room;
    return { code: r.code, host: r.host, title: r.title, animeId: r.animeId, ep: r.ep, img: r.img, playAt: r.playAt, paused: !!r.paused, sharing: r.sharing || '', queue: r.queue || [], voice: Object.keys(r.voice || {}),
      members: Object.entries(r.members).map(([uid, m]) => ({ uid, name: m.name, ready: !!m.ready, wait: !!m.wait })), chat: r.chat, reacts: (r.reacts || []).filter(x => Date.now() - x.t < 8000), rev: r.rev };
  }
  // `now` rides along with every room update. The countdown is a wall-clock
  // deadline (playAt), and a device whose clock is a few seconds out starts that
  // many seconds early or late — through no fault of the network. With the
  // server's own time in the same message, each client can measure its offset and
  // count down against the room's clock instead of its own.
  // Ready and wait describe one moment. Once the room moves on — a new pick, a
  // fresh start — they are stale, and a stale "ready" is worse than none because
  // the host reads it as current.
  clearFlags(room) { try { for (const m of Object.values(room.members || {})) { m.ready = false; m.wait = false; } } catch (e) {} }
  broadcast() { const s = JSON.stringify({ t: 'state', room: this.view(), now: Date.now() }); for (const ws of this.state.getWebSockets()) { try { ws.send(s); } catch {} } }
  broadcastReact(rc) { const s = JSON.stringify({ t: 'react', r: rc }); for (const ws of this.state.getWebSockets()) { try { ws.send(s); } catch {} } }
  sendTo(uid, obj) { const s = JSON.stringify(obj); for (const ws of this.state.getWebSockets(uid)) { try { ws.send(s); } catch {} } }
  // Straight to everyone but the sender, with no room-state write. Playback
  // position arrives several times a minute; persisting it would rewrite the
  // room object constantly for something nobody needs after the moment passes.
  broadcastRaw(obj, exceptUid) {
    const s = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      try { if (exceptUid && this.state.getTags(ws).includes(exceptUid)) continue; ws.send(s); } catch {}
    }
  }
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
