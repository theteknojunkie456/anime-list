// A link you prepare for one person, that sets their app up and then stops working.
//
// The rules worth pinning down are the ones a reasonable implementation gets
// wrong: a kit must be claimable exactly once by exactly one device, re-openable
// by THAT device (reopening a link is not an attack), refused to everybody else,
// and dead once revoked or expired. And the borrowed AI budget has to be spent
// where the key is, because a budget counted in the recipient's browser is a
// number the recipient can edit.
// run: node cloud/setup-kit.test.mjs
import worker from './notify-worker.js';

const RIN = 'dev-rin-phone', SAM = 'dev-sam-laptop';

function mkEnv(opts = {}) {
  const e = {
    reads: 0, writes: 0, upstream: 0,
    SUBS: {
      map: new Map(),
      async get(k) { e.reads++; return this.map.get(k); },
      async put(k, v) { e.writes++; this.map.set(k, v); },
      async delete(k) { this.map.delete(k); },
      async list(o) { const p = (o && o.prefix) || ''; return { keys: [...this.map.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true }; },
    },
    ADMIN_TOKEN: 't0ken', CAP: String(opts.cap || 50),
    ...(opts.aiKey === null ? {} : { AI_KEY: opts.aiKey || 'sk-test' }),
  };
  return e;
}
const call = (env, path, body) => worker.fetch(new Request('https://n' + path, { method: 'POST', body: JSON.stringify(body) }), env, { waitUntil: p => p });
const post = async (env, path, body) => (await call(env, path, body)).json();

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const okv = JSON.stringify(got) === JSON.stringify(want);
  okv ? pass++ : fail++;
  console.log((okv ? 'ok  ' : 'FAIL') + '  ' + name + '  -> ' + JSON.stringify(got) + (okv ? '' : '  (want ' + JSON.stringify(want) + ')'));
};

const LOOK = { theme: 'sasuke', retro: true, art: 'cinematic', fromName: 'Muhammad' };

// ── making one ──────────────────────────────────────────────────────────────
{
  const env = mkEnv();
  t('a stranger cannot mint a kit', (await post(env, '/kit-new', { payload: LOOK })).error, 'unauthorized');
  t('and a kit with nothing in it is not a kit',
    (await post(env, '/kit-new', { token: 't0ken' })).error, 'nothing to set up');
  const made = await post(env, '/kit-new', { token: 't0ken', label: 'For Rin', payload: LOOK, aiCap: 200 });
  t('the admin gets an id back', /^[a-z0-9]{8,24}$/.test(made.id || ''), true);
  t('and it is not claimed yet', (await post(env, '/kit-peek', { id: made.id })).used, false);
  t('peeking says who it is from without handing anything over',
    (await post(env, '/kit-peek', { id: made.id })).from, 'Muhammad');
  t('and peeking never returns the payload',
    'payload' in (await post(env, '/kit-peek', { id: made.id })), false);
}

// ── claiming, once ──────────────────────────────────────────────────────────
{
  const env = mkEnv();
  const { id } = await post(env, '/kit-new', { token: 't0ken', label: 'For Rin', payload: LOOK, aiCap: 200 });
  const first = await post(env, '/kit-claim', { id, dev: RIN, name: 'Rin' });
  t('the first device gets the setup', first.payload, LOOK);
  t('and is let onto the network without anyone approving it', first.joined, 'approved');
  t('and the roster knows who they are',
    JSON.parse(await env.SUBS.get('dev:' + RIN)).name, 'Rin');

  const again = await post(env, '/kit-claim', { id, dev: RIN });
  t('the same device may open the link again', again.payload, LOOK);

  const other = await post(env, '/kit-claim', { id, dev: SAM });
  t('anybody else is refused', other.error, 'used');
  t('and gets nothing', 'payload' in other, false);
  t('a forwarded link reads as used when peeked', (await post(env, '/kit-peek', { id, dev: SAM })).used, true);
  t('but not to the person who claimed it', (await post(env, '/kit-peek', { id, dev: RIN })).used, false);
}

// ── revoking, and running out of time ───────────────────────────────────────
{
  const env = mkEnv();
  const { id } = await post(env, '/kit-new', { token: 't0ken', payload: LOOK });
  t('a stranger cannot revoke', (await post(env, '/kit-revoke', { id })).error, 'unauthorized');
  t('the admin can', (await post(env, '/kit-revoke', { token: 't0ken', id })).ok, true);
  t('and a revoked kit is gone, not merely marked',
    (await post(env, '/kit-claim', { id, dev: RIN })).error, 'no such invite');

  const { id: id2 } = await post(env, '/kit-new', { token: 't0ken', payload: LOOK, days: 1 });
  const rec = JSON.parse(await env.SUBS.get('kit:' + id2));
  rec.expiresAt = Date.now() - 1000;
  await env.SUBS.put('kit:' + id2, JSON.stringify(rec));
  t('an expired kit refuses too', (await post(env, '/kit-claim', { id: id2, dev: RIN })).error, 'expired');
}

// ── the cap is the cap ──────────────────────────────────────────────────────
{
  const env = mkEnv();
  // The cap lives in KV so the admin can move it without a redeploy — an env
  // var called CAP is read by nothing, which is what this test first assumed.
  await env.SUBS.put('cfg:cap', '1');
  await env.SUBS.put('dev:someone-else', JSON.stringify({ id: 'someone-else', status: 'approved', name: 'A' }));
  const { id } = await post(env, '/kit-new', { token: 't0ken', payload: LOOK });
  const r = await post(env, '/kit-claim', { id, dev: RIN, name: 'Rin' });
  t('a full network says so rather than quietly letting one more in', r.joined, 'full');
  t('though the setup still arrives, so they are not left with a blank app', r.payload, LOOK);
}

// ── borrowed AI: spent on the server, not on the honour system ──────────────
{
  const env = mkEnv();
  const { id } = await post(env, '/kit-new', { token: 't0ken', payload: LOOK, aiCap: 2 });
  t('no budget before claiming', (await post(env, '/ai', { dev: RIN, prompt: 'hi' })).error, 'no budget');
  await post(env, '/kit-claim', { id, dev: RIN, name: 'Rin' });
  t('claiming opens one', await post(env, '/ai-budget', { dev: RIN }), { ok: true, has: true, used: 0, cap: 2 });

  // Upstream is stubbed: this test is about the budget, not about Anthropic.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { env.upstream++; return new Response(JSON.stringify({ content: [{ text: 'an answer' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    t('the first call goes through', (await post(env, '/ai', { dev: RIN, prompt: 'a' })).text, 'an answer');
    t('the second spends the last of it', (await post(env, '/ai', { dev: RIN, prompt: 'b' })).used, 2);
    const third = await post(env, '/ai', { dev: RIN, prompt: 'c' });
    t('the third is refused', third.error, 'spent');
    t('and never reaches the upstream, so it cannot be billed', env.upstream, 2);
    t('somebody who was never given a budget cannot borrow one',
      (await post(env, '/ai', { dev: SAM, prompt: 'a' })).error, 'no budget');
  } finally { globalThis.fetch = realFetch; }
}

// ── a failing upstream still costs a request ────────────────────────────────
{
  const env = mkEnv();
  const { id } = await post(env, '/kit-new', { token: 't0ken', payload: LOOK, aiCap: 5 });
  await post(env, '/kit-claim', { id, dev: RIN, name: 'Rin' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 500 });
  try {
    await post(env, '/ai', { dev: RIN, prompt: 'a' });
    t('a call that fails upstream is still counted, or a failing loop is free',
      (await post(env, '/ai-budget', { dev: RIN })).used, 1);
  } finally { globalThis.fetch = realFetch; }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
