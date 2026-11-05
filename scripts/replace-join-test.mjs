// "Delete the one on my phone and sync it with my Mac list."
//
// Add a device MERGES, and that is right nearly every time: two devices that
// have both been used have something each. It is wrong in exactly one case —
// the device in your hand is the one you want gone. Merging then carries its
// titles INTO the good list and up to the cloud, which is the opposite of what
// was asked, and it happens before anybody can stop it.
//
// So the join has a second mode. This file holds it to three promises:
//   1. the good list arrives whole and the bad one does not survive it,
//   2. nothing of the joining device is pushed to the key it joins,
//   3. merging — the default — is not changed by any of it.
// run: node scripts/replace-join-test.mjs
import {spawn} from 'node:child_process';
const PORT=9057,DBG=9597;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-replacejoin`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){} process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');

// THE PHONE: its own key, two titles it will not be keeping, and a note on one
// of them — a note is the most specific thing a merge preserves, so its absence
// afterwards is the clearest evidence the merge did not run.
const PHONE=[
  {id:'phone-1',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:3,epTotal:24,
   notes:'typed this on the phone',fav:true,upd:2000},
  {id:'phone-2',kind:'watch',status:'plan',title:'Tokyo Ghoul',aniId:20605,ep:0,epTotal:12,upd:2000},
];
// THE MAC, under a different key: the same two shows further along, plus one of
// its own, all under ids of its own.
const MAC=[
  {id:'mac-9',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:11,epTotal:24,notes:'the Mac knows ep 11',upd:3000},
  {id:'mac-8',kind:'watch',status:'finished',title:'Tokyo Ghoul',aniId:20605,ep:12,epTotal:12,upd:3000},
  {id:'mac-7',kind:'watch',status:'plan',title:'Monster',aniId:19,ep:0,epTotal:74,upd:3000},
];
const SEED=`
localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(PHONE))});
localStorage.setItem('sync_animelist_v4','MYOWNCODE1234567890');
localStorage.setItem('key_self_animelist_v4','1');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('tut_seen_animelist_v4','1');
localStorage.setItem('seen_release','2026-10-18.62');
window.__pushed=[];window.__empty=false;window.__pulled=[];
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const J=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='pair_claim')return J({ok:true,code:'MACCODE98765432100'});
  if(b.op==='pull'){
    window.__pulled.push(b.code);
    if(b.code==='MACCODE98765432100')
      return J({data:{v:3,list:(window.__empty?[]:${JSON.stringify(MAC)}),extra:{}},updatedAt:3000});
    return J({data:null,updatedAt:0});
  }
  if(b.op==='push'){window.__pushed.push(b.data);return J({ok:true,updatedAt:Date.now()});}
  return new Promise(()=>{});
};`;
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:SEED});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};
const type=c=>ev(`(()=>{const el=document.getElementById('pairCodeIn');if(!el)return 'no field';el.value=${JSON.stringify(c)};return 1;})()`);
const tgl=v=>ev(`(()=>{const c=document.getElementById('pairReplace');if(!c)return 'no toggle';c.checked=${v};return c.checked;})()`);
// Back to the state the phone booted in, including the flag that says this key
// was invented here — the join that just ran cleared it, and the next case is
// about what a REFUSED join leaves behind.
const reset=()=>ev(`(()=>{anime=${JSON.stringify(PHONE)};writeLocal();setSyncCode('MYOWNCODE1234567890');
  localStorage.setItem('key_self_animelist_v4','1');
  localStorage.removeItem('wl_prepush_backup');window.__pushed=[];renderSyncUI();return anime.length;})()`);

await ev(`openSheet('backupSheet')`); await wait(600);
t('the phone starts on its own key with its own two', [await ev(`anime.length`), await ev(`syncCode()`)], [2,'MYOWNCODE1234567890']);
t('the choice is offered on a device that already backs up', await tgl(false), false);

// ── the default is untouched ────────────────────────────────────────────────
await type('K7T2M9X4'); await ev(`pairJoin()`); await wait(1200);
t('left off, the join still MERGES', await ev(`anime.length`), 3);
t('and the phone’s own note still survives it',
  /typed this on the phone/.test(await ev(`anime.map(a=>a.notes||'').join(' ')`)), true);

// ── an empty backup is not allowed to land on a full device ────────────────
await reset(); await wait(400);
await ev(`window.__empty=true`); await tgl(true); await type('K7T2M9X4'); await ev(`pairJoin()`); await wait(1200);
t('replacing with an EMPTY backup is refused outright',
  [await ev(`anime.length`), await ev(`syncCode()`)], [2,'MYOWNCODE1234567890']);
t('and the refusal does not cost the phone its own key either',
  await ev(`localStorage.getItem('key_self_animelist_v4')`), '1');

// ── the thing he actually asked for ─────────────────────────────────────────
await ev(`window.__empty=false`); await reset(); await wait(400);
await tgl(true); await type('k7t2-m9x4'); await ev(`pairJoin()`); await wait(1400);
t('the key is joined', await ev(`syncCode()`), 'MACCODE98765432100');
t('three titles — the Mac’s, not five', await ev(`anime.length`), 3);
t('and they are the MAC’s rows, id for id',
  await ev(`anime.map(a=>a.id).sort()`), ['mac-7','mac-8','mac-9']);
t('nothing of the phone’s survived', await ev(`anime.some(a=>/^phone-/.test(a.id))`), false);
t('including the note, which a merge would have kept',
  /typed this on the phone/.test(await ev(`anime.map(a=>a.notes||'').join(' ')`)), false);
t('the Mac’s own note came across whole',
  /the Mac knows ep 11/.test(await ev(`anime.map(a=>a.notes||'').join(' ')`)), true);
t('a restore point was written BEFORE anything was dropped',
  await ev(`(JSON.parse(localStorage.getItem('wl_prepush_backup')||'[]')).length`), 2);
t('it read the Mac’s copy before taking it', await ev(`window.__pulled.includes('MACCODE98765432100')`), true);
t('the key is no longer one this device invented', await ev(`localStorage.getItem('key_self_animelist_v4')`), null);

// The promise that makes this safe to do from the wrong device: joining a list
// must not change the list being joined.
await ev(`flushPush()`); await wait(1000);
t('and NOTHING of the phone’s was pushed to the key it joined',
  await ev(`JSON.stringify(window.__pushed||[]).includes('phone-')`), false);

// ── the same choice exists before backup is ever turned on ─────────────────
await ev(`(()=>{setSyncCode('');renderSyncUI();return 1;})()`); await wait(500);
t('a device with no backup yet is offered it too', await tgl(true), true);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
