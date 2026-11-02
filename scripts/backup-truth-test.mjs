// WHAT THE CLOUD PANEL IS ALLOWED TO CLAIM.
//
// The panel read "Cloud backup · ON — Backed up: 3.20 MB of 19.07 MB · 17%" on a
// device whose key held nothing at all. The number was real; the label was not.
// `syncPayloadSize()` measures what WOULD be sent, and calling that "backed up"
// turns a local measurement into a claim about a server nobody had asked.
//
// It cost a real evening: two devices could not be paired, and the only thing
// that disagreed was `Add a device` refusing with "this device has not finished
// its first backup yet" — correct, four lines under the sentence saying the
// opposite, and followed by advice ("give it a moment") that cannot work, since
// a push is scheduled by a LIST CHANGE and not by time.
//
// So this file holds the panel to the two things it can actually check: has
// anything landed (`syncAt()`), and are pushes failing (`pushState()`).
// run: node scripts/backup-truth-test.mjs
import {spawn} from 'node:child_process';
const PORT=9053,DBG=9593;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-btruth`,
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
// The push stub fails until the test says otherwise, which is the state the bug
// lived in: backup on, a key minted, and nothing behind it.
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(MINE))});
localStorage.setItem('sync_animelist_v4','MACCODE12345678901234');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('tut_seen_animelist_v4','1');
localStorage.setItem('seen_release','2026-11-01.64');
window.__sent=[];window.__pushWorks=false;window.__pairErr='that key has no backup yet';
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op)window.__sent.push(b);
  const J=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='push'){ if(!window.__pushWorks)return Promise.reject(new Error('Failed to fetch'));
                     return J({ok:true,updatedAt:Date.now()}); }
  if(b.op==='pull')return J({data:null,updatedAt:0});
  if(b.op==='pair_new'){ return window.__pairErr?J({error:window.__pairErr}):J({ok:true,pair:'ABCD2345',expiresAt:Date.now()+600000,ttl:600}); }
  return new Promise(()=>{});
};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

await ev(`openSheet('backupSheet')`); await wait(500);
t('the device has a key', await ev(`syncCode()`), 'MACCODE12345678901234');

const txt=()=>ev(`(document.getElementById('syncBox')||{}).textContent||''`);
const setState=(at,n,why)=>ev(`(()=>{localStorage.setItem('syncat_animelist_v4','${at}');
  localStorage.setItem('pushfail_animelist_v4',JSON.stringify({n:${n},at:${n?'Date.now()':0},why:${JSON.stringify(why||'')}}));
  renderSyncUI();return 1;})()`);

// ── 1. nothing has landed ───────────────────────────────────────────────────
await setState(0,0); await wait(250);
let s=await txt();
t('it says nothing has reached the cloud', /nothing has reached the cloud yet/.test(s), true);
t('it does NOT claim the list is backed up', /Backed up:/.test(s), false);
t('it says the size is only ready to send', /ready to send/.test(s), true);
t('it says why a second device cannot join yet', /nothing for another device to join/.test(s), true);
t('the bar is empty, not 17% full',
  await ev(`(()=>{const d=document.querySelector('#syncBox div[style*="transform:scaleX"]');
    return d?/scaleX\\(0\\.000\\)/.test(d.getAttribute('style')||''):'no bar';})()`), true);
t('it offers the button that fixes it', await ev(`!!document.getElementById('backupNowBtn')`), true);

// ── 2. something has landed ─────────────────────────────────────────────────
await setState(Date.now()-60000,0); await wait(250);
s=await txt();
t('once a copy exists it says backed up', /Backed up:/.test(s), true);
t('and says when it last reached the cloud', /Last reached the cloud/.test(s), true);
t('and stops offering the button', await ev(`!!document.getElementById('backupNowBtn')`), false);

// ── 3. it had landed, and then started failing ──────────────────────────────
await setState(Date.now()-86400000,5,'Failed to fetch'); await wait(250);
s=await txt();
t('a failing backup says so, with the count', /the last 5 backups failed/.test(s), true);
t('and does not claim to be backed up', /Backed up:/.test(s), false);
t('and shows the error it actually got', /Failed to fetch/.test(s), true);
t('and offers the button again', await ev(`!!document.getElementById('backupNowBtn')`), true);

// ── 4. the button defeats the two invisible blocks ──────────────────────────
// A device nine failures deep is inside an hour-long backoff: an ordinary push
// returns without sending anything at all. That is the thing being defeated.
await ev(`localStorage.setItem('sync_pushfp_animelist_v4','stale-fingerprint')`);
await setState(0,9,'Failed to fetch'); await wait(200);
await ev(`window.__sent=[];syncPush()`); await wait(600);
t('an ordinary push is held by the backoff and sends nothing',
  await ev(`window.__sent.filter(b=>b.op==='push').length`), 0);

await ev(`window.__pushWorks=true;window.__sent=[]`);
await ev(`backupNow(document.getElementById('backupNowBtn'))`); await wait(900);
const sent=await ev(`window.__sent.filter(b=>b.op==='push')`);
t('Back up now sends exactly one push', Array.isArray(sent)&&sent.length, 1);
t('it is an ordinary push, not an adopt-everywhere',
  !!(sent&&sent[0]&&!(+sent[0].adopt)), true);
t('it sends under this device’s own key',
  (sent&&sent[0]&&sent[0].code)||'', 'MACCODE12345678901234');
t('the failure counter is cleared once it lands',
  await ev(`JSON.parse(localStorage.getItem('pushfail_animelist_v4')||'{}').n||0`), 0);
t('and the panel now says something has landed',
  /Backed up:/.test(await txt()), true);

// ── 5. the refusal names the button ─────────────────────────────────────────
await setState(0,0); await wait(200);
await ev(`pairOffer(document.getElementById('pairAddBtn'))`); await wait(700);
const pb=await ev(`(document.getElementById('pairBox')||{}).textContent||''`);
t('Add a device explains itself in terms of something you can press',
  /Back up now/.test(pb), true);
t('and no longer tells you to wait a moment', /give it a moment/i.test(pb), false);

// ── 6. the guards ───────────────────────────────────────────────────────────
t('it refuses with no key at all',
  await ev(`(()=>{const c=syncCode();localStorage.removeItem('sync_animelist_v4');
    window.__sent=[];const p=backupNow(null);
    return p.then(()=>{localStorage.setItem('sync_animelist_v4',c);
      return window.__sent.filter(b=>b.op==='push').length;});})()`), 0);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
