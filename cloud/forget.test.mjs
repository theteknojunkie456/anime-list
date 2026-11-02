// Erasing a backup, rather than merely losing sight of it.
//
// "Turn off" only ever dropped the key from the device. The blob stayed in KV —
// list, settings, friends — under a key nothing in the world could still reach,
// so "off" meant "I can no longer see it". Every device that mints its own key
// and is later pointed at another one leaves one of these behind too.
//
// Holding the code is the authority, and it grants nothing new: a holder can
// already pull the whole blob and push an empty list over it. What is tested
// here is that the record is GONE rather than blanked, that saying so twice is
// not an error, and that erasing one code cannot touch another.
// run: node cloud/forget.test.mjs
import assert from 'node:assert';
import worker from './sync-worker.js';

const MINE = 'ABCDEFGHJK1234567890', THEIRS = 'ZZZZZZZZZZ9999999999';
const mkEnv = () => { const map = new Map(); return { LISTS: {
  async get(k){ return map.has(k) ? map.get(k) : null; },
  async put(k,v){ map.set(k,v); },
  async delete(k){ map.delete(k); },
}, _map: map }; };
const call = (env, body) => worker.fetch(new Request('https://s/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, { waitUntil(){} }).then(r => r.json().then(j => ({ status: r.status, ...j })));
const list = (...t) => ({ v: 3, list: t.map(x => ({ id: x, title: x })), extra: { friend_code: 'FRIENDCODE1' } });
let pass = 0;
const ok = m => { pass++; console.log('ok  ' + m); };

{
  const env = mkEnv();
  await call(env, { op:'push', code:MINE,   data:list('a','b'), dev:'mac1', devName:'Mac', n:2 });
  await call(env, { op:'push', code:THEIRS, data:list('x'),     dev:'phn1', devName:'Phone', n:1 });

  const r = await call(env, { op:'forget', code:MINE });
  assert.equal(r.ok, true);
  assert.equal(r.existed, true, 'it says it found something, so the client can tell erase from no-op');
  ok('a code that held a backup reports that it did');

  assert.equal(env._map.has('list:' + MINE), false);
  ok('and the record is GONE, not blanked — a blank record still says somebody was here');

  const pulled = await call(env, { op:'pull', code:MINE });
  assert.equal(pulled.data, null);
  assert.equal(pulled.updatedAt, 0);
  ok('a pull afterwards reads exactly like a code that was never used');

  const other = await call(env, { op:'pull', code:THEIRS });
  assert.equal(other.data.list.length, 1);
  ok('and the other key is untouched');
}

// Asking twice is not an error, and must not claim a second destruction.
{
  const env = mkEnv();
  await call(env, { op:'push', code:MINE, data:list('a'), dev:'mac1', n:1 });
  assert.equal((await call(env, { op:'forget', code:MINE })).existed, true);
  const again = await call(env, { op:'forget', code:MINE });
  assert.equal(again.ok, true);
  assert.equal(again.existed, false, 'nothing was there the second time, and it says so');
  ok('erasing twice is harmless and honest about it');

  const never = await call(env, { op:'forget', code:'NEVERUSED00000000000' });
  assert.equal(never.ok, true);
  assert.equal(never.existed, false);
  ok('a code that never held anything is not reported as destroyed');
}

// Nothing malformed reaches storage.
{
  const env = mkEnv();
  await call(env, { op:'push', code:MINE, data:list('a'), dev:'mac1', n:1 });
  for (const bad of ['', 'short', 'has-a-hyphen-in-it!!', 'x'.repeat(65)]) {
    const r = await call(env, { op:'forget', code: bad });
    assert.equal(r.status, 400, 'rejected: ' + JSON.stringify(bad));
  }
  assert.equal(env._map.has('list:' + MINE), true, 'and the real key survived all of that');
  ok('a malformed code is refused and deletes nothing');
}

// Pairing a key that has just been erased must fail the same way an unused one
// does — otherwise a stale pairing code outlives the backup it points at.
{
  const env = mkEnv();
  await call(env, { op:'push', code:MINE, data:list('a'), dev:'mac1', n:1 });
  await call(env, { op:'forget', code:MINE });
  const r = await call(env, { op:'pair_new', code:MINE, dev:'mac1' });
  assert.equal(r.status, 404);
  ok('and an erased key cannot be paired to afterwards');
}

console.log('\n' + pass + ' passed, 0 failed');
