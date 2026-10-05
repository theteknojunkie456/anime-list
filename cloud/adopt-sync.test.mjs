// The bug this covers: "use this device's list everywhere" put its marker INSIDE
// the blob, and the blob is replaced wholesale by the next push from anybody. So
// a single push from a device that hadn't caught up erased the decision, its
// stale titles merged back everywhere, and the device you'd declared right
// quietly reverted. Run: node cloud/adopt-sync.test.mjs
import assert from 'node:assert';
import worker from './sync-worker.js';

const CODE = 'ABCDEFGHJK1234567890';
const mkEnv = () => { const map = new Map(); return { LISTS: {
  async get(k){ return map.has(k) ? map.get(k) : null; },
  async put(k,v){ map.set(k,v); },
}, _map: map }; };
const call = (env, body) => worker.fetch(new Request('https://s/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, { waitUntil(){} }).then(r => r.json().then(j => ({ status: r.status, ...j })));
const list = (...t) => ({ v: 3, list: t.map(x => ({ id: x, title: x })), extra: null });
let pass = 0;
const ok = m => { pass++; console.log('ok  ' + m); };

// ── the marker outlives the blob ────────────────────────────────────────────
{
  const env = mkEnv();
  await call(env, { op:'push', code:CODE, data:list('a','b'), dev:'mac1', devName:'Mac', n:2, adoptSeen:0 });
  const adopt = Date.now();
  await call(env, { op:'push', code:CODE, data:list('a','b','c'), dev:'mac1', devName:'Mac', n:3, adopt, adoptBy:'mac1', adoptSeen:adopt });
  // the phone, still holding its old copy, publishes without having adopted
  const r = await call(env, { op:'push', code:CODE, data:list('a','z'), dev:'phon', devName:'iPhone', n:2, adoptSeen:0 });
  assert.equal(r.status, 409);
  assert.equal(r.error, 'stale-adopt');
  assert.equal(r.adopt, adopt);
  const pulled = await call(env, { op:'pull', code:CODE });
  assert.equal(pulled.data.list.length, 3, 'the chosen copy is still the stored one');
  assert.equal(pulled.adopt, adopt, 'and the decision is on the record, not in the blob');
  ok('a device that is behind cannot publish over the copy that overruled it');
}

// ── once it has caught up, it publishes normally again ──────────────────────
{
  const env = mkEnv();
  const adopt = Date.now();
  await call(env, { op:'push', code:CODE, data:list('a','b','c'), dev:'mac1', n:3, adopt, adoptBy:'mac1', adoptSeen:adopt });
  const r = await call(env, { op:'push', code:CODE, data:list('a','b','c','d'), dev:'phon', n:4, adoptSeen:adopt });
  assert.equal(r.ok, true);
  assert.equal(r.adopt, adopt, 'and the decision is carried forward, not dropped');
  const pulled = await call(env, { op:'pull', code:CODE });
  assert.equal(pulled.data.list.length, 4);
  assert.equal(pulled.adopt, adopt);
  ok('a caught-up device publishes freely, and the marker survives its push');
}

// ── a newer decision wins ───────────────────────────────────────────────────
{
  const env = mkEnv();
  const first = 1000, second = 2000;
  await call(env, { op:'push', code:CODE, data:list('a'), dev:'mac1', n:1, adopt:first, adoptBy:'mac1', adoptSeen:first });
  const r = await call(env, { op:'push', code:CODE, data:list('x','y'), dev:'phon', n:2, adopt:second, adoptBy:'phon', adoptSeen:first });
  assert.equal(r.ok, true);
  const pulled = await call(env, { op:'pull', code:CODE });
  assert.equal(pulled.adopt, second);
  assert.equal(pulled.adoptBy, 'phon');
  assert.equal(pulled.data.list.length, 2);
  ok('a later decision replaces an earlier one');
}

// ── per-device snapshots, which is what makes the picker possible ───────────
{
  const env = mkEnv();
  await call(env, { op:'push', code:CODE, data:list('a','b','c'), dev:'mac1', devName:'Mac', n:3, adoptSeen:0 });
  await new Promise(r => setTimeout(r, 3));   // real devices are not in the same millisecond
  await call(env, { op:'push', code:CODE, data:list('a'), dev:'phon', devName:'iPhone', n:1, adoptSeen:0 });
  const d = await call(env, { op:'devices', code:CODE });
  assert.equal(d.devices.length, 2);
  assert.equal(d.devices[0].id, 'phon', 'newest first');
  const mac = d.devices.find(x => x.id === 'mac1');
  assert.equal(mac.name, 'Mac');
  assert.equal(mac.n, 3);
  // the phone can read the Mac's copy without the Mac being present
  const blob = await call(env, { op:'pull_dev', code:CODE, dev:'mac1' });
  assert.equal(blob.ok, true);
  assert.equal(blob.data.list.length, 3);
  assert.equal((await call(env, { op:'pull_dev', code:CODE, dev:'nope' })).status, 404);
  ok('every device keeps a readable snapshot, so any device can pick any other');
}

// ── an ordinary pull does not drag the snapshots down with it ───────────────
{
  const env = mkEnv();
  await call(env, { op:'push', code:CODE, data:list('a','b'), dev:'mac1', devName:'Mac', n:2, adoptSeen:0 });
  const pulled = await call(env, { op:'pull', code:CODE });
  assert.equal(pulled.devs, undefined);
  ok('pull stays one copy of the list, not one per device');
}

// ── only the five most recent devices are kept ──────────────────────────────
{
  const env = mkEnv();
  for (let i = 0; i < 7; i++) {
    await call(env, { op:'push', code:CODE, data:list('a'), dev:'dev' + i, devName:'D' + i, n:1, adoptSeen:0 });
    await new Promise(r => setTimeout(r, 2));
  }
  const d = await call(env, { op:'devices', code:CODE });
  assert.equal(d.devices.length, 5);
  assert.ok(d.devices.some(x => x.id === 'dev6'), 'the one that just wrote is kept');
  assert.ok(!d.devices.some(x => x.id === 'dev0'), 'the oldest is the one dropped');
  ok('the device list is capped at five, and never evicts the device writing');
}

// ── a code with no decision behaves exactly as before ───────────────────────
{
  const env = mkEnv();
  const r = await call(env, { op:'push', code:CODE, data:list('a'), dev:'phon', n:1, adoptSeen:0 });
  assert.equal(r.ok, true);
  const r2 = await call(env, { op:'push', code:CODE, data:list('a','b'), dev:'mac1', n:2, adoptSeen:0 });
  assert.equal(r2.ok, true, 'no decision made → nobody is blocked');
  ok('without a decision, pushing is unchanged');
}

console.log('\n' + pass + ' passed');
