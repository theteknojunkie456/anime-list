// HOW BIG THE SHARED COPY IS, where another device can read it.
//
// The list in the cloud is ciphertext: a device cannot open another device's
// copy to count it, so it could not tell whether a push was about to make the
// backup smaller. On 13 November that is exactly what happened — 210 titles
// replaced 288 and nothing in the system was in a position to notice.
//
// The per-device rows have carried a count since the picker needed one. The
// shared record did not. It does now, in plaintext beside the ciphertext it
// describes, because a count is not the list and it is the one fact that makes
// "am I about to shrink this?" answerable before the write rather than after.
// run: node cloud/shared-size.test.mjs
import assert from 'node:assert';
import worker from './sync-worker.js';

const CODE = 'ABCDEFGHJK1234567890';
const mkEnv = () => { const map = new Map(); return { LISTS: {
  async get(k){ return map.has(k) ? map.get(k) : null; },
  async put(k,v){ map.set(k,v); },
  async delete(k){ map.delete(k); },
}, _map: map }; };
const call = (env, body) => worker.fetch(new Request('https://s/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, { waitUntil(){} }).then(r => r.json().then(j => ({ status: r.status, ...j })));
// What a real push carries: the list as an opaque envelope, unreadable here.
const sealed = () => ({ v: 3, list: { v: 2, enc: 'x', iv: 'y', ct: 'z' }, extra: {} });
let pass = 0;
const ok = m => { pass++; console.log('ok  ' + m); };

{
  const env = mkEnv();
  await call(env, { op:'push', code:CODE, data:sealed(), dev:'mac1', devName:'Mac', n:288 });
  const r = await call(env, { op:'pull', code:CODE });
  assert.equal(r.n, 288);
  ok('a pull says how many titles the shared copy holds');

  assert.equal(r.devs, undefined);
  ok('and still does not ship the per-device snapshots with it');

  // The whole point: the count is readable without the key.
  assert.equal(typeof r.data.list.ct, 'string');
  ok('the list itself is still sealed — the count is not a way in');
}

{
  const env = mkEnv();
  await call(env, { op:'push', code:CODE, data:sealed(), dev:'mac1', devName:'Mac', n:288 });
  await call(env, { op:'push', code:CODE, data:sealed(), dev:'phn1', devName:'iPhone app', n:210 });
  const r = await call(env, { op:'pull', code:CODE });
  assert.equal(r.n, 210);
  ok('the count belongs to whoever wrote last, like the copy it describes');

  const d = await call(env, { op:'devices', code:CODE });
  const by = Object.fromEntries(d.devices.map(x => [x.name, x.n]));
  assert.deepEqual(by, { Mac: 288, 'iPhone app': 210 });
  ok('and each device still reports its own, which is what the picker reads');
}

{
  // A client that predates this sends no count. The record must still be
  // written — the check on the other side reads 0 and turns itself off rather
  // than blocking a device that has done nothing wrong.
  const env = mkEnv();
  await call(env, { op:'push', code:CODE, data:sealed(), dev:'old1', devName:'Old' });
  const r = await call(env, { op:'pull', code:CODE });
  assert.equal(r.n, 0);
  ok('a push with no count stores zero rather than failing or guessing');
}

{
  // Counts come off the wire, so they are claims, not facts.
  const env = mkEnv();
  await call(env, { op:'push', code:CODE, data:sealed(), dev:'bad1', devName:'Bad', n:-5 });
  assert.equal((await call(env, { op:'pull', code:CODE })).n, 0);
  await call(env, { op:'push', code:CODE, data:sealed(), dev:'bad1', devName:'Bad', n:'9e99' });
  assert.equal((await call(env, { op:'pull', code:CODE })).n, 1000000);
  ok('a nonsense count is clamped, not stored');
}

console.log('\n' + pass + ' passed, 0 failed');
