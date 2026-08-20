// Unit tests for hearing back about a recommendation — run: node cloud/rec-echo.test.mjs
import assert from 'node:assert';
import worker from './sync-worker.js';

const ME = 'aaaaaaaaaa1', THEM = 'bbbbbbbbbb2', OTHER = 'cccccccccc3';

function mkEnv() {
  const notified = [], pending = [];
  return {
    notified, pending,
    LISTS: { map: new Map(), async get(k) { return this.map.get(k); }, async put(k, v) { this.map.set(k, v); } },
    CHAN: {
      idFromName: n => n,
      get: n => ({ fetch: async req => { notified.push({ to: n, body: JSON.parse(await req.text()) }); return new Response('ok'); } }),
    },
  };
}
const call = (env, body) => worker.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify(body) }), env,
  { waitUntil: p => { env.pending.push(p); return p; } });
const settle = async env => { await Promise.all(env.pending); env.pending.length = 0; };
const jsonOf = r => r.json();
const echo = (env, extra) => call(env, { op: 'rec_echo', to: THEM, from: { code: ME, name: 'Hana' }, title: 'Frieren', aniId: 154587, ...extra });

// ── the three stages come back on the recommender's pull ───────────────────
{
  const env = mkEnv();
  await echo(env, { kind: 'added' });
  await echo(env, { kind: 'started' });
  await echo(env, { kind: 'finished' });
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM }));
  assert.deepEqual(pull.echoes.map(e => e.kind), ['added', 'started', 'finished']);
  assert.equal(pull.echoes[0].from.name, 'Hana');
  console.log('ok  added / started / finished all reach the recommender');
}

// ── the same stage twice is still one ──────────────────────────────────────
{
  const env = mkEnv();
  await echo(env, { kind: 'started' });
  await echo(env, { kind: 'started' });
  await echo(env, { kind: 'started' });
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM }));
  assert.equal(pull.echoes.length, 1);
  console.log('ok  re-sending a stage does not stack up');
}

// ── notes are messages: two said is two heard ──────────────────────────────
{
  const env = mkEnv();
  await echo(env, { kind: 'note', note: 'man this was great' });
  await echo(env, { kind: 'note', note: 'ok the ending though' });
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM }));
  assert.equal(pull.echoes.length, 2);
  assert.deepEqual(pull.echoes.map(e => e.note), ['man this was great', 'ok the ending though']);
  console.log('ok  two notes are two notes');
}

// ── each friend's news is their own ────────────────────────────────────────
{
  const env = mkEnv();
  await echo(env, { kind: 'finished' });
  await call(env, { op: 'rec_echo', to: THEM, from: { code: OTHER, name: 'Kai' }, title: 'Frieren', aniId: 154587, kind: 'finished' });
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM }));
  assert.equal(pull.echoes.length, 2);
  assert.deepEqual(pull.echoes.map(e => e.from.name).sort(), ['Hana', 'Kai']);
  console.log('ok  two friends finishing one show are two pieces of news');
}

// ── it nudges the socket, without naming who ───────────────────────────────
{
  const env = mkEnv();
  await echo(env, { kind: 'finished' });
  await settle(env);
  assert.equal(env.notified.length, 1);
  assert.equal(env.notified[0].to, THEM);
  assert.equal(env.notified[0].body.kind, 'echo');
  assert.equal(env.notified[0].body.data.kind, 'finished');
  assert.equal(env.notified[0].body.data.from, undefined);
  console.log('ok  the nudge carries the show and the stage, never the sender');
}

// ── junk is refused ────────────────────────────────────────────────────────
{
  const env = mkEnv();
  assert.equal((await echo(env, { kind: 'watched' })).status, 400);         // not a stage
  assert.equal((await echo(env, { kind: 'note' })).status, 400);            // note with nothing in it
  assert.equal((await call(env, { op: 'rec_echo', to: 'short', from: { code: ME }, title: 'X', kind: 'added' })).status, 400);
  assert.equal((await call(env, { op: 'rec_echo', to: THEM, from: { code: ME }, title: '', aniId: 0, kind: 'added' })).status, 400);
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM }));
  assert.equal(pull.echoes.length, 0);
  console.log('ok  malformed news is refused and files nothing');
}

// ── an old client's stored blob never throws ───────────────────────────────
{
  const env = mkEnv();
  await env.LISTS.put('echo:' + THEM, 'not json');
  const pull = await jsonOf(await call(env, { op: 'rec_pull', code: THEM }));
  assert.deepEqual(pull.echoes, []);
  console.log('ok  a corrupt echo list degrades to empty');
}

console.log('\nAll rec-echo tests passed.');
