// Two devices, each with a key of its own, put onto one — by typing eight
// characters instead of twenty, and WITHOUT either list being replaced.
//
// The assertion that matters most is the dull one: joining must keep what this
// device already had. "Use code" replaces, and that is precisely why the door
// existed and nobody walked through it. If a join ever starts behaving like a
// restore, somebody loses a library to a feature named "add a device".
// run: node scripts/pair-join-test.mjs
import {spawn} from 'node:child_process';
const PORT=9047,DBG=9587;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-pairjoin`,
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

// THIS device: its own key, its own ids, a note and a favourite it must not lose.
const MINE=[
  {id:'mine-1',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:5,epTotal:24,
   notes:'rewatch the Askeladd arc',fav:true,upd:2000},
  {id:'mine-2',kind:'watch',status:'plan',title:'Tokyo Ghoul',aniId:20605,ep:0,epTotal:12,upd:2000},
];
// THE OTHER device, under a different key: same two shows with DIFFERENT ids,
// further along, plus one it has alone.
const THEIRS=[
  {id:'their-9',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:11,epTotal:24,notes:'ep 11 is the one',upd:3000},
  {id:'their-8',kind:'watch',status:'finished',title:'Tokyo Ghoul',aniId:20605,ep:12,epTotal:12,upd:3000},
  {id:'their-7',kind:'watch',status:'plan',title:'Monster',aniId:19,ep:0,epTotal:74,upd:3000},
];
// A THIRD device, on its own key, whose list has a password on it. Same two
// shows again plus one nobody else has, so a merge is distinguishable from a
// replace even after the plain join above has already happened.
const PROT=[
  {id:'prot-3',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:9,epTotal:24,upd:2500},
  {id:'prot-2',kind:'watch',status:'plan',title:'Death Note',aniId:1535,ep:0,epTotal:37,upd:3500},
];
const SEED=`
localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(MINE))});
localStorage.setItem('sync_animelist_v4','MYOWNCODE1234567890');
localStorage.setItem('key_self_animelist_v4','1');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('tut_seen_animelist_v4','1');
localStorage.setItem('seen_release','2026-10-18.62');
window.__claims=[];window.__pulled=[];window.__cancelled=[];window.__pairNew=0;
window.__used=false;window.__expired=false;window.__locked=false;window.__envelope=null;
window.__pushed=[];
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const J=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='pair_new'){window.__pairNew++;return J({ok:true,pair:'K7T2M9X4',expiresAt:Date.now()+600000,ttl:600});}
  if(b.op==='pair_cancel'){window.__cancelled.push(b.pair);return J({ok:true});}
  if(b.op==='pair_claim'){
    window.__claims.push(b.pair);
    if(window.__used)return J({ok:false,error:'used'});
    if(window.__expired)return J({ok:false,error:'expired'});
    if(b.pair==='NOPENOPE')return J({ok:false,error:'no such code'});
    if(b.pair==='PROT1234')return J({ok:true,code:'PROTCODE1234567890'});
    return J({ok:true,code:'THEIRCODE9876543210'});
  }
  if(b.op==='pull'){
    window.__pulled.push(b.code);
    if(b.code==='PROTCODE1234567890')
      return J({data:{v:3,list:window.__envelope,extra:{}},updatedAt:4000});
    if(b.code==='THEIRCODE9876543210')
      return J({data:{v:3,list:(window.__locked?(window.__locked==='garbled'?{nope:1}:{enc:1,iv:'x',ct:'y'}):${JSON.stringify(THEIRS)}),extra:{}},updatedAt:3000});
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

await ev(`openSheet('backupSheet')`); await wait(600);
t('this device starts with its own two', await ev(`anime.length`), 2);
t('and its own key', await ev(`syncCode()`), 'MYOWNCODE1234567890');

// ── offering a code ─────────────────────────────────────────────────────────
await ev(`pairOffer(null)`); await wait(500);
t('a code is offered', /K7T2 M9X4/.test(await ev(`(document.getElementById('pairBox')||{}).textContent||''`)), true);
t('in two blocks of four, the way the long key is grouped',
  /K7T2 M9X4/.test(await ev(`(document.querySelector('#pairBox .synccode')||{}).textContent||''`)), true);
t('with a countdown running', /^\d+:\d\d$/.test(await ev(`(document.getElementById('pairLeft')||{}).textContent||''`)), true);
await ev(`pairWithdraw()`); await wait(300);
t('cancelling withdraws it at the cloud too', await ev(`window.__cancelled`), ['K7T2M9X4']);
t('and clears the panel', await ev(`(document.getElementById('pairBox')||{}).textContent||''`), '');

// ── refusals that must not touch the list or the key ────────────────────────
await type('abc'); await ev(`pairJoin()`); await wait(300);
t('a short code never reaches the network', await ev(`window.__claims.length`), 0);

await type('NOPENOPE'); await ev(`pairJoin()`); await wait(600);
t('an unknown code changes nothing', [await ev(`anime.length`), await ev(`syncCode()`)], [2,'MYOWNCODE1234567890']);

await ev(`window.__used=true`); await type('K7T2M9X4'); await ev(`pairJoin()`); await wait(600);
t('a code somebody else already used changes nothing',
  [await ev(`anime.length`), await ev(`syncCode()`)], [2,'MYOWNCODE1234567890']);
await ev(`window.__used=false;window.__expired=true`); await type('K7T2M9X4'); await ev(`pairJoin()`); await wait(600);
t('an expired one changes nothing either',
  [await ev(`anime.length`), await ev(`syncCode()`)], [2,'MYOWNCODE1234567890']);

// A locked list is refused BEFORE the key is adopted — otherwise this device
// ends up pointed at a backup it cannot read, having given up its own.
await ev(`window.__expired=false;window.__locked=true`); await type('K7T2M9X4'); await ev(`pairJoin()`); await wait(700);
t('a password-locked list is refused', await ev(`anime.length`), 2);
t('AND the key is not adopted on the way to refusing it',
  await ev(`syncCode()`), 'MYOWNCODE1234567890');

// And a blob that is not a list at all, by any other route.
await ev(`window.__locked='garbled'`); await type('K7T2M9X4'); await ev(`pairJoin()`); await wait(700);
t('an unreadable blob is refused rather than merged as nothing',
  [await ev(`anime.length`), await ev(`syncCode()`)], [2,'MYOWNCODE1234567890']);

// ── the join ────────────────────────────────────────────────────────────────
await ev(`window.__locked=false`); await type('k7t2-m9x4'); await ev(`pairJoin()`); await wait(1100);
t('typed in lower case with a hyphen still joins', await ev(`syncCode()`), 'THEIRCODE9876543210');
t('three titles, not five', await ev(`anime.length`), 3);
t('the same show under two different ids does not double',
  await ev(`anime.filter(a=>a.aniId===101348).length`), 1);
t('the one only they had came across', await ev(`anime.some(a=>a.aniId===19)`), true);
t('the further episode wins', await ev(`anime.find(a=>a.aniId===101348).ep`), 11);
t('the stronger status wins', await ev(`anime.find(a=>a.aniId===20605).status`), 'finished');
t('MY note survives a JOIN, which is the whole point',
  /Askeladd/.test(await ev(`anime.find(a=>a.aniId===101348).notes||''`)), true);
t('and so does my favourite', await ev(`!!anime.find(a=>a.aniId===101348).fav`), true);
t('theirs is kept too', /ep 11 is the one/.test(await ev(`anime.find(a=>a.aniId===101348).notes||''`)), true);
t('a restore point was written first',
  await ev(`(JSON.parse(localStorage.getItem('wl_prepush_backup')||'[]')).length`), 2);
t('the key is no longer one this device invented', await ev(`localStorage.getItem('key_self_animelist_v4')`), null);
t('it read the other key before adopting it', await ev(`window.__pulled.includes('THEIRCODE9876543210')`), true);

// ── joining the same key twice ──────────────────────────────────────────────
await type('K7T2M9X4'); await ev(`pairJoin()`); await wait(800);
t('joining the key it is already on changes nothing', await ev(`anime.length`), 3);

// ── a list that really does have a password on it ──────────────────────────
// This used to be refused outright, with advice that cannot be taken: "unlock
// it on its own device and back it up again first". A protected list is ALWAYS
// stored as ciphertext, so backing it up again produces another envelope — the
// message asked for something the app can never produce, and two devices could
// not be paired at all if either had a password. It asks for the password now.
//
// The envelope is built with the app's OWN crypto rather than a hand-rolled
// one, so a change to how lists are wrapped fails here instead of passing
// against a fixture that no longer resembles the real thing.
await ev(`(async()=>{
  const master=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const e=await encList(JSON.stringify(${JSON.stringify(PROT)}),master);
  window.__envelope={v:2,enc:1,iv:e.iv,ct:e.ct,
    pw:await wrapMaster(master,'hunter2'),
    rec:await wrapMaster(master,normRecovery('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'))};
  return 1;})()`);
const beforeProt=await ev(`anime.length`);
await type('PROT1234'); await ev(`pairJoin()`); await wait(900);
t('a protected list asks for the password instead of refusing',
  await ev(`!!document.querySelector('#confirmBox.on')`), true);
t('and gives somewhere to type it that hides what you type',
  await ev(`(()=>{const i=document.getElementById('confirmIn');
    return !!i&&i.style.display!=='none'&&i.type==='password';})()`), true);
t('nothing is merged or adopted while it is asking',
  [await ev(`anime.length`), await ev(`syncCode()`)], [beforeProt,'THEIRCODE9876543210']);

await ev(`(()=>{document.getElementById('confirmIn').value='not-the-password';confirmYes();return 1;})()`);
await wait(1000);
t('a wrong password changes nothing',
  [await ev(`anime.length`), await ev(`syncCode()`)], [beforeProt,'THEIRCODE9876543210']);
t('and does not leave this device half-protected', await ev(`!!cryptoKey`), false);

await type('PROT1234'); await ev(`pairJoin()`); await wait(900);
await ev(`(()=>{document.getElementById('confirmIn').value='hunter2';confirmYes();return 1;})()`);
await wait(1400);
t('the right password joins', await ev(`syncCode()`), 'PROTCODE1234567890');
t('it MERGED rather than replaced', await ev(`anime.length`), beforeProt+1);
t('the title only the protected device had came across',
  await ev(`anime.some(a=>a.aniId===1535)`), true);
t('and my own note still survives', /Askeladd/.test(await ev(`anime.find(a=>a.aniId===101348).notes||''`)), true);
t('this device is now protected by the same password', await ev(`!!cryptoKey`), true);
t('and records that on disk', await ev(`localStorage.getItem('enc_animelist_v4')`), '1');
t('what it writes locally is ciphertext, not the titles',
  /Vinland/.test(await ev(`localStorage.getItem('animelist_v4')||''`)), false);
// The push is debounced ten seconds; the test is not going to wait for it.
// flushPush() is the same path a backgrounded app takes.
await ev(`flushPush()`); await wait(900);
t('and what it sends to the cloud is an envelope, not the titles',
  await ev(`(()=>{const p=window.__pushed[window.__pushed.length-1];
    return !!(p&&p.list&&p.list.enc===1&&p.list.ct);})()`), true);

// The recovery key is the other half of the same promise: it unwraps the same
// master key, so it has to work in the same field.
t('the recovery key opens the same envelope',
  await ev(`(async()=>{try{
    const k=await unwrapMaster(window.__envelope.rec,normRecovery('aaaa bbbb cccc dddd eeee ffff'));
    const l=JSON.parse(await decList(window.__envelope,k));
    return l.length;}catch(e){return 'no: '+(e&&e.message);}})()`), 2);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
