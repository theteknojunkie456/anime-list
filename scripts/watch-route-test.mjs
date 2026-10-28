// "Nothing is opening in watchlist, constantly opening a new tab."
//
// Two separate things were doing that. Selecting one of the built-in services
// wrote its URL into the same setting a custom site uses, which made the app
// treat Peacock or Plex as "your own source" and try to FRAME them — sites that
// send headers forbidding exactly that. You got a blank rectangle, an eight
// second wait, and the browser anyway. And the Sources screen never said which
// choice plays in-app, so there was no way to find the one that does.
// run: node scripts/watch-route-test.mjs
import {spawn} from 'node:child_process';
const PORT=8999,DBG=9539;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-route`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// Poll for the debugger instead of guessing how long Chrome needs. A fixed
// sleep made this report ECONNREFUSED on a loaded machine — a failure about the
// harness, dressed as a failure about the app, which is the worst kind to read
// at the bottom of a test run.
let tabs=null;
for(let i=0;i<120;i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){
  console.log('could not reach the test browser after 60s — port '+DBG+' busy, or a stale profile lock');
  try{ch.kill();}catch(e){} try{srv.kill();}catch(e){} process.exit(1);
}
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
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a',title:'Frieren',status:'watching',kind:'watch',ep:3,epTotal:28,aniId:154587,upd:Date.now()}]));
localStorage.setItem('wl_net_status','approved');
sessionStorage.setItem('wl_booted','1');
window.__opened=[];
window.open=u=>{window.__opened.push(String(u));return {};};
// The hand-off clicks a real anchor, so recording window.open alone recorded
// nothing and the row read as "never opened".
document.addEventListener('DOMContentLoaded',()=>{
  const real=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    if(this.target==='_blank'){window.__opened.push(String(this.href));return;}
    return real.call(this);
  };
});
window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;

const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// ── a built-in service is a built-in service, selected or not ───────────────
t('nothing selected: a preset is not mistaken for your own site',
  await ev(`(()=>{setSource('');return !!streamSource();})()`), false);
t('selecting a built-in does not make it "your own site"',
  await ev(`(()=>{setSource(WATCH_PRESETS[3].url);
    const picked=streamSource()===WATCH_PRESETS[3].url;
    const own=!!String(streamSource()).trim()&&!WATCH_PRESETS.some(x=>x.url===streamSource());
    return {picked,own};})()`), {picked:true,own:false});
t('a site you supplied yourself is',
  await ev(`(()=>{setSource('https://my-own-site.example/watch/{slug}/ep-{ep}');
    return !!String(streamSource()).trim()&&!WATCH_PRESETS.some(x=>x.url===streamSource());})()`), true);

// ── the player is never opened on a site that refuses to be framed ──────────
t('a selected preset goes straight out, with no blank frame first',
  await ev(`(async()=>{setSource(WATCH_PRESETS[3].url);window.__opened=[];
    const a=anime[0];await watchAnime(a.id,4);await new Promise(r=>setTimeout(r,500));
    return {opened:window.__opened.length>=1,
            player:document.getElementById('playerView').classList.contains('on')};})()`),
  {opened:true,player:false});
t('and it is the service it said it would open',
  await ev(`(window.__opened[0]||'').includes('peacocktv.com')`), true);

// ── the screen now says which choice plays in-app ──────────────────────────
t('Sources offers playing inside the app as a choice, not a buried fold',
  await ev(`(()=>{setSource('');openSheet('sourceSheet');renderSource();
    return [...document.querySelectorAll('#sourceBody .src-choice .src-name')].map(x=>x.textContent);})()`),
  ['Open a site','Play inside WatchList','Ask me each time']);
t('and says plainly that a built-in opens a tab, naming it',
  await ev(`(()=>{if(isHiddenSrc('Peacock'))toggleHiddenSrc('Peacock');setSource('');renderSource();
    const txt=document.querySelector('#sourceBody .src-choice .src-sub').textContent;
    return txt;})()`), 'Goes to Peacock, in a new tab');
t('every built-in starts hidden, so nothing is chosen on your behalf',
  await ev(`WATCH_PRESETS.filter(p=>!isHiddenSrc(p.name)).map(p=>p.name)`), ['Peacock']);
t('the mark sits on "Open a site" while that is what happens',
  await ev(`(()=>{setSource('');renderSource();
    const on=[...document.querySelectorAll('#sourceBody .src-choice.on .src-name')].map(x=>x.textContent);
    return on;})()`), ['Open a site']);
t('and moves to in-app playback once you have supplied a site',
  await ev(`(()=>{setSource('https://my-own-site.example/watch/{slug}/ep-{ep}');renderSource();
    return [...document.querySelectorAll('#sourceBody .src-choice.on .src-name')].map(x=>x.textContent);})()`),
  ['Play inside WatchList']);
t('selecting a built-in does NOT claim in-app playback',
  await ev(`(()=>{setSource(WATCH_PRESETS[0].url);renderSource();
    return [...document.querySelectorAll('#sourceBody .src-choice.on .src-name')].map(x=>x.textContent);})()`),
  ['Open a site']);
// The paste box used to live in a separate fold headed "Use a site of your own",
// reachable both from that fold and from this choice: one job, two doors. It is
// inside the choice now, so there is nothing to open — it is simply there, and
// the choice puts the cursor in it.
t('the setup sits inside the choice it belongs to, not in a second place',
  await ev(`(()=>{renderSource();
    const own=[...document.querySelectorAll('#sourceBody .src-choice')]
      .find(c=>/Play inside WatchList/.test(c.textContent));
    return {inside:!!(own&&own.querySelector('#srcQuickIn')),
            folds:document.querySelectorAll('#sourceBody .src-fold[data-fold=\"own\"]').length};})()`),
  {inside:true,folds:0});
t('it stays out of the way until that choice is the one being made',
  await ev(`(()=>{setSource('');renderSource();
    const own=[...document.querySelectorAll('#sourceBody .src-choice')]
      .find(c=>/Play inside WatchList/.test(c.textContent));
    return getComputedStyle(own.querySelector('.src-own')).display;})()`), 'none');
t('and is simply there once it is',
  await ev(`(()=>{setSource('https://my-own-site.example/watch/{slug}/ep-{ep}');renderSource();
    const own=[...document.querySelectorAll('#sourceBody .src-choice')]
      .find(c=>/Play inside WatchList/.test(c.textContent));
    return getComputedStyle(own.querySelector('.src-own')).display;})()`), 'block');
t('and the choice puts the cursor in it',
  await ev(`(async()=>{setSource('');renderSource();openOwnSource();
    await new Promise(r=>setTimeout(r,400));
    return document.activeElement&&document.activeElement.id;})()`), 'srcQuickIn');
t('"Ask me each time" still wins the mark when it is on',
  await ev(`(()=>{setNoSource();renderSource();
    return [...document.querySelectorAll('#sourceBody .src-choice.on .src-name')].map(x=>x.textContent);})()`),
  ['Ask me each time']);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
