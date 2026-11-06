// Two things are being checked, and they are the same bug from both ends.
//
// 1. A decision about which device is right has to SURVIVE other devices
//    publishing, and has to reach a device that is already holding the newest
//    write — that device is the one that overruled everyone, so it is exactly
//    the one that must hear it.
// 2. It has to be makeable from a device that is not the one being chosen:
//    if the Mac is right and you are holding the phone, the phone has to be
//    able to say so.
// run: node scripts/device-dominance-test.mjs
import {spawn} from 'node:child_process';
const PORT=8993,DBG=9533;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-dom`,
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
// A stand-in worker that behaves like the real one: the adopt marker lives on
// the RECORD, device snapshots are kept per device, and a pull does not carry
// them. The point is the client's half of the contract, so the cloud is faked
// but faked honestly.
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a',title:'Monster',status:'finished',kind:'watch',ep:74,epTotal:74,upd:Date.now()},
 {id:'b',title:'Vinland Saga',status:'watching',kind:'watch',ep:3,epTotal:24,upd:Date.now()}]));
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
localStorage.setItem('wl_device','thisdevice1234');
window.__cloud={data:null,updatedAt:0,adopt:0,adoptBy:'',devs:{}};
window.__pushes=[];
const reply=o=>Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'Content-Type':'application/json'}}));
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const C=window.__cloud;
  if(b.op==='pull'){const {devs,...rest}=C;return reply(rest);}
  if(b.op==='devices')return reply({ok:true,devices:Object.keys(C.devs).map(k=>({id:k,...C.devs[k],data:undefined})),adopt:C.adopt});
  if(b.op==='pull_dev'){const r=C.devs[b.dev];return r?reply({ok:true,data:r.data,at:r.at,name:r.name,n:r.n}):reply({error:'no such device'});}
  if(b.op==='push'){
    window.__pushes.push(b);
    if(C.adopt&&!(+b.adopt)&&(+b.adoptSeen||0)<C.adopt)return reply({ok:false,error:'stale-adopt',adopt:C.adopt});
    C.data=b.data;C.updatedAt=Date.now();C.adopt=Math.max(C.adopt,+b.adopt||0);
    if(b.dev)C.devs[b.dev]={data:b.data,at:Date.now(),name:b.devName,n:b.n};
    return reply({ok:true,updatedAt:C.updatedAt,adopt:C.adopt});
  }
  return reply({ok:true});
};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4500);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// ── what a push now tells the cloud about itself ────────────────────────────
const p=await ev(`(async()=>{window.__pushes=[];setLastPushFP('');setPushState({n:0,at:0,why:''});
  await syncPush();const b=window.__pushes[window.__pushes.length-1]||{};
  return {dev:b.dev,named:!!b.devName,n:b.n,seen:typeof b.adoptSeen};})()`);
t('a push names its device', p.dev, 'thisdevice1234');
t('…with a label a person can read', p.named, true);
t('…and how many titles it is publishing', p.n, 2);
t('…and which decision it has honoured', p.seen, 'number');

// ── a decision made elsewhere reaches a device holding the newest write ──────
const caught=await ev(`(async()=>{
  // this device has just published, so its own clock is ahead of the cloud's
  setSyncAt(Date.now()+60000);
  window.__cloud.data={v:3,list:[{id:'z',title:'Frieren',kind:'watch',upd:Date.now()}],extra:null};
  window.__cloud.updatedAt=Date.now();window.__cloud.adopt=Date.now();window.__cloud.adoptBy='mac';
  await syncOnOpen();await new Promise(r=>setTimeout(r,400));
  return {titles:anime.map(x=>x.title),restore:!!localStorage.getItem('wl_prepush_backup')};})()`);
t('a device that is "ahead" still hears it was overruled', caught.titles, ['Frieren']);
t('and a restore point is kept before it takes the hit', caught.restore, true);

t('the same decision is honoured once, not every open',
  await ev(`(async()=>{anime=anime.concat([{id:'q',title:'Mine',kind:'watch',upd:Date.now()}]);writeLocal();
    await syncOnOpen();await new Promise(r=>setTimeout(r,300));
    return anime.some(x=>x.title==='Mine');})()`), true);

// ── the loop that was actually eating his list ──────────────────────────────
// The guard above is "honour a decision once", and it was correct. What broke
// it was arriving SETTINGS. collectExtra() uploaded wl_adopt_seen — this
// device's private note of which decision it had already applied — and
// applyExtra() wrote another device's copy of that note over it. A stale
// phone's zero landed on the Mac; the Mac then looked at a decision it had
// honoured days ago, found it newer than what it now believed it had seen, and
// took that old list whole. Every open. The key-level guard lives in
// setting-sync-test; this is the same bug from the user's end, which is the
// end he reported it from: "WHYS MY LIST KEEPING GOING BACK TO THE PAST".
const loop=await ev(`(async()=>{
  const A=Date.now();                 // a decision this device has already honoured
  setLastAdopt(A);
  // Reading wl_adopt_seen after the pull proves nothing: re-adopting WRITES that
  // marker on its way past, so the value looks untouched either way. The restore
  // point does not lie — preSyncBackup() runs on the adopt path and nowhere else.
  localStorage.removeItem('wl_prepush_backup');
  anime=[{id:'now1',title:'Newest thing I watched',kind:'watch',upd:Date.now()}];writeLocal();
  // a stale device publishes its whole settings bundle, its own adopt note inside
  window.__cloud.adopt=A;window.__cloud.adoptBy='oldphone';
  window.__cloud.data={v:3,list:[{id:'old1',title:'Last year',kind:'watch',upd:1}],
    extra:{wl_adopt_seen:'0',wl_device:'oldphone0001',animetheme:'naruto'}};
  window.__cloud.updatedAt=Date.now()+1000;setSyncAt(Date.now()-60000);
  await syncOnOpen();await new Promise(r=>setTimeout(r,500));
  return {readopted:!!localStorage.getItem('wl_prepush_backup'),
          kept:anime.some(x=>x.title==='Newest thing I watched'),
          id:wlDevice(),
          applied:localStorage.getItem('animetheme')==='naruto'};})()`);
t('arriving settings cannot re-arm an honoured decision', loop.readopted, false);
t('so the newest progress is still here after the pull', loop.kept, true);
t('and this device still answers to its own name', loop.id, 'thisdevice1234');
// Without this last row the three above could all pass because the pull bailed
// out early and applied nothing — a green test for an app that syncs nothing.
t('while the settings that SHOULD travel still arrived', loop.applied, true);

// The restore point was travelling too, so every device overwrote every other's
// and "put it back" would have handed him a stranger's library. Nothing in the
// app reads this key — it is the copy of last resort — so the only thing worth
// asserting is that an arriving bundle cannot replace it.
// The per-device note with teeth. ext_watch is "I left for a site to watch ep N
// at time T", and settling it calls autoMarkWatched() — a write to the list. On
// a device that never left, the other device's departure clock is always older
// than the fifteen minutes that mean "they watched it", so the episode gets
// marked watched where nobody watched it.
t('another device\u2019s trip cannot mark an episode watched here',
  await ev(`(()=>{
    anime=[{id:'w1',title:'Trip',kind:'watch',status:'watching',ep:1,epTotal:12,upd:Date.now()}];writeLocal();
    clearExternalWatch();
    applyExtra({ext_watch:JSON.stringify({id:'w1',ep:9,t:Date.now()-60*60*1000,s:''}),bg_bright:'42'});
    settleExternalWatch();
    return {ep:(anime.find(x=>x.id==='w1')||{}).ep, arrived:localStorage.getItem('bg_bright')==='42'};})()`),
  {ep:1,arrived:true});

t('and another device cannot overwrite this one\u2019s restore point',
  await ev(`(()=>{localStorage.setItem('wl_prepush_backup','{"mine":1}');
    applyExtra({wl_prepush_backup:'{"theirs":1}',bg_bright:'37'});
    return localStorage.getItem('wl_prepush_backup')==='{"mine":1}'
        && localStorage.getItem('bg_bright')==='37';})()`), true);

// ── being told to catch up, instead of silently overwriting ─────────────────
t('a push refused as stale pulls instead of backing off',
  await ev(`(async()=>{
    setLastAdopt(0);                       // pretend this device never saw it
    window.__cloud.adopt=Date.now()+1000;
    window.__cloud.data={v:3,list:[{id:'z',title:'Frieren',kind:'watch',upd:Date.now()}],extra:null};
    window.__cloud.updatedAt=Date.now()+1000;
    setLastPushFP('');setPushState({n:0,at:0,why:''});
    await syncPush();await new Promise(r=>setTimeout(r,500));
    return {fails:pushState().n,titles:anime.map(x=>x.title)};})()`),
  {fails:0,titles:['Frieren']});

// ── choosing another device, from this one ──────────────────────────────────
t('the picker lists this device and every other that has backed up',
  await ev(`(async()=>{
    window.__cloud.devs={mac00000001:{data:{v:3,list:[{id:'m1',title:'Mushishi',kind:'watch',upd:1},{id:'m2',title:'Berserk',kind:'watch',upd:1}],extra:null},at:Date.now(),name:'Mac',n:2}};
    renderSyncUI();
    await loadDeviceList(null);await new Promise(r=>setTimeout(r,200));
    return [...document.querySelectorAll('#devPickBox .dev-row')].map(r=>
      r.classList.contains('me')?'me':r.querySelector('.dev-id b').textContent.trim());})()`),
  ['me','Mac']);

// His phone: the server's record for THIS device said 210 titles, the app in
// front of him held none, and the row printed the server's number beside the
// words "this one". The button under it then refuses with "nothing on this
// device to send" — correct, and unreadable as anything but a broken app.
t('a device holding less than it sent says both numbers',
  await ev(`(()=>{const me=wlDevice();
    const saved=anime; anime=[];
    const html=_devRow({id:me,name:'iPhone app',n:210,at:Date.now()},me);
    anime=saved;
    return /0 titles here/.test(html)&&/210 backed up/.test(html);})()`),
  true);
t('and a device that agrees with its record stays plain',
  await ev(`(()=>{const me=wlDevice();
    const html=_devRow({id:me,name:'iPhone app',n:realList().length,at:Date.now()},me);
    return /here \u00b7/.test(html);})()`),
  false);
t('another device is always its own record',
  await ev(`(()=>{const h=_devRow({id:'mac00000001',name:'Mac',n:2,at:Date.now()},wlDevice());
    return /2 titles/.test(h)&&!/here/.test(h);})()`),
  true);

// The number somebody is actually deciding about is the one on the device in
// front of them, and it was the one the wording left out: it said what arrives
// and called what leaves "anything held only somewhere else".
t('taking another device\u2019s list says what THIS device gives up',
  await ev(`(async()=>{adoptFromDevice('mac00000001');await new Promise(r=>setTimeout(r,200));
    const m=(document.getElementById('confirmMsg')||{}).textContent||'';
    document.getElementById('confirmBox').classList.remove('on');
    return /The \\d+ titles? on this device (is|are) replaced/.test(m)&&/anything held only here is lost/.test(m);})()`),
  true);

const took=await ev(`(async()=>{window.__pushes=[];setLastAdopt(0);
  adoptFromDevice('mac00000001');await new Promise(r=>setTimeout(r,150));
  confirmYes();await new Promise(r=>setTimeout(r,900));
  const b=window.__pushes[window.__pushes.length-1]||{};
  return {titles:anime.map(x=>x.title).sort(),adopted:!!(+b.adopt),cloudAdopt:window.__cloud.adopt>0};})()`);
t('choosing the Mac from here takes the Mac list', took.titles, ['Berserk','Mushishi']);
t('and publishes it as the decision for everyone', took.adopted, true);
t('so the cloud now carries that decision', took.cloudAdopt, true);

t('an empty copy is never adopted, however it is chosen',
  await ev(`(async()=>{window.__cloud.devs.empt00000001={data:{v:3,list:[],extra:null},at:Date.now(),name:'Old phone',n:0};
    const before=anime.length;await loadDeviceList(null);
    adoptFromDevice('empt00000001');await new Promise(r=>setTimeout(r,150));
    confirmYes();await new Promise(r=>setTimeout(r,600));
    return anime.length===before;})()`), true);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
