// Unit tests for the PartyRoom "Up next" queue — run: node cloud/sync-worker.test.mjs
// Drives webSocketMessage() directly with a mocked DO state + sockets (no wrangler needed).
import assert from 'node:assert';
import { PartyRoom } from './sync-worker.js';

function mkRoom() {
  const state = {
    storage: {
      map: new Map(),
      async get(k) { return this.map.get(k); },
      async put(k, v) { this.map.set(k, v); },
      async deleteAll() { this.map.clear(); },
    },
    getWebSockets() { return []; },
  };
  const pr = new PartyRoom(state, {});
  pr.room = { code: 'ABCD', host: 'h1', title: '', animeId: '', ep: 0, img: '', playAt: 0, paused: false, sharing: '', members: { h1: { name: 'Hana' }, v1: { name: 'Vik' } }, chat: [], reacts: [], queue: [], rev: 1 };
  const ws = uid => ({ deserializeAttachment: () => ({ uid, name: pr.room.members[uid].name }) });
  return { pr, send: (uid, msg) => pr.webSocketMessage(ws(uid), JSON.stringify(msg)) };
}

// ── queue-add appends (anyone, not just the host) ───────────────────────────
{
  const { pr, send } = mkRoom();
  await send('v1', { t: 'queue-add', title: 'Frieren', animeId: 'a1', ep: 5, img: 'x.jpg' });
  await send('h1', { t: 'queue-add', title: 'Mushishi', animeId: 'a2', ep: 1, img: '' });
  assert.equal(pr.room.queue.length, 2);
  assert.equal(pr.room.queue[0].title, 'Frieren');
  assert.equal(pr.room.queue[0].by, 'Vik');
  assert.equal(pr.room.queue[0].ep, 5);
  assert.ok(pr.room.queue[0].id.startsWith('v1-'));
  assert.equal(pr.room.queue[1].title, 'Mushishi');
  await send('v1', { t: 'queue-add', title: '', animeId: 'a9', ep: 1, img: '' });   // no title → ignored
  assert.equal(pr.room.queue.length, 2);
  assert.deepEqual(pr.view().queue, pr.room.queue);                                 // queue is in the client view
  assert.deepEqual((await pr.state.storage.get('room')).queue, pr.room.queue);      // and persisted
  console.log('ok  queue-add appends (any member), validates, persists, in view()');
}

// ── queue-add caps at 30 ────────────────────────────────────────────────────
{
  const { pr, send } = mkRoom();
  for (let i = 0; i < 40; i++) await send('v1', { t: 'queue-add', title: 'T' + i, animeId: 'a' + i, ep: 1, img: '' });
  assert.equal(pr.room.queue.length, 30);
  assert.equal(pr.room.queue[0].title, 'T0');   // full queue refuses new adds — the head is untouched
  console.log('ok  queue-add caps at 30, keeps the head');
}

// ── queue-remove deletes by id ──────────────────────────────────────────────
{
  const { pr, send } = mkRoom();
  await send('v1', { t: 'queue-add', title: 'A', animeId: 'a1', ep: 1, img: '' });
  await send('h1', { t: 'queue-add', title: 'B', animeId: 'a2', ep: 2, img: '' });
  await send('h1', { t: 'queue-remove', qid: pr.room.queue[0].id });                // host removes anyone's
  assert.equal(pr.room.queue.length, 1);
  assert.equal(pr.room.queue[0].title, 'B');
  await send('v1', { t: 'queue-remove', qid: pr.room.queue[0].id });                // viewer can't remove others'
  assert.equal(pr.room.queue.length, 1);
  await send('v1', { t: 'queue-add', title: 'C', animeId: 'a3', ep: 3, img: '' });
  await send('v1', { t: 'queue-remove', qid: pr.room.queue[1].id });                // …but can remove their own
  assert.equal(pr.room.queue.length, 1);
  assert.equal(pr.room.queue[0].title, 'B');
  await send('h1', { t: 'queue-remove', qid: 'nope' });                             // unknown id → no-op
  assert.equal(pr.room.queue.length, 1);
  console.log('ok  queue-remove deletes by id (host: any; member: own only)');
}

// ── queue-next: host-only, advances current + removes head + fires the cue ──
{
  const { pr, send } = mkRoom();
  await send('v1', { t: 'queue-add', title: 'Frieren', animeId: 'a1', ep: 5, img: 'x.jpg' });
  await send('v1', { t: 'queue-add', title: 'Mushishi', animeId: 'a2', ep: 1, img: '' });
  await send('v1', { t: 'queue-next' });                                            // not host → ignored
  assert.equal(pr.room.title, '');
  assert.equal(pr.room.queue.length, 2);
  pr.room.paused = true;
  const before = Date.now();
  await send('h1', { t: 'queue-next' });
  assert.equal(pr.room.title, 'Frieren');
  assert.equal(pr.room.animeId, 'a1');
  assert.equal(pr.room.ep, 5);
  assert.equal(pr.room.img, 'x.jpg');
  assert.equal(pr.room.paused, false);
  assert.ok(pr.room.playAt >= before + 3600);                                       // 3·2·1 cue fired
  assert.equal(pr.room.queue.length, 1);
  assert.equal(pr.room.queue[0].title, 'Mushishi');
  assert.ok(pr.room.chat.some(c => c.sys && c.msg === 'Now watching Frieren · Ep 5'));
  await send('h1', { t: 'queue-next' });
  assert.equal(pr.room.title, 'Mushishi');
  assert.equal(pr.room.queue.length, 0);
  const t = pr.room.title;
  await send('h1', { t: 'queue-next' });                                            // empty queue → no-op
  assert.equal(pr.room.title, t);
  console.log('ok  queue-next is host-only, sets current title/ep, pops the head, starts 3·2·1');
}

// ── rooms persisted before the queue existed don't crash ────────────────────
{
  const { pr, send } = mkRoom();
  delete pr.room.queue;                                                             // legacy room shape
  assert.deepEqual(pr.view().queue, []);
  await send('h1', { t: 'queue-next' });                                            // no-op, no throw
  await send('v1', { t: 'queue-add', title: 'A', animeId: 'a1', ep: 1, img: '' });
  assert.equal(pr.room.queue.length, 1);
  console.log('ok  legacy rooms without a queue are handled');
}

console.log('\nAll PartyRoom queue tests passed.');
