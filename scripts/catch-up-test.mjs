// ONE LIST, NOT TWO THAT USUALLY AGREE.
//
// The push side now refuses to publish a list that would shrink the backup.
// That is right, and on its own it is only half: refusing protects the backup
// and leaves the device sitting on the short list, silently, for as long as
// nobody notices. A phone held 210 titles for three days while the backup held
// 288 and nothing on either side was in a position to say so.
//
// The reason it never caught up is that the merge gate was the CLOCK alone, and
// the clock only answers "has anything happened since I last looked". A device
// can be perfectly current by that question and still be missing a third of the
// list. The count on the shared copy makes the other question askable without a
// key — it holds more than I do — so the device pulls itself up on open.
//
// What this file mostly checks is that it does NOT do that the rest of the
// time: a device with MORE than the backup must not take the smaller copy, a
// device in step must not merge on every open, and an older worker that sends
// no count must behave exactly as before.
import {spawn} from 'node:child_process';
const PORT=9097,DBG=9643;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-catchup`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){ await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; } }
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){} process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('never accepted a connection')),20000);
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
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
const mk=(n,from)=>Array.from({length:n},(_,i)=>({id:'t'+(from+i),title:'Title '+(from+i),
  status:'watching',kind:'watch',ep:1,epTotal:12,upd:1700000000000+i}));
localStorage.setItem('animelist_v4',JSON.stringify(mk(210,0)));
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
localStorage.setItem('onboarded_animelist_v4','1');
window.__mk=mk;window.__pushes=[];
window.__cloud={data:null,updatedAt:0,n:0};
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const R=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='pull')return R(window.__cloud);
  if(b.op==='push'){window.__pushes.push({n:b.n});return R({ok:true,updatedAt:Date.now(),adopt:0});}
  if(b.op==='devices')return R({ok:true,devices:[]});
  return R({ok:true});};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4600);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// Every case begins from the state that used to be a dead end: this device is
// short, and by the clock it has nothing to collect.
const open=async(local,cloudN,cloudList,stamp)=>await ev(`(async()=>{
  await new Promise(r=>setTimeout(r,600));
  anime=migrate(window.__mk(${local},0));writeLocal();
  window.__pushes=[];setPushState({n:0,at:0,why:''});
  // "This exact list is already the cloud copy" — the real state of a device
  // that has nothing to say. Blanking the fingerprint instead would make every
  // case push once for free and the write counts below would mean nothing.
  setLastPushFP(pushFingerprint(syncCode()));
  const mark=Date.now()+60000;        // "I am ahead of the cloud by the clock"
  setSyncAt(mark);
  window.__cloud={data:{v:3,list:window.__mk(${cloudList},0),extra:{}},updatedAt:${stamp},n:${cloudN}};
  await syncOnOpen();
  // Read the mark HERE, before the push: a successful push sets it to the
  // server's write time, which is the push path doing its job and would drown
  // out the merge's own handling of it.
  const markBack=syncAt()<mark;
  // The push after a merge is debounced by ten seconds. Flush it rather than
  // wait: what is being checked is that one was asked for, not the timer.
  try{flushPush();}catch(e){}
  await new Promise(r=>setTimeout(r,900));
  return {have:realList().length, pushes:window.__pushes.length, markBack};})()`);

// ── the dead end, now a way out ──────────────────────────────────────────
let r=await open(210,288,288,1);
t('a device behind the backup takes it, clock or no clock', r.have, 288);
t('and publishes the result, so both sides end up level', r.pushes>=1, true);
t('without walking its own sync mark backwards', r.markBack, false);

// ── everything that must NOT start happening ─────────────────────────────
r=await open(288,288,288,1);
t('a device in step does not merge on every open', r.have, 288);
t('and does not spend a write saying so', r.pushes, 0);

// The dangerous inverse: this device has MORE. Taking the smaller copy here is
// the bug the whole guard exists to prevent, arriving through the other door.
r=await open(288,210,210,1);
t('a device AHEAD of the backup does not take the smaller copy', r.have, 288);

r=await open(280,288,288,1);
t('a gap too small to mean anything is left alone', r.have, 280);

// An older worker sends no count at all. Nothing may change for it.
r=await ev(`(async()=>{
  await new Promise(r=>setTimeout(r,600));
  anime=migrate(window.__mk(210,0));writeLocal();
  window.__pushes=[];setLastPushFP('');setPushState({n:0,at:0,why:''});
  setSyncAt(Date.now()+60000);
  window.__cloud={data:{v:3,list:window.__mk(288,0),extra:{}},updatedAt:1};
  await syncOnOpen();
  await new Promise(r=>setTimeout(r,600));
  return {have:realList().length};})()`);
t('a backup from an older worker still goes by the clock alone', r.have, 210);

// And the ordinary case has to keep working: newer by the clock, merge.
r=await ev(`(async()=>{
  await new Promise(r=>setTimeout(r,600));
  anime=migrate(window.__mk(210,0));writeLocal();
  window.__pushes=[];setLastPushFP('');setPushState({n:0,at:0,why:''});
  setSyncAt(0);
  window.__cloud={data:{v:3,list:window.__mk(288,0),extra:{}},updatedAt:Date.now(),n:288};
  await syncOnOpen();
  await new Promise(r=>setTimeout(r,600));
  return {have:realList().length};})()`);
t('a newer backup still merges the way it always did', r.have, 288);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
