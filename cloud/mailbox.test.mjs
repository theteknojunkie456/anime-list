// Who may read a recommendation mailbox.
//
// rec_pull identified the caller by friend code alone — a code with a copy
// button, handed out on purpose so people can add you. Anyone holding it could
// read every note written to you. The sync code is the private one, and the
// blob stored under it already carries the friend code that device publishes.
// run: node cloud/mailbox.test.mjs
import assert from 'node:assert';
import worker from './sync-worker.js';

const ME='mecode00001', MYSYNC='MYSYNCCODE0000000001', FRIEND='frndcode0001', SNOOP='snoopcode001';
const NOTE='watch ep 12 when you are alone lol';

function mkEnv(){
  const e={pending:[],LISTS:{map:new Map(),
    async get(k){return this.map.get(k);},
    async put(k,v){this.map.set(k,v);},
    async delete(k){this.map.delete(k);}}};
  e.CHAN={idFromName:n=>n,get:()=>({fetch:async()=>new Response('ok')})};
  return e;
}
const call=(e,b)=>worker.fetch(new Request('https://x/',{method:'POST',body:JSON.stringify(b)}),e,{waitUntil:p=>{e.pending.push(p);return p;}});
const j=r=>r.json();

// The owner's device has cloud backup on, so its setup blob is stored under the
// sync code and carries the friend code it publishes.
async function setup(){
  const e=mkEnv();
  await call(e,{op:'push',code:MYSYNC,data:{v:3,list:[],extra:{friend_code:ME,animetheme:'naruto'}}});
  await call(e,{op:'rec_send',to:ME,from:{code:FRIEND,name:'Rin'},
    items:[{aniId:154587,title:'Frieren',note:NOTE}]});
  return e;
}
let n=0; const ok=m=>{n++;console.log('ok  '+m);};

// ── the owner reads their own note ─────────────────────────────────────────
{
  const e=await setup();
  const got=await j(await call(e,{op:'rec_pull',code:ME,sync:MYSYNC}));
  assert.equal(got.recs.length,1);
  assert.equal(got.recs[0].items[0].note,NOTE);
  assert.equal(got.recs[0].redacted,undefined);
  ok('the owner, presenting their sync code, reads the note');
}

// ── somebody holding only the published friend code does not ───────────────
{
  const e=await setup();
  const got=await j(await call(e,{op:'rec_pull',code:ME}));
  assert.equal(got.recs.length,1,'titles still come through, so an un-updated client keeps working');
  assert.equal(got.recs[0].items[0].note,'','the note is the part that was written for one reader');
  assert.equal(got.recs[0].redacted,true);
  ok('a friend code alone no longer reads the note');
}

// ── nor does a wrong or borrowed sync code ─────────────────────────────────
{
  const e=await setup();
  await call(e,{op:'push',code:'SNOOPSYNC00000000001',data:{v:3,list:[],extra:{friend_code:SNOOP}}});
  const got=await j(await call(e,{op:'rec_pull',code:ME,sync:'SNOOPSYNC00000000001'}));
  assert.equal(got.recs[0].items[0].note,'','a valid sync code that belongs to someone else proves nothing');
  const bogus=await j(await call(e,{op:'rec_pull',code:ME,sync:'NOSUCHSYNCCODE000001'}));
  assert.equal(bogus.recs[0].items[0].note,'','a sync code with no blob behind it proves nothing');
  ok('someone else\'s sync code, or an invented one, does not open the mailbox');
}

// ── the sender can still read back what they wrote ─────────────────────────
{
  const e=await setup();
  const sent=await j(await call(e,{op:'rec_pull',code:ME,sync:MYSYNC}));
  const id=sent.recs[0].id;
  const peek=await j(await call(e,{op:'rec_peek',to:ME,from:{code:FRIEND},id}));
  assert.equal(peek.items[0].note,NOTE,'rec_peek is gated on the SENDER\'s code and is unaffected');
  ok('the sender can still read back their own note');
}

// ── everything else still arrives ──────────────────────────────────────────
{
  const e=await setup();
  const got=await j(await call(e,{op:'rec_pull',code:ME}));
  assert.equal(got.recs[0].items[0].title,'Frieren');
  assert.equal(got.recs[0].from.name,'Rin');
  assert.deepEqual(got.passes,[]);
  assert.deepEqual(got.parties,[]);
  ok('titles, sender and the rest of the payload are untouched');
}

// ── who declined your recommendation is yours too ──────────────────────────
{
  const e=await setup();
  await call(e,{op:'rec_pass',to:ME,from:{code:FRIEND,name:'Rin'},title:'Frieren',aniId:154587});
  const owner=await j(await call(e,{op:'rec_pull',code:ME,sync:MYSYNC}));
  assert.equal(owner.passes.length,1,'the owner sees who passed');
  const snoop=await j(await call(e,{op:'rec_pull',code:ME}));
  assert.deepEqual(snoop.passes,[],'a bare friend code does not');
  assert.deepEqual(snoop.echoes,[]);
  ok('passes and echoes are withheld from unproven callers');
}

// ── clearing an offer is a write, and writes need proof ────────────────────
{
  const e=await setup();
  await call(e,{op:'src_send',to:ME,from:{code:FRIEND,name:'Rin'},pack:{src:'https://x/{query}',services:[{name:'a site',url:'https://x/{query}'}]}});
  const before=await j(await call(e,{op:'src_pull',code:ME}));
  assert.equal(before.packs.length,1);

  const denied=await call(e,{op:'src_clear',code:ME,id:''});
  assert.equal(denied.status,403,'no proof, no write — this is also a way to burn the daily write budget');
  const still=await j(await call(e,{op:'src_pull',code:ME}));
  assert.equal(still.packs.length,1,'nothing was deleted');

  const okRes=await call(e,{op:'src_clear',code:ME,sync:MYSYNC,id:''});
  assert.equal(okRes.status,200);
  const after=await j(await call(e,{op:'src_pull',code:ME}));
  assert.equal(after.packs.length,0,'the owner can still clear their own offers');
  ok('only the owner can clear the offers waiting for them');
}

console.log('\n'+n+' passed');
