// Haptics are one helper with three weights, asked for only when something
// actually changed. run: node scripts/haptics-test.mjs
import {spawn} from 'node:child_process';
const PORT=8989,DBG=9529;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-hap`,
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
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a',title:'Vinland Saga',status:'watching',kind:'watch',ep:3,epTotal:24,aniId:101348,upd:Date.now()}]));
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});
window.__buzz=[];navigator.vibrate=v=>{window.__buzz.push(v);return true;};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

t('there are exactly three weights', await ev(`Object.keys(HAPTIC).sort()`), ['done','tap','tick']);
t('finishing is the heaviest and is a pattern', await ev(`Array.isArray(HAPTIC.done)`), true);
t('a tick is lighter than a tap', await ev(`HAPTIC.tick<HAPTIC.tap`), true);
t('an unknown weight still does something', await ev(`(()=>{window.__buzz=[];tap('nonsense');return window.__buzz.length;})()`), 1);

t('finishing an unfinished show asks for the heavy one',
  await ev(`(()=>{openDetail('a');window.__buzz=[];setDetailStatus('finished');return Array.isArray(window.__buzz[0]);})()`), true);
t('and any other status is the light one',
  await ev(`(()=>{openDetail('a');window.__buzz=[];setDetailStatus('watching');return window.__buzz[0];})()`), 11);
t('a rating that does not move asks for nothing',
  await ev(`(()=>{openDetail('a');setRating(7);window.__buzz=[];setRating(7);return window.__buzz.length;})()`), 0);
t('and one that lands on a whole number taps',
  await ev(`(()=>{openDetail('a');setRating(7);window.__buzz=[];setRating(8);return window.__buzz[0];})()`), 11);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
