// An admin can stage somebody's SETTINGS before they have opened the app. It must
// apply once, never touch a list, and never write a key off the allowed list.
// run: node scripts/admin-provision-test.mjs
import {spawn} from 'node:child_process';
const PORT=8993,DBG=9533;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-pv`,
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
 {id:'keep',title:'Already Here',status:'watching',kind:'watch',ep:2,epTotal:12,upd:Date.now()}]));
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const applied=await ev(`(()=>{localStorage.removeItem('wl_setup_seen');
  applySetup({at:1000,keys:{wl_sources:'["a","b"]',animetheme:'acid'}});
  return {src:localStorage.getItem('wl_sources'), theme:localStorage.getItem('animetheme'),
          seen:localStorage.getItem('wl_setup_seen')};})()`);
t('a staged setup is applied', applied.src, '["a","b"]');
t('including the theme', applied.theme, 'acid');
t('and the stamp is remembered', applied.seen, '1000');

t('the same stamp is ignored the second time',
  await ev(`(()=>{localStorage.setItem('wl_sources','MINE');
    applySetup({at:1000,keys:{wl_sources:'["a","b"]'}});
    return localStorage.getItem('wl_sources');})()`), 'MINE');

t('an older stamp is ignored too',
  await ev(`(()=>{applySetup({at:500,keys:{wl_sources:'OLD'}});return localStorage.getItem('wl_sources');})()`), 'MINE');

t('a newer one is taken',
  await ev(`(()=>{applySetup({at:2000,keys:{wl_sources:'NEWER'}});return localStorage.getItem('wl_sources');})()`), 'NEWER');

t('a key that is not on the list is refused',
  await ev(`(()=>{applySetup({at:3000,keys:{animelist_v4:'[]',evil:'x'}});
    return {list:JSON.parse(localStorage.getItem('animelist_v4')||'[]').length, evil:localStorage.getItem('evil')};})()`),
  {list:1,evil:null});

t('the list survives a setup that tried to replace it', await ev(`realList().length`), 1);
t('nothing happens with no setup at all',
  await ev(`(()=>{const b=localStorage.getItem('wl_sources');applySetup(null);applySetup({});
    return localStorage.getItem('wl_sources')===b;})()`), true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
