// ── WatchList cloud sync + watch parties — Cloudflare Worker ────────────────
// Free, private, and completely separate from any other app.
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
      if (payload.length > 3_000_000) return json({ error: 'too big' }, 413, cors);
      await env.LISTS.put(key, payload);
      return json({ ok: true, updatedAt: Date.now() }, 200, cors);
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
      return json({ ok: true }, 200, cors);
    }
    if (op === 'rec_pull') {
      const code = String(body.code || '');
      if (!/^[A-Za-z0-9]{10,64}$/.test(code)) return json({ error: 'bad code' }, 400, cors);
      let list = [];
      try { const s = await env.LISTS.get('rec:' + code); if (s) list = JSON.parse(s); } catch {}
      if (!Array.isArray(list)) list = [];
      return json({ recs: list }, 200, cors);
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
      const message = { id: type[0] + fromCode.slice(0, 8) + Date.now().toString(36), type, from: { code: fromCode, name: fromName }, at: Date.now() };
      list.push(message);
      if (list.length > 200) list = list.slice(list.length - 200);
      await env.LISTS.put(key, JSON.stringify(list));
      ctx.waitUntil(notifyChan(env, to, 'fr', message));
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
  constructor(state, env) { this.state = state; this.sockets = new Set(); }
  async fetch(request) {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      server.accept();
      this.sockets.add(server);
      const drop = () => this.sockets.delete(server);
      server.addEventListener('close', drop);
      server.addEventListener('error', drop);
      // ignore anything the client sends (it only sends keepalive pings)
      return new Response(null, { status: 101, webSocket: client });
    }
    const msg = (await request.text()) || 'ping';
    for (const s of [...this.sockets]) {
      try { s.send(msg); } catch (e) { this.sockets.delete(s); }
    }
    return new Response('ok');
  }
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
      room = this.room = { code, host: uid, title: '', animeId: '', ep: 0, img: '', playAt: 0, paused: false, sharing: '', members: {}, chat: [], reacts: [], queue: [], rev: 1 };
      this.sys(room, `${name} started the party`);
    }
    const fresh = !room.members[uid];
    room.members[uid] = { name };
    if (fresh && !create) this.sys(room, `${name} joined`);
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
        if (emoji) { room.reacts = (room.reacts || []).filter(r => Date.now() - r.t < 8000); room.reacts.push({ id: uid + '-' + Date.now() + '-' + ((Math.random() * 1e4) | 0), emoji, uid, t: Date.now() }); if (room.reacts.length > 24) room.reacts = room.reacts.slice(-24); room.rev++; await this.save(); this.broadcast(); }
        return;
      }
      case 'set': {
        if (!isHost) return;
        room.title = String(msg.title || '').slice(0, 160); room.animeId = String(msg.animeId || '').slice(0, 40);
        room.ep = Math.max(0, Math.min(9999, parseInt(msg.ep, 10) || 0)); room.img = String(msg.img || '').slice(0, 400);
        room.playAt = 0; room.paused = false;
        this.sys(room, `Now watching ${room.title}${room.ep ? ' · Ep ' + room.ep : ''}`); room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'play': { if (!isHost) return; room.playAt = Date.now() + 3600; room.paused = false; this.sys(room, '▶ Starting in 3…'); room.rev++; await this.save(); this.broadcast(); return; }
      case 'pause': { if (!isHost) return; room.paused = true; room.playAt = 0; this.sys(room, `⏸ ${name} paused`); room.rev++; await this.save(); this.broadcast(); return; }
      case 'queue-add': {   // anyone may queue a pick for later
        const title = String(msg.title || '').slice(0, 160); if (!title) return;
        room.queue = room.queue || []; if (room.queue.length >= QUEUE_CAP) return;
        room.queue.push({ id: uid + '-' + Date.now(), title, animeId: String(msg.animeId || '').slice(0, 40), ep: Math.max(0, Math.min(9999, parseInt(msg.ep, 10) || 0)), img: String(msg.img || '').slice(0, 400), by: name });
        this.sys(room, `${name} queued ${title}`); room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'queue-remove': {
        const qid = String(msg.qid || ''); const q = room.queue = room.queue || [];
        const i = q.findIndex(x => x.id === qid); if (i < 0) return;
        if (!isHost && !qid.startsWith(uid + '-')) return;   // host removes anything; others only their own
        q.splice(i, 1); room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'queue-next': {   // host advances the party to the first queued item + fires the 3·2·1
        if (!isHost) return;
        const next = (room.queue = room.queue || []).shift(); if (!next) return;
        room.title = next.title; room.animeId = next.animeId; room.ep = next.ep; room.img = next.img;
        room.playAt = 0; room.paused = false;
        this.sys(room, `Now watching ${room.title}${room.ep ? ' · Ep ' + room.ep : ''}`);
        room.playAt = Date.now() + 3600; this.sys(room, '▶ Starting in 3…');
        room.rev++; await this.save(); this.broadcast(); return;
      }
      case 'share': { if (!isHost) return; room.sharing = msg.on ? uid : ''; this.sys(room, msg.on ? `${name} started screen sharing` : `${name} stopped sharing`); room.rev++; await this.save(); this.broadcast(); return; }
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
    if (room.host === uid) { const rest = Object.keys(room.members); if (rest.length) { room.host = rest[0]; this.sys(room, `${room.members[rest[0]].name} is now host`); } }
    room.rev++;
    if (Object.keys(room.members).length) { await this.save(); this.broadcast(); }
    else { await this.state.storage.deleteAll(); this.room = null; }   // empty → gone
  }

  cap(room) { if (room.chat.length > CHAT_CAP) room.chat = room.chat.slice(-CHAT_CAP); }
  sys(room, msg) { room.chat.push({ id: 's-' + Date.now() + '-' + ((Math.random() * 1e6) | 0), sys: true, msg, t: Date.now() }); this.cap(room); }
  view() {
    const r = this.room;
    return { code: r.code, host: r.host, title: r.title, animeId: r.animeId, ep: r.ep, img: r.img, playAt: r.playAt, paused: !!r.paused, sharing: r.sharing || '', queue: r.queue || [],
      members: Object.entries(r.members).map(([uid, m]) => ({ uid, name: m.name })), chat: r.chat, reacts: (r.reacts || []).filter(x => Date.now() - x.t < 8000), rev: r.rev };
  }
  broadcast() { const s = JSON.stringify({ t: 'state', room: this.view() }); for (const ws of this.state.getWebSockets()) { try { ws.send(s); } catch {} } }
  sendTo(uid, obj) { const s = JSON.stringify(obj); for (const ws of this.state.getWebSockets(uid)) { try { ws.send(s); } catch {} } }
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
