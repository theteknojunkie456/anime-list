// Two failures from a real problem log: 1,690 consecutive backup retries with
// no backoff, and 42 QuotaExceededErrors where the list simply did not save.
// run: node scripts/quota-backoff-test.mjs
import {spawn} from 'node:child_process';
const PORT=8947,DBG=9487;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-q`,
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
localStorage.setItem('animelist_v4','[{"id":"a1","title":"Monster","status":"watching","kind":"watch","ep":3,"epTotal":74,"aniId":19}]');
localStorage.setItem('wl_net_status','approved');localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
window.__pushes=0;
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op==='push'){window.__pushes++;return Promise.reject(new Error('Failed to fetch'));}
  return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}}));};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// ── backoff ──
const hammer=await ev(`(async()=>{
  setPushState({n:0,at:0,why:''}); window.__pushes=0;
  for(let i=0;i<12;i++){ setLastPushFP(''); await syncPush(); }
  return {tries:window.__pushes, fails:pushState().n};})()`);
console.log('    after 12 attempts:', JSON.stringify(hammer));
t('it stops hammering once it is clearly failing', hammer.tries<=4, true);
t('and remembers it is failing', hammer.fails>=3, true);

const later=await ev(`(async()=>{
  const st=pushState(); setPushState({n:st.n,at:Date.now()-7200000,why:st.why});  // two hours ago
  window.__pushes=0; setLastPushFP(''); await syncPush();
  return window.__pushes;})()`);
t('but it does try again after long enough', later, 1);

// ── quota recovery ──
const rec=await ev(`(async()=>{
  const s=store()||localStorage;
  s.setItem('recs_in','["x"]'); s.setItem('upcoming_related','["y"]'); s.setItem(LSKEY+'_bak','spare');
  const dropped=_dropDisposable();
  return {dropped, recs:s.getItem('recs_in'), rel:s.getItem('upcoming_related'),
          keptFriends:s.getItem('friends')!==null||true};})()`);
t('the disposable caches are dropped', rec.dropped, true);
t('and are actually gone', rec.recs===null&&rec.rel===null, true);

const spare=await ev(`(()=>{const s=store()||localStorage;
  const before=s.getItem(LSKEY+'_bak')!==null;
  const dropped=_dropSpareCopy(s);
  return {before,dropped,after:s.getItem(LSKEY+'_bak')===null};})()`);
t('the spare copy goes only when asked', spare.before&&spare.dropped&&spare.after, true);

const safe=await ev(`(()=>{const s=store()||localStorage;
  s.setItem('friends','[{"code":"x"}]'); s.setItem('animetheme','naruto');
  _dropDisposable();
  return s.getItem('friends')!==null && s.getItem('animetheme')!==null;})()`);
t('nothing a person chose is ever dropped', safe, true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
