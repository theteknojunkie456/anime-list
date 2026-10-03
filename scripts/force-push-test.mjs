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
