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
const load=async()=>{await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});await wait(900);};

// ── the film is up ──────────────────────────────────────────────────────────
await load();
t('the film is on screen', await ev(`!!document.querySelector('.wlc')`), true);
await ev(`(()=>{window.__q=[];afterBoot(()=>window.__q.push('boot'));afterBootDone(()=>window.__q.push('done'));showLock();})()`);
t('neither beat has fired yet', await ev(`window.__q.join(',')`), '');
t('the lock stays hidden behind it', await ev(`document.getElementById('lockScreen').classList.contains('on')`), false);
t('but the app knows it is locked', await ev(`appLocked===true`), true);

// ── the dissolve ────────────────────────────────────────────────────────────
await wait(3500);   // ~4.4s in: past the 4.0s handoff, inside the fade
t('the handoff has fired', await ev(`window.__q.join(',')`), 'boot');
t('the lock is now showing', await ev(`document.getElementById('lockScreen').classList.contains('on')`), true);
t('the film is still dissolving over it', await ev(`!!document.querySelector('.wlc')`), true);

// ── overlay gone ────────────────────────────────────────────────────────────
await wait(1200);   // ~5.6s in
t('the film is gone', await ev(`!!document.querySelector('.wlc')`), false);
t('only now does the system-sheet beat run', await ev(`window.__q.join(',')`), 'boot,done');
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
