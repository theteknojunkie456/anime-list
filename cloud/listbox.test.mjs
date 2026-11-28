// The list record moved out of KV and into a Durable Object, one per sync code.
// Run: node cloud/listbox.test.mjs
//
// What has to hold: a record survives a round trip whatever its size; a code that
// only exists in the old KV is read anyway AND brought across on first touch; a
// record that gets shorter does not leave a tail of the longer one behind; and a
// deploy without the binding still works entirely on KV.
import assert from 'node:assert';
import worker, { ListBox } from './sync-worker.js';

const CODE = 'ABCDEFGHJK1234567890';
const KEY = 'list:' + CODE;
let pass = 0;
const ok = m => { pass++; console.log('ok  ' + m); };

// a Durable Object namespace holding real ListBox instances over a Map
const mkBoxes = () => {
  const boxes = new Map(), writes = { n: 0 };
  return { ns: {
    idFromName: k => k,
    get(id) {
      if (!boxes.has(id)) {
        const map = new Map();
        const storage = {
          async get(k) { return map.has(k) ? map.get(k) : undefined; },
          async put(k, v) { writes.n++; map.set(k, v); },
          async delete(k) { map.delete(k); },
          async deleteAll() { map.clear(); },
        };
        boxes.set(id, new ListBox({ storage }));
      }
      const box = boxes.get(id);
      return { fetch: (url, init) => box.fetch(new Request(url, init)) };
    },
  }, boxes, writes };
};
const mkEnv = (withBox) => {
  const map = new Map();
  const kv = { async get(k) { return map.has(k) ? map.get(k) : null; }, async put(k, v) { map.set(k, v); }, async delete(k) { map.delete(k); } };
  const b = withBox ? mkBoxes() : null;
  return { LISTS: kv, ...(b ? { LISTBOX: b.ns } : {}), _map: map, _boxes: b };
};
const call = (env, body) => worker.fetch(new Request('https://s/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, { waitUntil() {} }).then(r => r.json().then(j => ({ status: r.status, ...j })));
const listOf = n => ({ v: 3, list: Array.from({ length: n }, (_, i) => ({ id: 'x' + i, title: 'Title number ' + i, note: 'n'.repeat(40) })) });

// ── a round trip through the Durable Object ─────────────────────────────────
{
  const env = mkEnv(true);
  await call(env, { op: 'push', code: CODE, data: listOf(3), dev: 'mac1', devName: 'Mac', n: 3 });
  const r = await call(env, { op: 'pull', code: CODE });
  assert.equal(r.data.list.length, 3);
  assert.equal(env._map.size, 0, 'the record must not also be written to KV');
  ok('a push is stored in the Durable Object and pulls back');
}

// ── a record far bigger than one 128 KiB value ──────────────────────────────
{
  const env = mkEnv(true);
  const big = listOf(4000);                                   // comfortably over a megabyte
  const payload = JSON.stringify(big).length;
  await call(env, { op: 'push', code: CODE, data: big, dev: 'mac1', devName: 'Mac', n: 4000 });
  const r = await call(env, { op: 'pull', code: CODE });
  assert.equal(r.data.list.length, 4000);
  assert.equal(r.data.list[3999].title, 'Title number 3999', 'the last piece must survive');
  ok(`a ${(payload / 1024 / 1024).toFixed(1)} MB record splits across values and comes back whole`);
}

// ── a code that only exists in the old KV ───────────────────────────────────
{
  const env = mkEnv(true);
  env._map.set(KEY, JSON.stringify({ data: listOf(2), updatedAt: 111, adopt: 0, adoptBy: '', n: 2, devs: {} }));
  const r = await call(env, { op: 'pull', code: CODE });
  assert.equal(r.data.list.length, 2, 'the old KV copy must still be readable');
  assert.equal(r.updatedAt, 111);
  ok('a list still in KV is read through');
  // and is now in the Durable Object, so KV is never consulted for it again
  env._map.delete(KEY);
  const again = await call(env, { op: 'pull', code: CODE });
  assert.equal(again.data.list.length, 2, 'it should have been copied across on that first read');
  ok('reading it once brings it across');
}

// ── a record that shrinks leaves no tail behind ─────────────────────────────
{
  const env = mkEnv(true);
  await call(env, { op: 'push', code: CODE, data: listOf(3000), dev: 'mac1', devName: 'Mac', n: 3000 });
  await call(env, { op: 'push', code: CODE, data: listOf(2), dev: 'mac1', devName: 'Mac', n: 2 });
  const r = await call(env, { op: 'pull', code: CODE });
  assert.equal(r.data.list.length, 2);
  assert.equal(JSON.stringify(r.data).includes('Title number 2999'), false, 'the long record must not leak into the short one');
  ok('a shorter record replaces the longer one completely');
}

// ── no binding at all: everything still works, on KV ────────────────────────
{
  const env = mkEnv(false);
  await call(env, { op: 'push', code: CODE, data: listOf(3), dev: 'mac1', devName: 'Mac', n: 3 });
  const r = await call(env, { op: 'pull', code: CODE });
  assert.equal(r.data.list.length, 3);
  assert.ok(env._map.has(KEY), 'without the binding the record belongs in KV');
  ok('a deploy without the binding keeps working on KV');
}

// ── forgetting a backup clears both ─────────────────────────────────────────
{
  const env = mkEnv(true);
  await call(env, { op: 'push', code: CODE, data: listOf(2), dev: 'mac1', devName: 'Mac', n: 2 });
  env._map.set(KEY, 'stale');
  await call(env, { op: 'forget', code: CODE });
  const r = await call(env, { op: 'pull', code: CODE });
  assert.equal(r.data, null, 'forget must leave nothing behind in either store');
  ok('forget clears the Durable Object and the old KV copy');
}

console.log(`\n${pass} checks passed`);
