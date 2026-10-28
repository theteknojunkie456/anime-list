// The storage budget is for the user's images. It must not count the service
// worker's cache of the app's own code, which is what made "storage full" appear
// on a device that was nowhere near full.
// run: node scripts/storage-truth-test.mjs
import {spawn} from 'node:child_process';
const PORT=8999,DBG=9539;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-stg`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// Poll for the debugger rather than guessing how long Chrome needs to come
// up. A fixed sleep is why this reported ECONNREFUSED on a loaded machine —
// a failure about the harness, wearing the clothes of a failure about the
// app, which is the worst kind to read at the bottom of a run.
let tabs=null;
for(let _i=0;_i<120;_i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  // Take the server and the browser down with it. Exiting without this
  // leaks both, and the next run's preflight refuses to start because the
  // ports it needs are held by the run that already gave up.
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){}
  process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
// onopen alone never fires if the socket errors or closes instead, which is the
// same infinite wait one line earlier.
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('the test browser refused the connection'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
// A command the browser never answers makes this promise wait forever, and
// every poll in the file is built on it — so one stalled socket is not a slow
// test, it is a test that never ends. Deadline, then say which command died.
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[]');
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const MB=1048576;
// 40MB total, of which 38MB is the app's own cached code
const mostlyCode=await ev(`(async()=>{
  navigator.storage.estimate=async()=>({usage:${40*MB},quota:${500*MB},usageDetails:{caches:${38*MB},indexedDB:${2*MB}}});
  return await storeUsed();})()`);
t('the app\\u2019s own cache is not the user\\u2019s data', Math.round(mostlyCode/MB), 2);

t('so a 50MB budget still has room', await ev(`(async()=>await storeRoomFor(${1*MB}))()`), true);

// without the cache subtracted this device would have been "full"
const naive=await ev(`(async()=>{const e=await navigator.storage.estimate();return Math.round(e.usage/${MB});})()`);
t('where the raw figure alone would have said 40MB used', naive, 40);

// genuinely full is still refused
t('a budget genuinely exceeded is still refused',
  await ev(`(async()=>{
    navigator.storage.estimate=async()=>({usage:${60*MB},quota:${500*MB},usageDetails:{caches:${2*MB},indexedDB:${58*MB}}});
    return await storeRoomFor(${1*MB});})()`), false);

t('a browser that gives no breakdown does not over-report',
  await ev(`(async()=>{
    navigator.storage.estimate=async()=>({usage:${90*MB},quota:${500*MB}});
    const u=await storeUsed();return u<=${90*MB}&&u>=0;})()`), true);

t('and no estimate at all is not treated as full',
  await ev(`(async()=>{const s=navigator.storage.estimate;delete navigator.storage.estimate;
    const r=await storeRoomFor(${1*MB});navigator.storage.estimate=s;return r;})()`), true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
