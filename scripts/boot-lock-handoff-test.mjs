// The opening film and the lock gate both want the whole screen on launch, and
// for a while they both took it: the lock card drew underneath the animation and
// the passkey sheet iOS raises for it landed on top of the wordmark a second in.
// This checks the handoff instead — the film plays alone, the lock appears as it
// dissolves, and nothing asks the system for a face until the overlay is gone.
// run: node scripts/boot-lock-handoff-test.mjs
import {spawn} from 'node:child_process';
const PORT=9033,DBG=9575;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-bootlock`,
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
// Headless reports "reduce" by default, which runs the SHORT film on a different
// clock. Ask for the real one, or this measures the wrong animation.
await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
sessionStorage.clear();
localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
window.fetch=()=>new Promise(()=>{});`});
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(54)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};
// Poll, never sleep. A flat 900ms assumed the app had booted by then; behind
// forty other browser launches it had not, so the very first assertion looked at
// a page with no film on it yet and everything after it fell over in sympathy.
const until=async(expr,ms=12000)=>{const t0=Date.now();
  for(;;){const v=await ev(expr);if(v)return v;
    if(Date.now()-t0>ms)return null;await wait(60);}};
const load=async()=>{
  await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
  // the app is up when its own code is defined AND the film it opens with exists
  await until(`typeof showLock==='function'&&!!document.querySelector('.wlc')`);
};

// ── the film is up ──────────────────────────────────────────────────────────
await load();
t('the film is on screen', await ev(`!!document.querySelector('.wlc')`), true);
await ev(`(()=>{window.__q=[];afterBoot(()=>window.__q.push('boot'));afterBootDone(()=>window.__q.push('done'));showLock();})()`);
t('neither beat has fired yet', await ev(`window.__q.join(',')`), '');
t('the lock stays hidden behind it', await ev(`document.getElementById('lockScreen').classList.contains('on')`), false);
t('but the app knows it is locked', await ev(`appLocked===true`), true);

// ── the dissolve ────────────────────────────────────────────────────────────
// Sleeping a fixed 3.5s and then looking assumed the machine was idle. Run this
// behind forty other browser launches and the sleep lands outside the 0.75s
// window the film is dissolving in, and a correct app reports a failure. Wait
// for the beat instead, and read everything else in the SAME evaluation so
// nothing can move between the check and the assertion.
const atHandoff=await until(`(()=>{
  if(window.__q.join(',')!=='boot')return null;
  return {q:window.__q.join(','),
          lock:document.getElementById('lockScreen').classList.contains('on'),
          film:!!document.querySelector('.wlc')};})()`);
t('the handoff has fired', atHandoff&&atHandoff.q, 'boot');
t('the lock is showing by the time it does', atHandoff&&atHandoff.lock, true);
t('and the film is still over it, handing across', atHandoff&&atHandoff.film, true);

// ── overlay gone ────────────────────────────────────────────────────────────
const atEnd=await until(`(()=>{
  if(document.querySelector('.wlc'))return null;
  return {q:window.__q.join(',')};})()`);
t('the film goes', !!atEnd, true);
t('only then does the system-sheet beat run', atEnd&&atEnd.q, 'boot,done');
t('once it is over, later callers are not delayed',
  await ev(`(()=>{let n=0;afterBoot(()=>n++);afterBootDone(()=>n++);return n;})()`), 2);

// ── skipping it ─────────────────────────────────────────────────────────────
await load();
t('a tap on the film kills it',
  await ev(`(()=>{window.__q2=[];afterBoot(()=>window.__q2.push('boot'));afterBootDone(()=>window.__q2.push('done'));
    showLock();document.querySelector('.wlc').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    return !document.querySelector('.wlc');})()`), true);
t('and hands over both beats at once', await ev(`window.__q2.join(',')`), 'boot,done');
t('the lock is up immediately', await ev(`document.getElementById('lockScreen').classList.contains('on')`), true);

// ── unlocked while it played ────────────────────────────────────────────────
await load();
t('a list unlocked mid-film never flashes the lock',
  await ev(`(()=>{showLock();appLocked=false;document.querySelector('.wlc').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    return document.getElementById('lockScreen').classList.contains('on');})()`), false);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
