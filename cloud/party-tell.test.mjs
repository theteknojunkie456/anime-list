// A party your friends can actually find.
//
// The shape under test is "one write, many reads": the host writes a single key
// (their own), friends read it. The write-cost test below is the point of the
// whole design — KV writes are the scarce resource, and the obvious build (a
// row per friend) spends them in proportion to how popular you are.
// run: node cloud/party-tell.test.mjs
import assert from 'node:assert';
import worker from './sync-worker.js';

const HOST = 'aaaaaaaaaa1', FRIEND = 'bbbbbbbbbb2', OTHER = 'cccccccccc3';

function mkEnv() {
  const pending = [], pushed = [];
  return {
    pending, pushed, writes: 0, deletes: 0, reads: 0,
    LISTS: {
      map: new Map(),
      async get(k) { env.reads++; return this.map.get(k); },
      async put(k, v) { env.writes++; this.map.set(k, v); },
      async delete(k) { env.deletes++; this.map.delete(k); },
    },
    CHAN: { idFromName: n => n, get: () => ({ fetch: async req => { pushed.push(req.url); return new Response('ok'); } }) },
  };
}
let env;
const fresh = () => (env = mkEnv());
const call = (e, body) => worker.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify(body) }), e,
  { waitUntil: p => { e.pending.push(p); return p; } });
const j = r => r.json();

const tell = (e, extra) => call(e, {
  op: 'party_tell', from: { code: HOST, name: 'Hana' },
  room: 'K3P9', title: 'Frieren', img: 'f.jpg', ...extra,
});

let n = 0;
const ok = m => { n++; console.log('ok  ' + m); };

// ── a friend sees it on the pull they already make ─────────────────────────
{
  fresh(); await tell(env);
  const got = await j(await call(env, { op: 'rec_pull', code: FRIEND, friends: [HOST] }));
  assert.equal(got.parties.length, 1);
  assert.equal(got.parties[0].room, 'K3P9');
  assert.equal(got.parties[0].from.name, 'Hana');
  assert.equal(got.parties[0].title, 'Frieren');
  assert.deepEqual(got.recs, [], 'a party is not a recommendation and must not arrive as one');
  ok('a friend sees the party on the pull they already do');
}

// ── one write per party, however many friends ──────────────────────────────
{
  fresh(); await tell(env);
  assert.equal(env.writes, 1, 'a party must cost one write, not one per friend');
  // Fifty friends read it; still one write.
  const many = Array.from({ length: 50 }, (_, i) => 'f' + String(i).padStart(10, '0'));
  await call(env, { op: 'rec_pull', code: FRIEND, friends: [HOST, ...many] });
  assert.equal(env.writes, 1, 'reading must not write');
  ok('one party costs exactly one KV write regardless of friend count');
}

// ── you only see parties from codes you already hold ───────────────────────
{
  fresh(); await tell(env);
  const blind = await j(await call(env, { op: 'rec_pull', code: OTHER, friends: [] }));
  assert.deepEqual(blind.parties, [], 'naming no codes finds nothing');
  const nosuch = await j(await call(env, { op: 'rec_pull', code: OTHER, friends: ['zzzzzzzzzz9'] }));
  assert.deepEqual(nosuch.parties, [], 'a code with no party returns nothing, not an error');
  ok('a party is only visible to someone holding the host code');
}

// ── your own party is not offered back to you ──────────────────────────────
{
  fresh(); await tell(env);
  const mine = await j(await call(env, { op: 'rec_pull', code: HOST, friends: [HOST] }));
  assert.deepEqual(mine.parties, [], 'the server must not invite you to the room you are hosting');
  ok('the host is never told to join their own party');
}

// ── starting again replaces, it does not stack ─────────────────────────────
{
  fresh();
  await tell(env, { room: 'AAAA', title: 'Frieren' });
  await tell(env, { room: 'BBBB', title: 'Vinland Saga' });
  const got = await j(await call(env, { op: 'rec_pull', code: FRIEND, friends: [HOST] }));
  assert.equal(got.parties.length, 1, 'the key is the host, so a new party overwrites the old');
  assert.equal(got.parties[0].room, 'BBBB');
  assert.equal(got.parties[0].title, 'Vinland Saga');
  ok('picking a different show replaces the row, it does not stack');
}

// ── two hosts both show ────────────────────────────────────────────────────
{
  fresh();
  await tell(env, { room: 'AAAA' });
  await call(env, { op: 'party_tell', from: { code: OTHER, name: 'Rin' }, room: 'CCCC', title: 'Dandadan' });
  const got = await j(await call(env, { op: 'rec_pull', code: FRIEND, friends: [HOST, OTHER] }));
  assert.equal(got.parties.length, 2);
  assert.deepEqual(got.parties.map(p => p.from.name).sort(), ['Hana', 'Rin']);
  ok('two friends running parties both show up');
}

// ── a stale row never says "join" ──────────────────────────────────────────
{
  fresh(); await tell(env);
  const inv = JSON.parse(env.LISTS.map.get('pinv:' + HOST));
  inv.at = Date.now() - 4 * 3600 * 1000;
  env.LISTS.map.set('pinv:' + HOST, JSON.stringify(inv));
  const got = await j(await call(env, { op: 'rec_pull', code: FRIEND, friends: [HOST] }));
  assert.deepEqual(got.parties, [], 'a Join button leading to a dead room is worse than no button');
  ok('an invite older than three hours is dropped on read');
}

// ── the host can take it down, and only the host ───────────────────────────
{
  fresh(); await tell(env);
  await call(env, { op: 'party_untell', from: { code: OTHER } });
  let got = await j(await call(env, { op: 'rec_pull', code: FRIEND, friends: [HOST] }));
  assert.equal(got.parties.length, 1, 'someone else must not be able to clear your party');
  await call(env, { op: 'party_untell', from: { code: HOST } });
  got = await j(await call(env, { op: 'rec_pull', code: FRIEND, friends: [HOST] }));
  assert.deepEqual(got.parties, [], 'ending the party clears the row');
  ok('only the host can clear their own party');
}

// ── nobody is interrupted ──────────────────────────────────────────────────
{
  fresh(); await tell(env);
  await Promise.all(env.pending);
  assert.deepEqual(env.pushed, [], 'starting a party must not push to anyone');
  ok('telling friends sends no push');
}

// ── junk is refused, and writes nothing ────────────────────────────────────
{
  fresh();
  assert.equal((await tell(env, { room: 'nope!!' })).status, 400);
  assert.equal((await tell(env, { room: '' })).status, 400);
  assert.equal((await call(env, { op: 'party_tell', from: {}, room: 'AAAA' })).status, 400);
  assert.equal(env.writes, 0, 'a refused request must not touch storage');
  ok('a bad room code or a missing host is refused, and writes nothing');
}

// ── a garbage friend list cannot be used to probe ──────────────────────────
{
  fresh(); await tell(env);
  const got = await j(await call(env, { op: 'rec_pull', code: FRIEND, friends: ['../pinv:' + HOST, 'rec:' + HOST, {}, null, 7] }));
  assert.deepEqual(got.parties, [], 'only well-formed codes are looked up, so no key can be reached sideways');
  ok('malformed codes in the friend list are ignored, not looked up');
}

// ── lowercase is normalised, not rejected ──────────────────────────────────
{
  fresh(); await tell(env, { room: 'k3p9' });
  const got = await j(await call(env, { op: 'rec_pull', code: FRIEND, friends: [HOST] }));
  assert.equal(got.parties[0].room, 'K3P9');
  ok('a lowercase room code is upper-cased, not thrown away');
}

console.log('\n' + n + ' passed');
