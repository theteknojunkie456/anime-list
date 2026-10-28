// The rail folds away and must always leave something to press to bring it back.
// run: node scripts/rail-fold-test.mjs
import {spawn} from 'node:child_process';
const PORT=9003,DBG=9543;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-fold`,
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
const ev=async x=>(await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
// The rail's folded state persists, and this test toggles it. Without clearing
// it the second run against the same browser profile starts from where the
// first one left off and reports a failure the app had nothing to do with.
localStorage.removeItem('wl_rail_folded');
window.fetch=()=>new Promise(()=>{});`});
await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
// Poll for the app rather than guessing how long it needs to boot.
{const t0=Date.now();
 for(;;){ if(await ev(`typeof toggleRail==='function'`))break;
   if(Date.now()-t0>12000)break; await wait(80);} }
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(46)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

const vis=()=>ev(`(()=>{const b=document.getElementById('nav-fold').getBoundingClientRect();
  return {x:Math.round(b.left),w:Math.round(b.width),onScreen:b.left>-1&&b.left<innerWidth&&b.width>0};})()`);

t('open to begin with', await ev(`document.documentElement.classList.contains('rail-folded')`), false);
const openX=await vis();
const openH=await ev(`Math.round(document.querySelector('.nav').getBoundingClientRect().height)`);
const openPad=await ev(`parseInt(getComputedStyle(document.getElementById('app')).paddingLeft)`);
t('the fold control is reachable', openX.onScreen, true);

await ev(`toggleRail()`); await wait(400);
t('folding hides the rail', await ev(`document.documentElement.classList.contains('rail-folded')`), true);
const foldedX=await vis();
const foldedH=await ev(`Math.round(document.querySelector('.nav').getBoundingClientRect().height)`);
const foldedPad=await ev(`parseInt(getComputedStyle(document.getElementById('app')).paddingLeft)`);
console.log('    rail height open/folded:', openH, '/', foldedH, ' padding:', openPad, '/', foldedPad);
// Folding takes away HEIGHT, not width — the capsule was always one column wide,
// so an earlier assertion about width was asking the wrong question.
t('the rail shrinks to one control tall', foldedH < openH/2, true);

console.log('    fold tab when folded:', JSON.stringify(foldedX));
t('but the control is still on screen', foldedX.onScreen, true);
t('and the page gets some width back', foldedPad < openPad, true);

await ev(`toggleRail()`); await wait(400);
t('pressing it again brings the rail back', await ev(`document.documentElement.classList.contains('rail-folded')`), false);
t('the choice is remembered', await ev(`(()=>{toggleRail();return localStorage.getItem('wl_rail_folded');})()`), '1');
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
