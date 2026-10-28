// Pressing Watch did nothing you could see. The app handed a URL to the browser
// and sat there; a tab appeared somewhere else a second later and that was the
// whole event — the deadest moment in the app, and the one pressed most.
// This is the send-off. It is decoration over a screen you are leaving, which is
// the exact reason it must never be in the way: the hand-off has already
// happened by the time it runs, because the tab has to open inside the gesture
// or the browser refuses it.
// run: node scripts/launch-moment-test.mjs
import {spawn} from 'node:child_process';
const PORT=9009,DBG=9555;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-lm`,
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
await new Promise(r=>ws.onopen=r);
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;w[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
const RM=v=>cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:v}]});
await RM('no-preference');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
sessionStorage.setItem('wl_booted','1');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4000);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};
const GO=`launchFX({title:'Frieren',img:'https://x.test/c.jpg'},4,'Peacock')`;

t('it names the show, the episode and where it is going',
  await ev(`(()=>{${GO};const el=document.getElementById('launchFX');
    return {t:el.querySelector('.lfx-txt b').textContent,
            s:el.querySelector('.lfx-txt span').textContent.trim()};})()`),
  {t:'Frieren',s:'Episode 4 → Peacock'});

t('it cannot swallow a tap, which is the one thing it must never do',
  await ev(`getComputedStyle(document.getElementById('launchFX')).pointerEvents`), 'none');

t('it clears itself',
  await ev(`(async()=>{await new Promise(r=>setTimeout(r,1700));
    return !!document.getElementById('launchFX');})()`), false);

t('pressing again does not stack them up',
  await ev(`(()=>{${GO};${GO};${GO};
    return document.querySelectorAll('.lfx').length;})()`), 1);

t('a show with no cover still gets a send-off',
  await ev(`(()=>{launchFX({title:'Mushishi',img:''},0,'Plex');
    const el=document.getElementById('launchFX');
    return {ph:el.querySelector('.lfx-art-ph').textContent,
            art:!!el.querySelector('.lfx-art[style]')};})()`), {ph:'M',art:false});

t('a cover from anywhere still goes through safeImg',
  await ev(`(()=>{launchFX({title:'X',img:'javascript:alert(1)'},1,'Plex');
    return !!document.getElementById('launchFX').querySelector('.lfx-art-ph');})()`), true);

t('the title is escaped, not interpolated',
  await ev(`(()=>{launchFX({title:'<img src=x onerror=window.__p=1>',img:''},1,'Plex');
    return {ran:!!window.__p,
            text:document.querySelector('.lfx-txt b').textContent};})()`),
  {ran:false,text:'<img src=x onerror=window.__p=1>'});

// the hand-off must not wait for it
t('the send-off runs after the hand-off, never before it',
  await ev(`(()=>{const src=watchAnime.toString();
    const i=src.indexOf('openExternal(launchURL(a,ep0))'), j=src.indexOf('launchFX(a,ep0',i);
    return i>0&&j>i;})()`), true);

await RM('reduce');
t('nothing moves for anybody who asked for less motion',
  await ev(`(()=>{const old=document.getElementById('launchFX');if(old)old.remove();
    ${GO};const el=document.getElementById('launchFX');
    return el?getComputedStyle(el).display:'(not built at all)';})()`), '(not built at all)');
await RM('no-preference');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
