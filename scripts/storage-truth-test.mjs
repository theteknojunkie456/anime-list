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
await wait(3200);
const tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;w[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
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
