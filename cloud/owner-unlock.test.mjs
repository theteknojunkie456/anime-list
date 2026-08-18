// Unit tests for the owner unlock — run: node cloud/owner-unlock.test.mjs
// The unlock button exists for a device the roster has never seen (cookies
// cleared → new id → the launch probe writes nothing). It used to 404 there and
// the client reported it as a bad token, so these tests pin the fresh-device
// path specifically, not just the happy one.
import assert from 'node:assert';
import worker from './notify-worker.js';

const TOKEN = 'test-admin-token';
const NEW_ID = 'brand-new-device-1';

function mkEnv(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    ADMIN_TOKEN: TOKEN,
    map,
    SUBS: {
      async get(k) { return map.get(k); },
      async put(k, v) { map.set(k, v); },
      async delete(k) { map.delete(k); },
      async list({ prefix, cursor }) {
        return { keys: [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: null };
      },
    },
  };
}
const call = (env, path, body) => worker.fetch(
  new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) }), env, { waitUntil: p => p });

// ── a fresh device unlocks with the admin token ────────────────────────────
{
  const env = mkEnv();
  const r = await call(env, '/approve', { token: TOKEN, deviceId: NEW_ID, name: 'MacBook' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.created, true);
  const rec = JSON.parse(env.map.get('dev:' + NEW_ID));
  assert.equal(rec.status, 'approved');
  assert.equal(rec.name, 'MacBook');          // named, not "Admin device"
  console.log('ok  a fresh device unlocks and lands on the roster named');
}

// ── an unnamed unlock still works, filed under a placeholder ───────────────
{
  const env = mkEnv();
  await call(env, '/approve', { token: TOKEN, deviceId: NEW_ID });
  assert.equal(JSON.parse(env.map.get('dev:' + NEW_ID)).name, 'Admin device');
  console.log('ok  an unnamed unlock still approves');
}

// ── the sync code is indexed, so the NEXT wipe rejoins by itself ───────────
{
  const env = mkEnv();
  await call(env, '/approve', { token: TOKEN, deviceId: NEW_ID, name: 'MacBook', sync: 'APMDSFZRAHXVXMLJ636Y' });
  const idx = [...env.map.keys()].filter(k => k.startsWith('idn:'));
  assert.equal(idx.length, 1);
  assert.equal(env.map.get(idx[0]), NEW_ID);
  console.log('ok  unlocking indexes the sync code for automatic rejoin');
}

// ── the wrong token creates nothing ────────────────────────────────────────
{
  const env = mkEnv();
  const r = await call(env, '/approve', { token: 'wrong', deviceId: NEW_ID, name: 'Nope' });
  assert.equal(r.status, 401);
  assert.equal(env.map.get('dev:' + NEW_ID), undefined);
  console.log('ok  a wrong token creates nothing');
}

// ── an existing device is still updated, not duplicated ───────────────────
{
  const env = mkEnv({ ['dev:' + NEW_ID]: JSON.stringify({ id: NEW_ID, status: 'pending', name: 'Faiz', joinedAt: 1 }) });
  await call(env, '/approve', { token: TOKEN, deviceId: NEW_ID, name: 'Something Else' });
  const rec = JSON.parse(env.map.get('dev:' + NEW_ID));
  assert.equal(rec.status, 'approved');
  assert.equal(rec.name, 'Faiz');   // an approve must never rewrite the roster name
  assert.equal(rec.joinedAt, 1);
  console.log('ok  approving a known device updates it and keeps its name');
}

// ── denying an id nobody has seen is still a 404 ──────────────────────────
{
  const env = mkEnv();
  const r = await call(env, '/deny', { token: TOKEN, deviceId: NEW_ID });
  assert.equal(r.status, 404);
  assert.equal(env.map.get('dev:' + NEW_ID), undefined);   // deny must not create
  console.log('ok  denying an unknown device is a 404 and creates nothing');
}

console.log('\nAll owner-unlock tests passed.');
