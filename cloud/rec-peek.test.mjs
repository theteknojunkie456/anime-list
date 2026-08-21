// Reading back the note YOU wrote when you recommended something.
// run: node cloud/rec-peek.test.mjs
import assert from 'node:assert';
import worker from './sync-worker.js';

const ME = 'aaaaaaaaaa1', THEM = 'bbbbbbbbbb2', SNOOP = 'cccccccccc3';

function mkEnv() {
  const pending = [];
  return {
    pending,
    LISTS: { map: new Map(), async get(k) { return this.map.get(k); }, async put(k, v) { this.map.set(k, v); } },
    CHAN: { idFromName: n => n, get: () => ({ fetch: async () => new Response('ok') }) },
  };
}
const call = (env, body) => worker.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify(body) }), env,
  { waitUntil: p => { env.pending.push(p); return p; } });
const j = r => r.json();

const send = (env, items) => call(env, { op: 'rec_send', to: THEM, from: { code: ME, name: 'Hana' }, items });
const peek = (env, extra) => call(env, { op: 'rec_peek', to: THEM, from: { code: ME }, ...extra });

let n = 0;
const ok = m => { n++; console.log('ok  ' + m); };

// ── the sender gets their own note back ────────────────────────────────────
{
  const env = mkEnv();
  const sent = await j(await send(env, [
    { title: 'Frieren', aniId: 154587, img: 'x.jpg', note: 'trust me on this one' },
    { title: 'Vinland Saga', aniId: 101348, note: '' },
  ]));
  const got = await j(await peek(env, { id: sent.id }));
  assert.equal(got.ok, true);
  assert.equal(got.gone, undefined);
  assert.equal(got.items.length, 2);
  assert.equal(got.items[0].note, 'trust me on this one');
  assert.equal(got.items[0].title, 'Frieren');
  assert.equal(got.items[1].note, '', 'a show sent without a note comes back with an empty one, not a missing one');
  ok('the note you wrote comes back to you');
}

// ── nobody else can read it, even knowing the mailbox and the envelope id ──
{
  const env = mkEnv();
  const sent = await j(await send(env, [{ title: 'Frieren', aniId: 154587, note: 'private thought' }]));
  const asSnoop = await j(await call(env, { op: 'rec_peek', to: THEM, from: { code: SNOOP }, id: sent.id }));
  assert.equal(asSnoop.gone, true, 'a stranger holding both the recipient code and the envelope id gets nothing');
  assert.ok(!asSnoop.items, 'and no items leak in the refusal');
  ok('knowing the mailbox and the id is not enough — the envelope has to say you sent it');
}

// ── the recipient cannot read their own mailbox this way either ────────────
{
  const env = mkEnv();
  const sent = await j(await send(env, [{ title: 'Frieren', note: 'private thought' }]));
  const asThem = await j(await call(env, { op: 'rec_peek', to: THEM, from: { code: THEM }, id: sent.id }));
  assert.equal(asThem.gone, true);
  ok('rec_peek answers the sender only');
}

// ── an envelope that has aged out is "gone", not an error ──────────────────
{
  const env = mkEnv();
  const got = await j(await peek(env, { id: 'nosuchenvelope' }));
  assert.equal(got.ok, true);
  assert.equal(got.gone, true);
  ok('a missing envelope is a normal answer, not a failure');
}

// ── junk is refused before it touches storage ──────────────────────────────
{
  const env = mkEnv();
  assert.equal((await peek(env, { id: '' })).status, 400);
  assert.equal((await call(env, { op: 'rec_peek', to: 'nope', from: { code: ME }, id: 'x' })).status, 400);
  assert.equal((await call(env, { op: 'rec_peek', to: THEM, from: { code: '!!' }, id: 'x' })).status, 400);
  ok('a bad code or a missing id is refused');
}

console.log('\nAll ' + n + ' rec-peek tests passed.');
