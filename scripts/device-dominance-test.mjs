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
