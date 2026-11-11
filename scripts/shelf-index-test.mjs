// THE 00 SHELVES.
//
// Every shelf on the home page carries a small index mark — 01, 02, 03 — and on
// the phone they all read 00.
//
// The first suspect was `content-visibility:auto` on .row-sec: a skipped
// subtree, the theory went, never increments the counter inside it. Measured,
// that is false — Chrome resolves the counter correctly at the bottom of a page
// whose every earlier section is skipped. The phone runs WebKit. The cause is
// still open.
//
// The reason the mark moved off a CSS counter anyway is that a CSS counter is
// untestable: getComputedStyle hands back the unresolved `counter(...)`
// function, never the number that paints. Nothing could assert what the user
// sees, which is how a wrong number shipped and stayed wrong. The number is now
// a value the page sets, so this file can read exactly what the shelf shows.
import {spawn} from 'node:child_process';
const PORT=9065,DBG=9611;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-shelf`,
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
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('the test browser refused the connection'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>(await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;
await cmd('Page.enable');await cmd('Runtime.enable');

// Enough titles, spread over every status and several genres, that the home
// page builds more shelves than fit on a phone — which is the whole point.
const GEN=['Action','Comedy','Drama','Fantasy','Romance','Thriller'];
const ST=['watching','plan','finished','dropped'];
const seed=[];
for(let i=0;i<120;i++) seed.push({
  id:'s'+i, title:'Show '+i, status:ST[i%4], ep:(i%12)+1, eps:24,
  genres:[GEN[i%6],GEN[(i+2)%6]], upd:1700000000000+i, added:1700000000000+i,
});
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(seed))});
localStorage.setItem('wl_net_status','approved');
window.fetch=()=>new Promise(()=>{});`});
await cmd('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4800);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(52)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// What the mark actually paints, read off the rendered ::before rather than the
// rule — the counter bug was invisible in the stylesheet and only ever showed
// up in the pixels.
const marks=async()=>ev(`(()=>{
  const p=document.getElementById('pageEl'); if(!p)return 'no page';
  return [...p.querySelectorAll('.row-title,.rz-head')]
    .map(h=>getComputedStyle(h,'::before').content)
    .map(c=>String(c).replace(/^"|"$/g,''));
})()`);
// Is the optimisation that caused this still on? If a later change drops
// content-visibility, this test stops testing anything and should say so
// rather than pass quietly.
// .row-sec is the one that skips; .rz-sec is laid out normally and shares the
// numbering only. Ask the element that actually carries the optimisation.
const skipping=async()=>ev(`(()=>{const s=document.querySelector('.row-sec');
  return !!s && getComputedStyle(s).contentVisibility==='auto';})()`);
const offscreen=async()=>ev(`(()=>{const p=document.getElementById('pageEl'); if(!p)return 0;
  return [...p.querySelectorAll('.row-sec,.rz-sec')]
    .filter(s=>s.getBoundingClientRect().top>window.innerHeight).length;})()`);

const m=await marks();
t('the home page built several shelves', Array.isArray(m)&&m.length>=4, true);
t('and most of them are below the fold', (await offscreen())>=2, true);
t('the skipping optimisation is still on', await skipping(), true);
t('every shelf is numbered', Array.isArray(m)&&m.every(x=>/^\d\d$/.test(x)), true);
t('no shelf reads 00', Array.isArray(m)&&m.filter(x=>x==='00').length, 0);
t('the numbers run 01, 02, 03 … in order',
  Array.isArray(m)?m.join(','):m,
  Array.isArray(m)?m.map((_,i)=>String(i+1).padStart(2,'0')).join(','):'?');
t('…including the ones the browser skipped',
  Array.isArray(m)?new Set(m).size:0, Array.isArray(m)?m.length:-1);

// Scrolling must not renumber anything: the mark belongs to the shelf, not to
// where the reader happens to be.
await ev(`document.getElementById('pageEl').scrollTop=4000`);
await wait(700);
t('scrolling down changes nothing', await marks(), m);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
