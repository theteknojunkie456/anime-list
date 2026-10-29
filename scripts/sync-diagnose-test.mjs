// The diagnostic has to report the disagreement correctly and must not change
// anything while doing it. run: node scripts/sync-diagnose-test.mjs
import {spawn} from 'node:child_process';
const PORT=8983,DBG=9523;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-dg`,
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
const OLD=Date.now()-86400000, NEW=Date.now();
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a',title:'Here Only',status:'watching',kind:'watch',ep:1,epTotal:12,upd:${NEW}}]));
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
window.__pushes=0;
window.__cloud=JSON.stringify([
 {id:'a',title:'Here Only',status:'watching',kind:'watch',ep:1,epTotal:12,upd:${OLD}},
 {id:'b',title:'Cloud Only',status:'plan',kind:'watch',ep:0,upd:${OLD}}]);
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op==='push'){window.__pushes++;return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}}));}
  return Promise.resolve(new Response(JSON.stringify({ok:true,data:window.__cloud,updatedAt:${OLD}}),{status:200,headers:{'Content-Type':'application/json'}}));};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const before=await ev(`JSON.stringify({n:realList().length,at:syncAt()})`);
// Opening the app merges a cloud copy that differs from this device's, and
// that merge pushes — correctly. Counting pushes across a window that happened
// to contain it made this test pass or fail on whether a 10-second timer landed
// before or after a line, which is a coin toss wearing a test's clothes. The
// pending push is cleared and the count is taken either side of the call, so
// what is measured is what THIS call did.
const d=await ev(`(async()=>{
  try{clearTimeout(pushT);_pushPending=false;_pushSince=0;}catch(e){}
  const p0=window.__pushes;
  const d=await syncDiagnose();
  return {lc:d.localCount,cc:d.cloudCount,
  newerHere:d.localNewest>d.cloudNewest, build:d.build, fails:d.pushFails, pushed:window.__pushes-p0};})()`);
console.log('    ', JSON.stringify(d));
t('it counts this device', d.lc, 1);
t('and counts the cloud copy', d.cc, 2);
t('and says which side is newer', d.newerHere, true);
t('and reports the build', typeof d.build==='string'&&d.build.length>3, true);

const after=await ev(`JSON.stringify({n:realList().length,at:syncAt()})`);
t('it changed nothing it looked at', after, before);
t('and sent nothing while it looked', d.pushed, 0);

const txt=await ev(`(async()=>{document.body.insertAdjacentHTML('beforeend','<div id="syncDiagBox"></div>');
  await showSyncDiagnosis();return document.getElementById('syncDiagBox').textContent;})()`);
t('and says so in words', /THIS device holds the newer edits/.test(txt), true);
t('listing both counts', /Titles here1|Titles here\s*1/.test(txt.replace(/\s+/g,'')+txt), true);

// An encrypted cloud copy must report "not readable", never "never". The first
// version said "never", which reads as "the cloud has no edits" — a completely
// different claim from "I could not open it", and the exact kind of confident
// wrong number this screen exists to prevent.
const enc = await ev(`(async()=>{
  window.__cloud = JSON.stringify({v:2, ct:"nonsense", iv:"nope"});
  cryptoKey = null;
  const d = await syncDiagnose();
  await showSyncDiagnosis();
  const txt = document.getElementById("syncDiagBox").textContent;
  return {unknown: !!d.cloudUnknown,
          saysNever: /Newest edit in cloud\\s*never/i.test(txt),
          saysUnreadable: /not readable here/.test(txt),
          verdict: /cannot be compared/.test(txt)};})()`);
console.log("    encrypted:", JSON.stringify(enc));
t("an unreadable cloud copy is marked unknown", enc.unknown, true);
t("and is never reported as never", enc.saysNever, false);
t("it says plainly that it could not read it", enc.saysUnreadable, true);
t("and refuses to claim a comparison", enc.verdict, true);
// ── the panel has to FIT ────────────────────────────────────────────────────
// The folds in here inset their contents, and for a while they did it with
// margin — so a child asking for width:100% measured the full content box and
// then added the inset outside it, and overflow:hidden cut the difference off.
// What you saw was the right end of "Check both sides", "Show my devices" and
// the "Use this one" rows missing, on a screen with room to spare. Nothing in
// the panel announced it; you had to notice the button was a button-and-a-bit.
// So this asks the only question that matters and asks it of EVERY box: does
// anything stick out past the thing that contains it.
// The panel lives inside Settings, so it has to be ON SCREEN before any of
// this means anything — a box of zero width overflows nothing, and a check
// that cannot fail is worse than no check. Hence the width guard: if the panel
// is not actually laid out, this reports that instead of a clean bill.
const overflow=async()=>ev(`(()=>{
  try{closeAll()}catch(e){} try{openSheet('settingsSheet')}catch(e){}
  try{renderSyncUI()}catch(e){}
  const box=document.getElementById('syncBox'); if(!box)return 'no panel';
  if(box.getBoundingClientRect().width<100)return 'the panel never opened, so nothing was measured';
  box.querySelectorAll('details.dt-fold').forEach(d=>d.open=true);
  const dp=document.getElementById('devPickBox');
  if(dp&&typeof _devRow==='function')
    dp.innerHTML=_devRow({id:'d1',name:'A device with a name long enough to crowd the row',n:283,at:Date.now()},'d1');
  const out=[];
  const walk=el=>{
    const r=el.getBoundingClientRect(); if(r.width<4)return;
    if(el.scrollWidth-el.clientWidth>1)out.push((el.className||el.tagName)+' clips '+(el.scrollWidth-el.clientWidth)+'px');
    for(const c of el.children){
      if(c.getBoundingClientRect().right-r.right>0.5)
        out.push(((c.className||c.tagName)+'').split(' ')[0]+' sticks out of '+((el.className||el.tagName)+'').split(' ')[0]);
      walk(c);
    }
  };
  walk(box); return out.slice(0,6);})()`);

for(const [label,w] of [['on a phone',390],['on a laptop',1280]]){
  await cmd('Emulation.setDeviceMetricsOverride',{width:w,height:900,deviceScaleFactor:1,mobile:w<700});
  await wait(350);
  t('nothing in the cloud panel is cut off '+label, await overflow(), []);
}

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
