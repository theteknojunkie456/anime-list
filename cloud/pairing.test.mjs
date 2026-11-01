// How a second device joins the FIRST one's key.
//
// The bug underneath this is not a sync failure. Two devices each used before
// either was pointed at the other each minted a key of their own and each
// backed up alone — correctly, forever, to different places. Nothing errored,
// so nothing was reported, and the device picker had nothing to show because
// from either side there genuinely was no other device.
//
// The rules worth pinning down are the ones a reasonable implementation gets
// wrong: a pairing code must die on a clock as well as on use, must be
// re-claimable by the device that already claimed it (a phone that reloads
// mid-join is not an attacker), must be refused to everybody else, and must not
// be cancellable by someone who merely guessed it. And it must never be minted
// for a key with no backup behind it — that hands the other device an empty
// list and calls it a merge.
// run: node cloud/pairing.test.mjs
import assert from 'node:assert';
import worker from './sync-worker.js';

const CODE = 'ABCDEFGHJK1234567890', OTHER = 'ZZZZZZZZZZ9999999999';
const MAC = 'dev-mac-1', PHONE = 'dev-phone-1', THIEF = 'dev-thief-1';

const mkEnv = () => { const map = new Map(); return { LISTS: {
  async get(k){ return map.has(k) ? map.get(k) : null; },
  async put(k,v){ map.set(k,v); },
  async delete(k){ map.delete(k); },
}, _map: map }; };
const call = (env, body) => worker.fetch(new Request('https://s/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), env, { waitUntil(){} }).then(r => r.json().then(j => ({ status: r.status, ...j })));
const list = (...t) => ({ v: 3, list: t.map(x => ({ id: x, title: x })), extra: null });
const seed = async (env, code) => call(env, { op:'push', code, data:list('a','b'), dev:MAC, devName:'Mac', n:2 });

let pass = 0;
const ok = m => { pass++; console.log('ok  ' + m); };

// ── offering one ────────────────────────────────────────────────────────────
{
  const env = mkEnv();
  const none = await call(env, { op:'pair_new', code:CODE, dev:MAC });
  assert.equal(none.status, 404);
  ok('a key with no backup behind it cannot be paired to — that is not a merge, it is a wipe');

  await seed(env, CODE);
  const r = await call(env, { op:'pair_new', code:CODE, dev:MAC });
  assert.equal(r.ok, true);
  assert.match(r.pair, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/,
    'eight characters, and none of the pairs a person reads wrong off a screen');
  assert.ok(r.expiresAt > Date.now() && r.expiresAt <= Date.now() + 600_000);
  ok('an eight-character code, alive for ten minutes');

  const bad = await call(env, { op:'pair_new', code:'short', dev:MAC });
  assert.equal(bad.status, 400);
  ok('and a malformed key never mints one');
}

// ── taking it, once ─────────────────────────────────────────────────────────
{
  const env = mkEnv();
  await seed(env, CODE);
  const { pair } = await call(env, { op:'pair_new', code:CODE, dev:MAC });

  const first = await call(env, { op:'pair_claim', pair, dev:PHONE });
  assert.equal(first.code, CODE);
  ok('the first device gets the real key');

  const again = await call(env, { op:'pair_claim', pair, dev:PHONE });
  assert.equal(again.code, CODE);
  ok('and may claim again — a phone that reloads mid-join is not an attacker');

  const thief = await call(env, { op:'pair_claim', pair, dev:THIEF });
  assert.equal(thief.status, 409);
  assert.equal('code' in thief, false, 'and gets nothing back');
  ok('anybody else is refused');

  // Case and separators: this is typed off another screen, by a person.
  const env2 = mkEnv(); await seed(env2, CODE);
  const p2 = (await call(env2, { op:'pair_new', code:CODE, dev:MAC })).pair;
  const typed = await call(env2, { op:'pair_claim', pair: p2.toLowerCase().slice(0,4) + '-' + p2.toLowerCase().slice(4), dev:PHONE });
  assert.equal(typed.code, CODE);
  ok('typed in lower case with a hyphen through it still works');
}

// ── running out of time ─────────────────────────────────────────────────────
{
  const env = mkEnv();
  await seed(env, CODE);
  const { pair } = await call(env, { op:'pair_new', code:CODE, dev:MAC });
  const rec = JSON.parse(await env.LISTS.get('pair:' + pair));
  rec.exp = Date.now() - 1000;
  await env.LISTS.put('pair:' + pair, JSON.stringify(rec));
  const r = await call(env, { op:'pair_claim', pair, dev:PHONE });
  assert.equal(r.status, 410);
  assert.equal(r.error, 'expired');
  ok('a code past its ten minutes is refused even before KV evicts it');

  const gone = await call(env, { op:'pair_claim', pair:'AAAAAAAA', dev:PHONE });
  assert.equal(gone.status, 404);
  ok('and one that never existed says so rather than hanging');

  const junk = await call(env, { op:'pair_claim', pair:'TOOSHORT1', dev:PHONE });
  assert.equal(junk.status, 400);
  ok('a wrong-length code never reaches storage');

  const nodev = await call(env, { op:'pair_claim', pair, dev:'' });
  assert.equal(nodev.status, 400);
  ok('and a claim with no device on it is refused — single-use needs to know who');
}

// ── withdrawing it ──────────────────────────────────────────────────────────
{
  const env = mkEnv();
  await seed(env, CODE); await seed(env, OTHER);
  const { pair } = await call(env, { op:'pair_new', code:CODE, dev:MAC });

  const notyours = await call(env, { op:'pair_cancel', pair, code:OTHER });
  assert.equal(notyours.status, 403);
  assert.equal((await call(env, { op:'pair_claim', pair, dev:PHONE })).code, CODE);
  ok('somebody who guessed the code cannot withdraw it — that would be sabotage by guessing');

  const env2 = mkEnv(); await seed(env2, CODE);
  const p2 = (await call(env2, { op:'pair_new', code:CODE, dev:MAC })).pair;
  assert.equal((await call(env2, { op:'pair_cancel', pair:p2, code:CODE })).ok, true);
  assert.equal((await call(env2, { op:'pair_claim', pair:p2, dev:PHONE })).status, 404);
  ok('closing the sheet actually closes the door');
}

// ── the code is not the key ─────────────────────────────────────────────────
{
  const env = mkEnv();
  await seed(env, CODE);
  const { pair } = await call(env, { op:'pair_new', code:CODE, dev:MAC });
  // Two keys' worth of separation: the short code is a one-time bearer of the
  // long one, so it must not be usable as a list code itself.
  const asList = await call(env, { op:'pull', code: pair });
  assert.equal(asList.status, 400, 'eight characters is below the list-code minimum');
  ok('a pairing code cannot be used as a list key in its own right');
}

// ── two keys do not leak into each other ────────────────────────────────────
{
  const env = mkEnv();
  await seed(env, CODE); await seed(env, OTHER);
  const a = (await call(env, { op:'pair_new', code:CODE,  dev:MAC })).pair;
  const b = (await call(env, { op:'pair_new', code:OTHER, dev:'dev-other' })).pair;
  assert.notEqual(a, b);
  assert.equal((await call(env, { op:'pair_claim', pair:a, dev:PHONE })).code, CODE);
  assert.equal((await call(env, { op:'pair_claim', pair:b, dev:PHONE })).code, OTHER);
  ok('two live pairings stay told apart');
}

console.log('\n' + pass + ' passed, 0 failed');
