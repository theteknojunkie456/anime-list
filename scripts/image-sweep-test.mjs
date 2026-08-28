// Uploaded artwork lives in IndexedDB under <item id>:<field>. Nothing ever
// deleted it, so storage only went up. run: node scripts/image-sweep-test.mjs
import {spawn} from 'node:child_process';
const PORT=8943,DBG=9483;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-sweep2`,
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
localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const setup=`(async()=>{
  anime=[{id:'keep1',title:'Kept',kind:'watch',status:'watching',imgKey:'keep1:img'},
         {id:'keep2',title:'Also kept',kind:'watch',status:'plan',bgKey:'keep2:bgImage'}];
  await idbSet('keep1:img','data:image/png;base64,AAAA');
  await idbSet('keep2:bgImage','data:image/png;base64,BBBB');
  await idbSet('gone9:img','data:image/png;base64,CCCC');       // a deleted title's cover
  await idbSet('gone9:bgImage','data:image/png;base64,DDDD');   // and its backdrop
  await idbSet('__list__','[]');                                // reserved
  await idbSet('__creds__','{}');                               // reserved
  await idbSet('something-else','keep me');                     // not our shape
  const before=(await idbKeys()).sort();
  const removed=await sweepImages(true);
  const after=(await idbKeys()).sort();
  return {before,removed,after};})()`;
const r=await ev(setup);
console.log('    before:', JSON.stringify(r.before));
console.log('    after :', JSON.stringify(r.after));
t('it removes both orphans', r.removed, 2);
t('and keeps everything still referenced', r.after.includes('keep1:img')&&r.after.includes('keep2:bgImage'), true);
t('reserved keys are untouched', r.after.includes('__list__')&&r.after.includes('__creds__'), true);
t('a key that is not our shape is left alone', r.after.includes('something-else'), true);
t('the orphans are actually gone', r.after.includes('gone9:img')||r.after.includes('gone9:bgImage'), false);

// the dangerous case: never sweep against a list that is not the real one
const locked=await ev(`(async()=>{
  await idbSet('orphanX:img','data:image/png;base64,EEEE');
  const savedLocked=appLocked; appLocked=true;
  const n=await sweepImages(true);
  appLocked=savedLocked;
  const keys=await idbKeys();
  return {removed:n,still:keys.indexOf('orphanX:img')>=0};})()`);
t('a locked list sweeps nothing', locked.removed, 0);
t('so nothing is lost while the list is a placeholder', locked.still, true);

const untrusted=await ev(`(async()=>{
  const saved=listUntrusted; listUntrusted=true;
  const n=await sweepImages(true);
  listUntrusted=saved;
  return n;})()`);
t('nor after corrupt storage', untrusted, 0);

// and it does not thrash
const twice=await ev(`(async()=>{await sweepImages(true);return await sweepImages(false);})()`);
t('a second sweep straight after does nothing', twice, 0);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
