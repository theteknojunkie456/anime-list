// A DEVICE MAY NOT QUIETLY SHRINK THE SHARED LIST.
//
// On 13 November a phone holding 210 titles replaced a cloud copy of 288 and
// said nothing. Every guard on the push path was present and every one of them
// passed: the list was not empty, it had not collapsed against what that device
// itself had stored, and the reconcile step believed the cloud held nothing
// newer. 78 titles went, and the only sign was that they were gone.
//
// Two holes, both here:
//
//   1. The reconcile step pulled inside a try and, when the pull THREW, carried
//      on to the write with `far` still null. One dropped request on a phone and
//      the device published over a copy it had never looked at. Not knowing what
//      is up there is the strongest reason not to overwrite it.
//   2. It compared TIME and never SIZE. A device can be perfectly up to date by
//      the clock and still be missing a quarter of the list — a merge that
//      stopped half way, a copy it could not open, a day offline. Nothing
//      compared the two counts, because the shared record did not carry one.
//      It does now, in plaintext, beside the ciphertext it describes.
//
// The deliberate way to shrink the shared list still works, and has to: that is
// the adopt push, where somebody pressed "use this one" and confirmed it.
import {spawn} from 'node:child_process';
const PORT=9095,DBG=9641;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-shrink`,
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
// 210 local titles, and a stubbed worker whose answers the test steers.
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
const mk=(n,from)=>Array.from({length:n},(_,i)=>({id:'t'+(from+i),title:'Title '+(from+i),
  status:'watching',kind:'watch',ep:1,epTotal:12,upd:1700000000000+i}));
localStorage.setItem('animelist_v4',JSON.stringify(mk(210,0)));
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
localStorage.setItem('onboarded_animelist_v4','1');
window.__mk=mk;
window.__pushes=[];window.__pullThrows=false;
window.__cloud={data:null,updatedAt:0,n:0};
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const R=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='pull'){
    if(window.__pullThrows)return Promise.reject(new TypeError('Failed to fetch'));
    return R(window.__cloud);
  }
  if(b.op==='push'){window.__pushes.push({n:b.n,adopt:b.adopt||0});
    return R({ok:true,updatedAt:Date.now(),adopt:b.adopt||0});}
  if(b.op==='devices')return R({ok:true,devices:[]});
  return R({ok:true});};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4600);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// Each case starts from a clean slate: no backoff, no "nothing changed" skip,
// and this device believing it is perfectly up to date — which is the state the
// old code trusted and the whole reason 210 went over 288.
// Let anything already in flight land BEFORE the slate is wiped. The app's own
// startup push (the cloud starts empty, so it offers this device's list) was
// arriving mid-case and being counted as the push under test.
const RESET=`await new Promise(r=>setTimeout(r,700));
  anime=migrate(window.__mk(210,0));writeLocal();
  window.__pushes=[];window.__pullThrows=false;
  setLastPushFP('');setPushState({n:0,at:0,why:''});
  setSyncAt(Date.now()+60000);`;       // "I am ahead of the cloud by the clock"
const setup=async(js)=>await ev(`(async()=>{
  ${RESET}
  ${js||''}
  await syncPush();
  await new Promise(r=>setTimeout(r,500));
  return {pushes:window.__pushes.slice(), have:realList().length, fails:(pushState()||{}).n||0};})()`);

t('this device really is holding 210', await ev(`realList().length`), 210);

// ── the hole that lost the titles ────────────────────────────────────────
let r=await setup(`window.__cloud={data:{v:3,list:window.__mk(288,0),extra:{}},updatedAt:1,n:288};`);
t('210 does not go over a backup of 288', r.pushes.length, 0);
t('and the device still holds its own 210 either way', r.have, 210);
t('the refusal is recorded, so backup does not go quietly dead', r.fails>0, true);

// Same shape, but the merge actually brings this device up to size: that is
// not a shrink any more and it must publish, or the fix is just an outage.
r=await setup(`setSyncAt(0);window.__cloud={data:{v:3,list:window.__mk(288,0),extra:{}},updatedAt:Date.now(),n:288};`);
t('a merge that fills the gap is allowed to publish', r.pushes.length>=1, true);
t('and what it publishes is the merged size', r.have, 288);

// ── a look that failed is not permission ─────────────────────────────────
r=await setup(`window.__pullThrows=true;`);
t('a pull that throws stops the push rather than skipping the guard', r.pushes.length, 0);
t('and that counts as a failure, so the backoff retries it', r.fails>0, true);

// ── everything that must still work ──────────────────────────────────────
r=await setup(`window.__cloud={data:{v:3,list:window.__mk(210,0),extra:{}},updatedAt:1,n:210};`);
t('a list the same size as the backup publishes normally', r.pushes.length>=1, true);

r=await setup(`window.__cloud={data:{v:3,list:window.__mk(40,0),extra:{}},updatedAt:1,n:40};`);
t('a list BIGGER than the backup publishes normally', r.pushes.length>=1, true);

r=await setup(`window.__cloud={data:{v:3,list:window.__mk(288,0),extra:{}},updatedAt:1};`);
t('a backup from an older worker, with no count, is not blocked', r.pushes.length>=1, true);

r=await setup(`window.__cloud={data:null,updatedAt:0,n:0};`);
t('an empty cloud still gets this device’s list', r.pushes.length>=1, true);

// ── and the deliberate shrink still works ────────────────────────────────
// "Use this one" is somebody saying, twice, that this copy wins. It is the only
// way the shared list is allowed to get smaller, and it must not be reconciled
// first either — a merged push is not the list they chose.
r=await ev(`(async()=>{
  ${RESET}
  window.__cloud={data:{v:3,list:window.__mk(288,0),extra:{}},updatedAt:1,n:288};
  forcePushList();
  await new Promise(r=>setTimeout(r,400));
  confirmYes();
  await new Promise(r=>setTimeout(r,1200));
  return {pushes:window.__pushes.slice(), have:realList().length};})()`);
t('"use this one" may still shrink it', r.pushes.length>=1, true);
t('it publishes this device’s list, not a merge of both', r.pushes[0]&&r.pushes[0].n, 210);
t('and it carries the stamp that says take it whole', !!(r.pushes[0]&&r.pushes[0].adopt), true);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
