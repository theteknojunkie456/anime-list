// THE TOUCH FLOOR.
//
// 44px is the smallest thing a fingertip reliably hits. .hbtn worked this out
// early and solved it well — the button stays 38px because the header has a
// title to fit beside it, and an invisible 44px box grows under it from
// ::after, so nothing moves and every tap lands. Then it kept the trick to
// itself. A measured sweep at 393px found eleven more controls under the floor,
// including the carousel dots at 16x2 — a two-pixel target is not a small
// button, it is a button that works by accident.
//
// What makes this testable is the same thing that made it invisible: the hit
// area is a pseudo-element, so the layout box lies about it in both directions.
// Measuring the box alone reports .hbtn — the control that got this right — as
// the worst offender on the screen. This reads the box AND any absolutely
// positioned ::before/::after, and takes the larger.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const PORT=9067,DBG=9613;
let src=readFileSync('index.html','utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/,'const NETWORK_GATE=false;');
const T=['Frieren','Vinland Saga','Mushishi','Monster','Sakamoto Days','Dandadan','Apothecary Diaries','Blue Box','Kaiju No. 8','Ranma ½','Dungeon Meshi','Oshi no Ko'];
const G=['Action','Comedy','Drama','Fantasy','Romance','Thriller'];
const list=T.map((t,i)=>({id:'p'+i,kind:'watch',status:['watching','plan','finished','dropped'][i%4],title:t,
  ep:(i%23)+1,epTotal:24,dur:24,genre:G[i%6],genres:[G[i%6]],studio:'Madhouse',year:2023,upd:1799999999000-i}));
const seed={wl_net_status:'approved',seen_release:(src.match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9'])[1],seen_msg:'1',
  animelist_v4:JSON.stringify(list),onboarded_animelist_v4:'1',tut_seen_animelist_v4:'1',backupoff_animelist_v4:'1',backup_nudge_animelist_v4:'1'};
const inject='<script>try{'+Object.entries(seed).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')+'}catch(e){}</script>';
mkdirSync('.preview',{recursive:true});writeFileSync('.preview/touch.html',src.replace('<script',inject+'<script'));
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-touch`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){ await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; } }
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
const ev=async x=>(await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:2,mobile:true});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/.preview/touch.html?cb=`+Math.random()});
await wait(5000);

// Controls that cannot take 44 in both axes without colliding with the control
// beside them. Each states the axis it DOES satisfy; none is a free pass.
//   bb-dot — five carousel dots in one short row. 44 wide each would overlap
//            its neighbours, which trades a target you miss for one that hits
//            the wrong slide. Full height, narrow width, and the slide is
//            swipeable anyway.
const NARROW_OK={'bb-dot':{minW:20,minH:44}};
const HIT=`(()=>{
  const px=v=>{const n=parseFloat(v);return isFinite(n)?n:0;};
  const hit=e=>{const r=e.getBoundingClientRect();let w=r.width,h=r.height;
    for(const pe of ['::after','::before']){const cs=getComputedStyle(e,pe);
      if(cs.content&&cs.content!=='none'&&cs.position==='absolute'){
        w=Math.max(w,px(cs.width));h=Math.max(h,px(cs.height));}}
    return [Math.round(w),Math.round(h)];};
  return [...document.querySelectorAll('#app button, #app a[href], #app [onclick]')]
    .filter(e=>!e.closest('svg'))
    .filter(e=>{const r=e.getBoundingClientRect();
      return r.width>0&&r.height>0&&r.top<window.innerHeight&&r.bottom>0&&getComputedStyle(e).visibility!=='hidden';})
    .map(e=>{const [w,h]=hit(e);
      return {cls:(e.className||'').toString().split(' ')[0]||e.tagName.toLowerCase(), w, h};});
})()`;
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(46)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};
const short=(rows)=>rows.filter(r=>{
  const ex=NARROW_OK[r.cls];
  if(ex)return r.w<ex.minW||r.h<ex.minH;
  return r.w<44||r.h<44;
}).map(r=>r.cls+' '+r.w+'x'+r.h);

const screens=[
  ['home', null],
  ['the list', `setFilter&&setFilter('watching')`],
  ['a title', `(()=>{const c=document.querySelector('.pcard,.gcard');c&&c.click();})()`],
];
let seen=0;
for(const [name,go] of screens){
  if(go){await ev(go);await wait(1200);}
  const rows=await ev(HIT);
  seen+=Array.isArray(rows)?rows.length:0;
  t(`every tap target on ${name} clears 44px`, [...new Set(short(rows||[]))], []);
}
// A sweep that found nothing because it looked at nothing passes for the wrong
// reason. Say how many controls were actually measured.
t('and there were controls there to measure', seen>25, true);
// The control that invented the technique must keep passing BY the technique:
// if .hbtn ever loses its ::after, its 38px box fails this on its own.
t('.hbtn still carries its invisible 44px box',
  await ev(`(()=>{const b=document.querySelector('.hbtn'); if(!b)return 'missing';
    const cs=getComputedStyle(b,'::after');
    return cs.content!=='none' && parseFloat(cs.width)>=44 && parseFloat(cs.height)>=44;})()`), true);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
