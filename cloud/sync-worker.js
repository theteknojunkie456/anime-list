// ── WatchList cloud sync + watch parties — Cloudflare Worker ────────────────
// Free, private, and completely separate from any other app.
//
// TWO features, one KV namespace (bound as LISTS):
//  • Sync — stores one list per long random "sync code". Read/write only if you
//    know the code; the Worker never lists codes or exposes anyone else's data.
//    Keys: list:<code>
//  • Watch parties — a short shareable room code lets friends watch together:
//    shared presence, a live chat, the host's current episode, and a synchronized
//    "3·2·1 play" cue. Playback itself isn't frame-synced (the app plays inside a
//    cross-origin frame it can't control) — this coordinates *around* it.
//    Keys: party:<CODE>   (auto-expire after a few hours of inactivity)
//
// Deploy: `wrangler deploy` (the same worker you already run for sync).

const PARTY_TTL = 6 * 60 * 60;          // room lives 6h past its last activity
const PRESENT_MS = 15 * 1000;           // a member seen within 15s counts as "here"
const CHAT_CAP = 60;                    // keep only the most recent messages
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no ambiguous 0/O/1/I/L

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
    const op = String(body.op || '');

    // ── list sync (long secret code) ──────────────────────────────────────
    if (op === 'pull' || op === 'push') {
      const code = String(body.code || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
      const key = 'list:' + code;
      if (op === 'pull') {
        const stored = await env.LISTS.get(key);
        return json(stored ? JSON.parse(stored) : { data: null, updatedAt: 0 }, 200, cors);
      }
      const payload = JSON.stringify({ data: body.data ?? null, updatedAt: Date.now() });
      if (payload.length > 3_000_000) return json({ error: 'too big' }, 413, cors);
      await env.LISTS.put(key, payload);
      return json({ ok: true, updatedAt: Date.now() }, 200, cors);
    }

    // ── watch parties (short room code) ───────────────────────────────────
    if (op.startsWith('party-')) return handleParty(op, body, env, cors);

    return json({ error: 'bad op' }, 400, cors);
  },
};

async function handleParty(op, body, env, cors) {
  const uid = String(body.uid || '').slice(0, 40);
  const name = String(body.name || 'Guest').replace(/[<>]/g, '').slice(0, 24) || 'Guest';
  if (!uid) return json({ error: 'no uid' }, 400, cors);

  // create: mint a fresh code and seat the creator as host
  if (op === 'party-create') {
    let code, existing, tries = 0;
    do { code = mintCode(); existing = await env.LISTS.get('party:' + code); }
    while (existing && ++tries < 6);
    const room = {
      code, host: uid, title: '', animeId: '', ep: 0, img: '', playAt: 0, sharing: '',
      members: { [uid]: { name, seen: Date.now() } }, chat: [], signals: [], rev: 1,
    };
    sysMsg(room, `${name} started the party`);
    await saveRoom(env, room);
    return json({ ok: true, room: view(room), host: true }, 200, cors);
  }

  const code = String(body.code || '').toUpperCase();
  if (!/^[A-Z0-9]{5,8}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
  const room = await loadRoom(env, code);
  if (!room) return json({ error: 'no such party' }, 404, cors);
  const isHost = room.host === uid;

  if (op === 'party-join') {
    const fresh = !room.members[uid];
    room.members[uid] = { name, seen: Date.now() };
    if (fresh) sysMsg(room, `${name} joined`);
    room.rev++;
    await saveRoom(env, room);
    return json({ ok: true, room: view(room), host: isHost }, 200, cors);
  }

  if (op === 'party-poll') {
    // heartbeat — only write when the last-seen is stale, to spare KV writes
    const m = room.members[uid], now = Date.now();
    if (!m || now - (m.seen || 0) > 5000) {
      room.members[uid] = { name: (m && m.name) || name, seen: now };
      await saveRoom(env, room);
    }
    const signals = (room.signals || []).filter(s => s.to === uid);   // WebRTC messages for me
    return json({ ok: true, room: view(room), host: isHost, signals }, 200, cors);
  }

  if (op === 'party-set') {           // host chooses the current title/episode
    if (!isHost) return json({ error: 'host only' }, 403, cors);
    room.title = String(body.title || '').slice(0, 160);
    room.animeId = String(body.animeId || '').slice(0, 40);
    room.ep = Math.max(0, Math.min(9999, parseInt(body.ep, 10) || 0));
    room.img = String(body.img || '').slice(0, 400);
    room.playAt = 0;
    sysMsg(room, `Now watching ${room.title}${room.ep ? ' · Ep ' + room.ep : ''}`);
    room.rev++;
    await saveRoom(env, room);
    return json({ ok: true, room: view(room) }, 200, cors);
  }

  if (op === 'party-play') {          // host fires the 3·2·1 start cue
    if (!isHost) return json({ error: 'host only' }, 403, cors);
    room.playAt = Date.now() + 3600;
    sysMsg(room, `Starting in 3…`);
    room.rev++;
    await saveRoom(env, room);
    return json({ ok: true, room: view(room) }, 200, cors);
  }

  // screen-share broadcaster on/off (desktop host)
  if (op === 'party-share') {
    if (!isHost) return json({ error: 'host only' }, 403, cors);
    room.sharing = body.on ? uid : '';
    if (!body.on) room.signals = [];
    sysMsg(room, body.on ? `${name} started screen sharing` : `${name} stopped sharing`);
    room.rev++; await saveRoom(env, room);
    return json({ ok: true, room: view(room) }, 200, cors);
  }

  // WebRTC signaling relay: one small mailbox of offer/answer messages, addressed
  // peer-to-peer. Consumers dedupe by id; entries auto-expire so it can't grow.
  if (op === 'party-signal') {
    const to = String(body.to || ''), kind = String(body.kind || '');
    if (to && kind) {
      room.signals = (room.signals || []).filter(s => Date.now() - s.t < 90000);
      room.signals.push({ id: uid + '-' + to + '-' + kind + '-' + Date.now(), from: uid, to, kind, data: body.data, t: Date.now() });
      room.rev++; await saveRoom(env, room);
    }
    return json({ ok: true }, 200, cors);
  }

  if (op === 'party-chat') {
    const msg = String(body.msg || '').slice(0, 300).trim();
    if (msg) {
      room.members[uid] = { name, seen: Date.now() };
      room.chat.push({ id: room.rev + '-' + Date.now(), uid, name, msg, t: Date.now() });
      if (room.chat.length > CHAT_CAP) room.chat = room.chat.slice(-CHAT_CAP);
      room.rev++; await saveRoom(env, room);
    }
    return json({ ok: true, room: view(room) }, 200, cors);
  }

  if (op === 'party-leave') {
    if (room.members[uid]) { sysMsg(room, `${room.members[uid].name} left`); delete room.members[uid]; }
    if (isHost) {                     // host left → hand off to whoever's still here
      const rest = Object.keys(room.members);
      if (rest.length) { room.host = rest[0]; sysMsg(room, `${room.members[rest[0]].name} is now host`); }
    }
    room.rev++;
    if (Object.keys(room.members).length) await saveRoom(env, room);
    else await env.LISTS.delete('party:' + code);   // empty → drop it
    return json({ ok: true }, 200, cors);
  }

  return json({ error: 'bad party op' }, 400, cors);
}

function mintCode() { let s = ''; for (let i = 0; i < 6; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]; return s; }
function sysMsg(room, msg) { room.chat.push({ id: 's-' + Date.now() + '-' + ((Math.random() * 1e6) | 0), sys: true, msg, t: Date.now() }); if (room.chat.length > CHAT_CAP) room.chat = room.chat.slice(-CHAT_CAP); }
async function loadRoom(env, code) { const s = await env.LISTS.get('party:' + code); return s ? JSON.parse(s) : null; }
async function saveRoom(env, room) { await env.LISTS.put('party:' + room.code, JSON.stringify(room), { expirationTtl: PARTY_TTL }); }
// what clients see: present-only member list, everything else as-is
function view(room) {
  const now = Date.now();
  const members = Object.entries(room.members)
    .filter(([, m]) => now - (m.seen || 0) < PRESENT_MS)
    .map(([uid, m]) => ({ uid, name: m.name }));
  return { code: room.code, host: room.host, title: room.title, animeId: room.animeId,
    ep: room.ep, img: room.img, playAt: room.playAt, sharing: room.sharing || '', members, chat: room.chat, rev: room.rev };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
