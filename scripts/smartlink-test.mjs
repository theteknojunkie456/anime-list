// What the paste box actually makes of what you paste.
//
// "I think it should be ONLY the smartlink thing. if someone wants netflix, they just paste in
// netflix.com or wtv yk. or netflix/ep/show or howevrr its formatted" -- so Sources is one box,
// and everything depends on that box reading an address the way a person would.
//
// It had no behavioural test at all. watch-route-test checks the box EXISTS and takes the
// cursor; nothing typed into it. Two bugs got through that gap, both found by hand: a length
// guard that refused netflix.com for being eleven characters, and a bare-site rule that took
// netflix.com but not crunchyroll.com/en-us, which is what you get if you copy the address bar
// on a site that puts you on a locale before you have chosen anything.
//
// The cases below are the shapes people actually paste, and each asserts the DECISION -- open
// the site, or build a template from it -- rather than the wording, so copy can be rewritten
// without this file crying wolf.
// run: node scripts/smartlink-test.mjs
import {spawn} from 'node:child_process';
const PORT=9653,DBG=9655;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-smartlink`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// Poll for the debugger instead of guessing how long Chrome needs. A fixed
// sleep made this report ECONNREFUSED on a loaded machine — a failure about the
// harness, dressed as a failure about the app, which is the worst kind to read
// at the bottom of a test run.
let tabs=null;
for(let i=0;i<240;i++){
  await wait(250);
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
// Poll for the app instead of guessing how long it needs. A flat 4.2s was copied in
// here with the rest of the harness; it is the exact thing CONVENTIONS bans, and on a
// machine running thirty browsers it is also the thing that makes a suite cry wolf.
// What this file needs is the paste box, so wait for what opens it.
{
  let up=false;
  for(let i=0;i<120;i++){
    await wait(250);
    if(await ev(`typeof renderSource==='function'&&typeof quickSetup==='function'&&!!document.getElementById('sourceSheet')`)){up=true;break;}
  }
  if(!up){console.log('the app never finished booting in 30s');try{ch.kill();}catch(e){}try{srv.kill();}catch(e){}process.exit(1);}
}
let pass=0,fail=0;

const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(62)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// Type into the real box and read back WHICH ANSWER the screen gave, not its wording:
//   'site'     -> it offers to open that site as it is
//   'template' -> it worked out how the site names shows and offers to use it everywhere
//   'stuck'    -> it could not tell, and says what to copy instead
//   'silent'   -> not enough typed yet to react to
const ask=async v=>ev(`(()=>{
  setSource('');openSheet('sourceSheet');renderSource();
  const i=document.getElementById('srcQuickIn'),o=document.getElementById('srcQuickOut');
  if(!i||!o)return 'no-box';
  i.value=${JSON.stringify(v)};quickSetup();
  if(o.style.display==='none')return 'silent';
  if(o.querySelector('.src-quick-bad'))return 'stuck';
  // Both cards set dataset.site and dataset.tpl, so neither tells them apart -- an
  // earlier version of this file keyed off dataset.site and reported every template
  // as a site, which looked like two app bugs and was one test bug. The template card
  // is the only one that prints the pattern it worked out (.src-quick-url); the
  // bare-site card has nothing to print, which is the whole difference between them.
  if(o.querySelector('.src-quick-ok'))return o.querySelector('.src-quick-url')?'template':'site';
  return 'other';})()`);

// ── a site on its own is a valid answer ────────────────────────────────────
t('netflix.com — the eleven characters the old length guard refused', await ask('netflix.com'), 'site');
t('a site typed with its scheme', await ask('https://netflix.com'), 'site');
t('and with the www nobody means to copy', await ask('www.netflix.com/'), 'site');
t('a landing path is still the site', await ask('netflix.com/browse'), 'site');

// ── a locale is not a destination ──────────────────────────────────────────
// What you get copying the address bar on crunchyroll or disneyplus before choosing anything.
t('crunchyroll.com/en-us — a locale homepage', await ask('crunchyroll.com/en-us'), 'site');
t('disneyplus.com/en-gb, trailing slash and all', await ask('https://www.disneyplus.com/en-gb/'), 'site');
t('a locale in front of a landing path', await ask('crunchyroll.com/de/anime'), 'site');

// ── an address with a show in it is worth more than the site ───────────────
t('an episode address names the show, so it generalises',
  await ask('https://example-stream.test/watch/attack-on-titan/episode-7'), 'template');
t('a locale does not stop that', await ask('https://example-stream.test/en-us/watch/attack-on-titan/episode-7'), 'template');

// ── and it says so when it cannot tell ─────────────────────────────────────
t('a player page that hides the show behind nothing readable',
  await ask('https://example-stream.test/v/9f2a1c7b4e8d3a6f5c0b9e2d7a4f1c83'), 'stuck');

// ── it does not react to half-typed text ───────────────────────────────────
// The guard here is "a dot with something after it", not a length: netflix.com is shorter
// than the string that used to be required.
t('nothing typed yet', await ask(''), 'silent');
t('a few letters on the way to a word', await ask('net'), 'silent');
t('a show title is not an address', await ask('Attack on Titan'), 'silent');
t('an abbreviation with a full stop is not either', await ask('Dr. Stone'), 'silent');

console.log('\n'+pass+' passed, '+fail+' failed');
try{ch.kill();}catch(e){} try{srv.kill();}catch(e){}
process.exit(fail?1:0);
