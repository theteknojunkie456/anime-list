// A DEVICE ON THE RIGHT KEY THAT CANNOT READ WHAT IS UNDER IT.
//
// Join a protected list without its password and the automatic pull used to
// recognise the envelope, fail to open it, and return without a word — on every
// open, for ever. On a device that had just joined, and so had no list of its
// own, that is a WatchList showing zero titles with no error, no prompt and
// nothing to tap, while the list sits on the key it is already pointed at.
//
// Typing the code by hand has always handled this: it stores the envelope and
// shows the lock screen. This is the same situation arriving the other way, so
// it has to ask the same question.
//
// run: node scripts/cloud-unlock-test.mjs
import {spawn} from 'node:child_process';
const PORT=9061,DBG=9601;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-cu`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
const down=()=>{try{srv.kill();}catch(e){}try{ch.kill();}catch(e){}};
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s'); down(); process.exit(1); }
const ws=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('no connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];console.log('the test browser stopped answering ('+m+')');down();process.exit(1);}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');

// This device has joined the key and has nothing of its own — the state a phone
// is in the moment after it takes on a computer's list.
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[]');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
window.__env=null;
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op==='push')return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}}));
  return Promise.resolve(new Response(JSON.stringify({ok:true,data:{v:3,list:window.__env,extra:null},updatedAt:Date.now()}),
    {status:200,headers:{'Content-Type':'application/json'}}));};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// A real envelope, built with the app's own crypto rather than a stand-in, so
// what is being tested is the actual unwrap-and-decrypt and not a shape match.
const built=await ev(`(async()=>{
  const master=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const list=[{id:'c1',title:'On The Computer',status:'watching',kind:'watch',ep:3,epTotal:12,upd:Date.now()},
              {id:'c2',title:'Also On It',status:'plan',kind:'watch',ep:0,upd:Date.now()}];
  const pw=await wrapMaster(master,'hunter2');
  const {iv,ct}=await encList(JSON.stringify(list),master);
  window.__env={v:2,enc:1,iv,ct,pw};
  // The dialog itself is not what is under test; answering it is.
  window.__asked=0;window.__answer='hunter2';
  window.askConfirm=function(o){window.__asked++;if(o&&o.onYes)return o.onYes(window.__answer);};
  return isEnvelope(window.__env);})()`);
t('the test is handing it a genuine encrypted envelope', built, true);

// ── the bug ─────────────────────────────────────────────────────────────────
const asked=await ev(`(async()=>{_askedCloudPw=false;cryptoKey=null;envWraps=null;appLocked=false;
  anime=[];setSyncAt(0);window.__asked=0;
  await syncOnOpen();await new Promise(r=>setTimeout(r,600));
  return {asked:window.__asked,titles:anime.map(a=>a.title).sort(),key:!!cryptoKey};})()`);
t('a list it cannot read makes it ask, not shrug', asked.asked, 1);
t('and the right password brings the list through', asked.titles, ['Also On It','On The Computer']);
t('and the device takes on the protection with it', asked.key, true);

// ── the costs of asking ─────────────────────────────────────────────────────
const twice=await ev(`(async()=>{cryptoKey=null;envWraps=null;anime=[];setSyncAt(0);window.__asked=0;
  await syncOnOpen();await new Promise(r=>setTimeout(r,400));
  await syncOnOpen();await new Promise(r=>setTimeout(r,400));
  return window.__asked;})()`);
t('it asks once a session, not on every open', twice, 0);

const wrong=await ev(`(async()=>{_askedCloudPw=false;cryptoKey=null;envWraps=null;appLocked=false;
  anime=[];setSyncAt(0);window.__answer='not the password';window.__asked=0;
  await syncOnOpen();await new Promise(r=>setTimeout(r,600));
  window.__answer='hunter2';
  return {asked:window.__asked,titles:anime.length,key:!!cryptoKey};})()`);
t('a wrong password changes nothing', wrong.titles, 0);
t('and leaves the device unprotected rather than half-protected', wrong.key, false);

// The lock screen is already asking for this exact password. Two prompts for one
// secret is how somebody ends up typing it into the wrong one.
const locked=await ev(`(async()=>{_askedCloudPw=false;cryptoKey=null;envWraps=null;
  appLocked=true;anime=[];setSyncAt(0);window.__asked=0;
  await syncOnOpen();await new Promise(r=>setTimeout(r,400));
  appLocked=false;return window.__asked;})()`);
t('it stays quiet while the lock screen is up', locked, 0);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();down();process.exit(fail?1:0);
