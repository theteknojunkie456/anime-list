// "Use this device's list everywhere" is the one deliberately destructive button
// in the app, so it has to refuse the cases where destroying is never meant.
// run: node scripts/force-push-test.mjs
import {spawn} from 'node:child_process';
const PORT=8981,DBG=9521;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-fp`,
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
 {id:'a',title:'Monster',status:'finished',kind:'watch',ep:74,epTotal:74,aniId:19,upd:Date.now()},
 {id:'b',title:'Vinland Saga',status:'watching',kind:'watch',ep:3,epTotal:24,aniId:101348,upd:Date.now()}]));
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
window.__pushes=0;
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op==='push'){window.__pushes++;return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}}));}
  return Promise.resolve(new Response('{"ok":true,"data":null,"updatedAt":0}',{status:200,headers:{'Content-Type':'application/json'}}));};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

t('it asks before doing anything',
  await ev(`(()=>{window.__pushes=0;forcePushList();
    return {open:document.getElementById('confirmBox').classList.contains('on'), pushed:window.__pushes};})()`),
  {open:true,pushed:0});

const did=await ev(`(async()=>{window.__pushes=0;confirmYes();await new Promise(r=>setTimeout(r,900));
  return {pushed:window.__pushes, backup:!!localStorage.getItem('wl_prepush_backup')};})()`);
t('confirming sends it', did.pushed>=1, true);
t('and a restore point was written first', did.backup, true);

t('the restore point holds the list it replaced',
  await ev(`(()=>{const b=JSON.parse(localStorage.getItem('wl_prepush_backup')||'{}');
    return {n:b.n, titles:JSON.parse(b.list||'[]').map(x=>x.title).sort()};})()`),
  {n:2,titles:['Monster','Vinland Saga']});

// the refusals
t('an empty list is refused outright',
  await ev(`(()=>{const keep=anime;anime=[];window.__pushes=0;
    forcePushList();
    const asked=document.getElementById('confirmBox').classList.contains('on');
    anime=keep;return {asked,pushed:window.__pushes};})()`), {asked:false,pushed:0});

t('a locked list is refused',
  await ev(`(()=>{appLocked=true;window.__pushes=0;forcePushList();
    const asked=document.getElementById('confirmBox').classList.contains('on');
    appLocked=false;return {asked,pushed:window.__pushes};})()`), {asked:false,pushed:0});

t('an untrusted list is refused',
  await ev(`(()=>{listUntrusted=true;window.__pushes=0;forcePushList();
    const asked=document.getElementById('confirmBox').classList.contains('on');
    listUntrusted=false;return {asked,pushed:window.__pushes};})()`), {asked:false,pushed:0});

t('with no cloud backup on, it refuses',
  await ev(`(()=>{const c=localStorage.getItem('sync_animelist_v4');localStorage.removeItem('sync_animelist_v4');
    window.__pushes=0;forcePushList();
    const asked=document.getElementById('confirmBox').classList.contains('on');
    localStorage.setItem('sync_animelist_v4',c);return {asked,pushed:window.__pushes};})()`), {asked:false,pushed:0});
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
