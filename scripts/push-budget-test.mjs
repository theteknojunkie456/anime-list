// How many KV writes does the app actually spend? Counts op:'push' requests
// leaving the page. Most scenarios trigger the pending push with flushPush()
// rather than waiting on the debounce, so the run stays quick and deterministic;
// the two timing-dependent properties get real clocks at the end.
import {spawn} from 'node:child_process';
const PORT=8792, DIR=process.cwd();   // run from the repo root: node scripts/push-budget-test.mjs
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:DIR,stdio:'ignore'});
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prof=(process.env.TMPDIR||'/tmp')+'/wl-push-budget-profile';
const ch=spawn(CHROME,['--headless=new','--remote-debugging-port=9334',`--user-data-dir=${prof}`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run',
  '--disable-background-timer-throttling','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(2500);
const list=await (await fetch('http://127.0.0.1:9334/json/list')).json();
const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0; const waiters={};
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&waiters[m.id])waiters[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;waiters[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async expr=>{const r=await cmd('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
// Headless treats the page as hidden, and a hidden page has its timers throttled
// to roughly once a minute — which makes a 10s debounce look like it never fires.
await cmd('Emulation.setFocusEmulationEnabled',{enabled:true});

const seed=`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a1',title:'Frieren',status:'watching',kind:'watch',ep:3,epTotal:28},
 {id:'a2',title:'Dandadan',status:'watching',kind:'watch',ep:1,epTotal:12}]));
localStorage.setItem('sync_code','testcode123');
localStorage.setItem('friends',JSON.stringify([{code:'bbbbbbbbbb2',name:'Rin'}]));
localStorage.setItem('wt_seen','1');
window.__pushes=[];window.__bytes=[];
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op==='push'){window.__pushes.push(1);window.__bytes.push(((o&&o.body)||'').length);
    return Promise.resolve(new Response(JSON.stringify({ok:true,updatedAt:Date.now()}),{status:200,headers:{'Content-Type':'application/json'}}));}
  if(b.op==='rec_pull')
    return Promise.resolve(new Response(JSON.stringify({recs:[],passes:[],echoes:[],parties:[]}),{status:200,headers:{'Content-Type':'application/json'}}));
  return Promise.resolve(new Response('{"data":null,"updatedAt":0}',{status:200,headers:{'Content-Type':'application/json'}}));
};
`;
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:seed});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html`});
await wait(4500);

let pass=0,fail=0;
await ev(`window.__hooked=localStorage.setItem`);
const zero=()=>ev(`(()=>{window.__pushes=[];window.__bytes=[];return 1;})()`);
const flush=()=>ev(`(async()=>{flushPush();await new Promise(r=>setTimeout(r,250));return 1;})()`);
const n=()=>ev(`window.__pushes.length`);
const check=(name,got,want)=>{const o=got===want;o?pass++:fail++;console.log((o?'ok  ':'FAIL')+'  '+name+'  -> '+got+(o?'':' (want '+want+')'));};

// Settle: get one confirmed push on record so the fingerprint is current.
await ev(`(async()=>{const a=anime.find(x=>x.id==='a1');a.ep=5;save();flushPush();await new Promise(r=>setTimeout(r,300));return 1;})()`);

// 1. Pulls that change nothing must cost nothing. This is the loop that was
//    quietly spending the daily budget: a pull rewrites its caches, a cache
//    write schedules a push, the push re-saves an identical list.
await zero();
await ev(`(async()=>{for(let i=0;i<10;i++)await pullRecs();})()`);
await flush();
check('10 pulls that change nothing cost no writes', await n(), 0);

// 2. A burst of edits is one write, not one per edit.
await zero();
await ev(`(()=>{for(let i=0;i<5;i++){const a=anime.find(x=>x.id==='a1');a.ep=10+i;save();}return 1;})()`);
await flush();
check('5 rapid edits collapse into one write', await n(), 1);

// 3. A real change still gets through; an identical save after it does not.
await zero();
await ev(`(()=>{const a=anime.find(x=>x.id==='a2');a.ep=7;save();return 1;})()`);
await flush();
const real=await n();
await ev(`(()=>{save();return 1;})()`);
await flush();
check('a real change is written', real, 1);
check('re-saving identical content adds no write', await n(), 1);

// 4. Leaving the app must not lose a pending push.
await zero();
await ev(`(()=>{const a=anime.find(x=>x.id==='a1');a.ep=21;save();return 1;})()`);
const beforeHide=await n();
await ev(`(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
  dispatchEvent(new Event('visibilitychange'));return 1;})()`);
await wait(400);
check('nothing pending is written before the app is left', beforeHide, 0);
check('hiding the tab flushes it immediately', await n(), 1);
await ev(`(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});return 1;})()`);

// 5. A failed push must never be mistaken for "nothing changed" — otherwise the
//    guard turns one dropped connection into a backup that stops for good.
await zero();
await ev(`(()=>{const _f=window.fetch;window.__realFetch=_f;
  window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
    if(b.op==='push'){window.__pushes.push(1);return Promise.reject(new Error('offline'));}return _f(u,o);};
  const a=anime.find(x=>x.id==='a1');a.ep=25;save();return 1;})()`);
await flush();
const failed=await n();
await ev(`(()=>{window.fetch=window.__realFetch;save();return 1;})()`);
await flush();
check('a push that failed is attempted', failed, 1);
check('and is retried, not skipped as unchanged', await n(), 2);

// 6. The list must not be sent twice. `_bak` is a byte-identical mirror of the
//    list, and it used to ride along inside the settings bundle.
await zero();
await ev(`(()=>{const a=anime.find(x=>x.id==='a1');a.ep=30;save();return 1;})()`);
await flush();
const dup=await ev(`(()=>{const b=(window.__lastBody||'');return 0;})()`);
const carriesBak=await ev(`String(Object.keys(collectExtra()).some(k=>k.indexOf('_bak')>=0))`);
check('the settings bundle no longer carries a copy of the list', carriesBak, 'false');

// ── the two properties that need a real clock ──────────────────────────────
// 7. The debounce fires on its own after PUSH_WAIT. To observe that at all, the
//    things that re-arm it have to stop: save() calls schedulePush() directly,
//    and a background loop calls save() about once a second. (That this starves
//    a plain debounce is the whole point of test 8 — here it is muted so the
//    timer itself can be seen working.)
await zero();
await ev(`(()=>{
  window.__origSave=save;
  save=function(){try{writeLocal();}catch(e){}};        // persists, never schedules
  localStorage.setItem=Storage.prototype.setItem.bind(localStorage);
  const a=anime.find(x=>x.id==='a1');a.ep=33;           // in-memory: the fingerprint reads realList()
  schedulePush();                                       // the one scheduling that counts
  return 1;})()`);
await wait(13000);
const quiet=await n();
const stillPending=await ev('String(_pushPending)');
await ev(`(()=>{save=window.__origSave;localStorage.setItem=window.__hooked||localStorage.setItem;return 1;})()`);
check('with nothing re-arming it, the debounce writes on its own', quiet, 1);
check('and clears the pending flag', stillPending, 'false');

// 8. And it cannot be starved. Writing every second for longer than PUSH_MAX
//    used to re-arm the timer forever, so the push never happened at all.
await zero();
await ev(`(()=>{window.__i=0;window.__starve=setInterval(()=>{const a=anime.find(x=>x.id==='a2');a.ep=40+(window.__i++);save();},1000);return 1;})()`);
await wait(50000);
await ev(`clearInterval(window.__starve)`);
const starved=await n();
console.log((starved>=1?'ok  ':'FAIL')+'  continuous edits still get written (ceiling holds)  -> '+starved+' write(s) in 50s');
starved>=1?pass++:fail++;

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
