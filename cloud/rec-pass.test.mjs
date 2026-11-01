// Unit tests for passing on a recommendation — run: node cloud/rec-pass.test.mjs
// Drives the worker's fetch() directly with a mocked KV + channel (no wrangler needed).
import assert from 'node:assert';
import worker from './sync-worker.js';

const ME = 'aaaaaaaaaa1', THEM = 'bbbbbbbbbb2', OTHER = 'cccccccccc3';

function mkEnv() {
  const notified = [], pending = [];
  return {
    notified,
    pending,
    LISTS: {
      map: new Map(),
      async get(k) { return this.map.get(k); },
      async put(k, v) { this.map.set(k, v); },
    },
    CHAN: {
      idFromName: n => n,
      get: n => ({ fetch: async req => { notified.push({ to: n, body: JSON.parse(await req.text()) }); return new Response('ok'); } }),
    },
  };
}
// waitUntil work outlives the response, so hold it and settle it before asserting
// on anything it does — otherwise the notify assertions race and pass by accident.
// These mailboxes are no longer readable by friend code alone: the friend code
// is an ADDRESS, handed out on purpose, and treating it as a password meant
// anyone holding yours could read every recommendation sent to you, notes and
// all. Ownership is proved by the SYNC code, matched against the friend code in
// that device's own setup blob — so the tests have to own their mailboxes the
// way a real client does.
const SYNC = { [ME]: 'SYNCMEAAAA1111111111', [THEM]: 'SYNCTHEMBB2222222222', [OTHER]: 'SYNCOTHRCC3333333333' };
const ownAll = env => { for (const c of [ME, THEM, OTHER])
  env.LISTS.map.set('list:' + SYNC[c], JSON.stringify({ data: { extra: { friend_code: c } } })); return env; };
const call = (env, body) => worker.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify(body) }), env,
  { waitUntil: p => { env.pending.push(p); return p; } });
const settle = async env => { await Promise.all(env.pending); env.pending.length = 0; };
const jsonOf = r => r.json();

// ── a pass files under the SENDER's code and comes back on their pull ───────
{
  const env = ownAll(mkEnv());
  // THEM sends ME a rec; ME passes on it.
  await call(env, { op: 'rec_send', to: ME, from: { code: THEM, name: 'Vik' }, items: [{ title: 'Frieren', aniId: 154587 }] });
  const r = await call(env, { op: 'rec_pass', to: THEM, from: { code: ME, name: 'Hana' }, title: 'Frieren', aniId: 154587 });
  assert.equal((await jsonOf(r)).ok, true);

  // THEM pulls their own mailbox and sees the pass.
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM, sync: SYNC[THEM] }));
  assert.equal(pull.passes.length, 1);
  assert.equal(pull.passes[0].title, 'Frieren');
  assert.equal(pull.passes[0].from.code, ME);
  assert.equal(pull.passes[0].from.name, 'Hana');

  // ME's own mailbox is untouched — a pass is not a rec.
  const mine = await jsonOf(await call(env, { op: 'rec_pull', code: ME, sync: SYNC[ME] }));
  assert.equal(mine.passes.length, 0);
  assert.equal(mine.recs.length, 1);
  console.log('ok  a pass files under the sender and returns on their pull');
}

// ── passing twice is still one answer ──────────────────────────────────────
{
  const env = ownAll(mkEnv());
  const pass = () => call(env, { op: 'rec_pass', to: THEM, from: { code: ME, name: 'Hana' }, title: 'Frieren', aniId: 154587 });
  await pass(); await pass(); await pass();
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM, sync: SYNC[THEM] }));
  assert.equal(pull.passes.length, 1);
  console.log('ok  passing twice is still one answer');
}

// ── a title-only pass dedupes case-insensitively, and per show ─────────────
{
  const env = ownAll(mkEnv());
  await call(env, { op: 'rec_pass', to: THEM, from: { code: ME, name: 'Hana' }, title: 'Frieren' });
  await call(env, { op: 'rec_pass', to: THEM, from: { code: ME, name: 'Hana' }, title: 'frieren' });
  await call(env, { op: 'rec_pass', to: THEM, from: { code: ME, name: 'Hana' }, title: 'Mushishi' });
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM, sync: SYNC[THEM] }));
  assert.equal(pull.passes.length, 2);
  assert.deepEqual(pull.passes.map(p => p.title).sort(), ['Mushishi', 'frieren']);
  console.log('ok  title-only passes dedupe case-insensitively, one per show');
}

// ── two friends passing on the same show are two answers ───────────────────
{
  const env = ownAll(mkEnv());
  await call(env, { op: 'rec_pass', to: THEM, from: { code: ME, name: 'Hana' }, title: 'Frieren', aniId: 154587 });
  await call(env, { op: 'rec_pass', to: THEM, from: { code: OTHER, name: 'Kai' }, title: 'Frieren', aniId: 154587 });
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM, sync: SYNC[THEM] }));
  assert.equal(pull.passes.length, 2);
  assert.deepEqual(pull.passes.map(p => p.from.name).sort(), ['Hana', 'Kai']);
  console.log('ok  two friends passing on one show are two answers');
}

// ── it nudges the socket, and never as a push ──────────────────────────────
{
  const env = ownAll(mkEnv());
  await call(env, { op: 'rec_pass', to: THEM, from: { code: ME, name: 'Hana' }, title: 'Frieren' });
  await settle(env);
  assert.equal(env.notified.length, 1);
  assert.equal(env.notified[0].to, THEM);
  assert.equal(env.notified[0].body.kind, 'pass');
  // The wire carries the show, never who turned it down — the name is already in
  // the pull, and this is the payload a notification would be built from.
  assert.equal(env.notified[0].body.data.title, 'Frieren');
  assert.equal(env.notified[0].body.data.from, undefined);
  console.log('ok  a pass nudges the socket with no sender identity on the wire');
}

// ── junk is refused ────────────────────────────────────────────────────────
{
  const env = ownAll(mkEnv());
  assert.equal((await call(env, { op: 'rec_pass', to: 'short', from: { code: ME }, title: 'X' })).status, 400);
  assert.equal((await call(env, { op: 'rec_pass', to: THEM, from: { code: 'nope' }, title: 'X' })).status, 400);
  assert.equal((await call(env, { op: 'rec_pass', to: THEM, from: { code: ME }, title: '', aniId: 0 })).status, 400);
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM, sync: SYNC[THEM] }));
  assert.equal(pull.passes.length, 0);
  console.log('ok  a malformed pass is refused and files nothing');
}

// ── an old client pulling still works ──────────────────────────────────────
{
  const env = ownAll(mkEnv());
  await env.LISTS.put('pass:' + THEM, 'not json');
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM, sync: SYNC[THEM] }));
  assert.deepEqual(pull.passes, []);
  assert.deepEqual(pull.recs, []);
  console.log('ok  a corrupt pass list degrades to empty, never throws');
}

// ── holding somebody's friend code is not holding their mailbox ────────────
// This is the rule that quietly broke every test above, and nothing noticed for
// a release, because these files were never in the suite. It is worth a test of
// its own now: the friend code is an address — there is a Copy button for it —
// so it must not also be the key.
{
  const env = ownAll(mkEnv());
  await call(env, { op: 'rec_send', to: THEM, from: { code: ME, name: 'Hana' },
                    items: [{ title: 'Frieren', aniId: 154587, note: 'the ep 12 one' }] });
  await call(env, { op: 'rec_pass', to: THEM, from: { code: ME, name: 'Hana' }, title: 'Frieren', aniId: 154587 });

  const stranger = await jsonOf(await call(env, { op: 'rec_pull', code: THEM }));
  assert.deepEqual(stranger.passes, [], 'who turned you down is not public');
  assert.deepEqual(stranger.echoes, [], 'nor is who echoed you back');
  assert.equal(stranger.recs.length, 1, 'but a cached client still works');
  assert.equal(stranger.recs[0].items[0].note, '', 'the NOTE is the private half');
  assert.equal(stranger.recs[0].redacted, true, 'and it says so rather than pretending');

  const wrongSync = await jsonOf(await call(env, { op: 'rec_pull', code: THEM, sync: SYNC[ME] }));
  assert.deepEqual(wrongSync.passes, [], 'somebody else\'s sync code proves nothing');

  const owner = await jsonOf(await call(env, { op: 'rec_pull', code: THEM, sync: SYNC[THEM] }));
  assert.equal(owner.passes.length, 1);
  assert.equal(owner.recs[0].items[0].note, 'the ep 12 one');
  assert.notEqual(owner.recs[0].redacted, true);
  console.log('ok  a friend code reads titles; only the sync code reads the notes and the passes');
}

console.log('\nAll rec-pass tests passed.');
