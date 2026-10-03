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
