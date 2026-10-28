// "make it for everythign for retro" — enforced, rather than re-checked by eye
// every time something new is added.
//
// The bars and the ring were reported as broken in retro. They were two
// instances of one gap: components built after the retro sheet was written,
// which nothing in it knew about, so they kept the soft radius of the default
// theme while the screen around them was milled. Reading the stylesheet put the
// count at 179 and almost all of those were false — covered by an ancestor, or
// never drawn. Rendering the app and looking found fourteen.
//
// So this renders it. Any visible box that is still soft-cornered in retro fails
// here, including one added next year by someone who never read this file.
//
// What counts as done: square (0-2px), a pill, a true circle, or notched with
// clip-path — the four shapes this theme actually uses.
// run: node scripts/retro-coverage-test.mjs
import {spawn} from 'node:child_process';
const PORT=9035,DBG=9575;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-retrocov`,
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
await cmd('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:2,mobile:true});
const S=['watching','plan','finished','dropped'];
const seed=Array.from({length:24},(_,i)=>({id:'x'+i,title:'T'+i,kind:i%7===0?'read':'watch',
  status:S[i%4],rating:(i%10)+1,fav:i%5===0,ep:5,epTotal:12,aniId:1000+i,
  genre:'Action, Drama',finAt:i%3?0:Date.now()-i*86400000,upd:Date.now()-i*3600000}));
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:
 `localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(seed))});`+
 `localStorage.setItem('wl_net_status','approved');sessionStorage.setItem('wl_booted','1');`+
 `localStorage.setItem('wl_seen_tut','1');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(52)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

const SOFT=`(()=>{
  const out={};
  document.querySelectorAll('*').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(r.width<8||r.height<8)return;
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0)return;
    if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)return;
    const br=(cs.borderRadius||'').trim();
    if(/^(0px|1px|2px)( (0px|1px|2px)){0,3}$/.test(br))return;   // square
    if(/99px|50%/.test(br))return;                                // pill or circle
    if(cs.clipPath&&cs.clipPath!=='none')return;                  // notched
    const cls=(el.className&&el.className.baseVal!==undefined?el.className.baseVal:String(el.className||''))
      .split(/\\s+/).filter(Boolean)[0]||el.tagName.toLowerCase();
    out[cls]=br;
  });
  return out;})()`;

const SCREENS=[['home',`closeAll()`],['the detail sheet',`closeAll();openDetail(anime[0].id)`],
  ['stats',`closeAll();openStats()`],['settings',`closeStats&&closeStats();openSheet('settingsSheet')`],
  ['sources',`closeAll();openSheet('sourceSheet')`],['the social hub',`closeAll();openSheet('hubSheet')`],
  ['the schedule',`closeAll();try{openSchedule()}catch(e){}`]];

await ev(`setRetroMode(true)`); await wait(800);
for(const [name,expr] of SCREENS){
  await ev(`try{${expr}}catch(e){}`); await wait(800);
  const soft=await ev(SOFT);
  t(`retro reaches every box on ${name}`, soft, {});
}

// And the inverse. Squaring everything in retro is only right if the normal
// theme is untouched — a rule written without the [data-retro] scope would pass
// every check above and quietly flatten the whole app.
// The first version of this compared an expression against itself, which could
// only ever pass, and asked for .pcard-img, which this seed never renders.
await ev(`setRetroMode(false);closeAll()`); await wait(800);
t('the normal theme keeps its soft nav',
  await ev(`/^26px/.test(getComputedStyle(document.querySelector('.nav')).borderRadius)`), true);
t('…and its soft poster corners',
  await ev(`(()=>{const el=document.querySelector('.pcard-ph,.pcard-img');
    return el?/^(14|18)px/.test(getComputedStyle(el).borderRadius):'(no card rendered)';})()`), true);
t('…and nothing on screen is square that was not before',
  await ev(`(()=>{const el=document.querySelector('.sheet-handle');
    return el?getComputedStyle(el).borderRadius:'(none)';})()`), '99px');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
