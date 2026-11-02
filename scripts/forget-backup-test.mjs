// Erasing the stored copy, from the app.
//
// Two things here are easy to get wrong and expensive to get wrong. The erase
// has to happen BEFORE the key is cleared locally, because the key is the only
// thing that can reach the copy. And the scheduled push has to be cancelled
// before the erase, or the debounce fires a moment later and writes the whole
// list straight back under the key just deleted — which looks exactly like the
// erase silently not working.
// run: node scripts/forget-backup-test.mjs
import {spawn} from 'node:child_process';
const PORT=9049,DBG=9589;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-forget`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){} process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');

const MINE=[{id:'m1',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:5,epTotal:24,upd:2000},
            {id:'m2',kind:'watch',status:'plan',title:'Monster',aniId:19,ep:0,epTotal:74,upd:2000}];
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(MINE))});
localStorage.setItem('sync_animelist_v4','PHONECODE1234567890');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('tut_seen_animelist_v4','1');
localStorage.setItem('seen_release','2026-11-01.63');
window.__ops=[];window.__forgetFails=false;
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  window.__ops.push(b.op+(b.code?(':'+b.code):''));
  const J=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='forget'){ if(window.__forgetFails)return Promise.reject(new Error('offline'));
                       return J({ok:true,existed:true}); }
  if(b.op==='push')return J({ok:true,updatedAt:Date.now()});
  if(b.op==='pull')return J({data:null,updatedAt:0});
  return new Promise(()=>{});
};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

await ev(`openSheet('backupSheet')`); await wait(500);
t('this device has a backup to erase', await ev(`syncCode()`), 'PHONECODE1234567890');

// ── it asks, and does nothing until answered ────────────────────────────────
await ev(`window.__ops=[];syncForget()`); await wait(400);
t('it asks first', await ev(`!!document.querySelector('#confirmBox.on')`), true);
t('in the colour reserved for losing something',
  await ev(`(document.getElementById('confirmYesBtn')||{}).className||''`), 'cbtn del');
t('and names what goes',
  /list, settings and friends/.test(await ev(`(document.getElementById('confirmMsg')||{}).textContent||''`)), true);
t('nothing has been sent while it waits for an answer', await ev(`window.__ops`), []);
t('and the code is still here', await ev(`syncCode()`), 'PHONECODE1234567890');

// Backing out must leave everything exactly as it was.
await ev(`(document.getElementById('confirmBox')||{classList:{remove(){}}}).classList.remove('on');_confirmCb=null;`);
await wait(200);
t('backing out erases nothing', [await ev(`syncCode()`), await ev(`window.__ops`)],
  ['PHONECODE1234567890',[]]);

// ── a cloud that cannot be reached must not pretend ─────────────────────────
await ev(`window.__forgetFails=true;window.__ops=[];syncForget()`); await wait(300);
await ev(`confirmYes()`); await wait(700);
t('a failed erase keeps the code, so the copy is still reachable',
  await ev(`syncCode()`), 'PHONECODE1234567890');
t('and the titles are untouched', await ev(`anime.length`), 2);

// ── the real thing, with a push already armed ───────────────────────────────
await ev(`window.__forgetFails=false;window.__ops=[];
  // arm a push the way an ordinary edit does
  schedulePush();
  syncForget()`); await wait(300);
await ev(`confirmYes()`); await wait(900);
t('the erase was sent, for this code',
  (await ev(`window.__ops`)).includes('forget:PHONECODE1234567890'), true);
t('the code is gone from this device', await ev(`syncCode()`), '');
t('backup is marked off, so nothing mints a new one behind you',
  await ev(`localStorage.getItem('backupoff_animelist_v4')`), '1');
t('the titles stay on this device — this erases the COPY, not the list',
  await ev(`anime.length`), 2);
t('and it no longer counts as a key this device invented',
  await ev(`localStorage.getItem('key_self_animelist_v4')`), null);

// THE ONE THAT MATTERS: the armed push must not write the list straight back.
await wait(12000);   // PUSH_WAIT is 10s — well past when the debounce would have fired
t('no push followed the erase, so the copy does not come back',
  (await ev(`window.__ops`)).filter(o=>/^push/.test(o)), []);
t('and the panel now offers to turn backup on rather than off',
  /Cloud backup · OFF/.test(await ev(`(document.getElementById('syncBox')||{}).textContent||''`)), true);

// ── asking again with nothing to erase ──────────────────────────────────────
await ev(`window.__ops=[];syncForget()`); await wait(400);
t('with no backup on the device it says so instead of asking',
  await ev(`!document.querySelector('#confirmBox.on')`), true);
t('and sends nothing', await ev(`window.__ops`), []);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
