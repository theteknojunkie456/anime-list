// THE HERO IS LIT BY THE SHOW ON IT.
//
// AniList sends coverImage.color — the dominant colour of a title's key art —
// and the app has stored it as aniColor since covers were added. accentVars(),
// the one function whose job was spending it, had been emptied to `return ''`,
// so every hero was lit the same grey. It is the cheapest art direction
// available: the colour is already on the record.
//
// THE TRAP THIS FILE EXISTS TO AVOID: headless Chrome reports
// `prefers-reduced-motion: reduce` by default. Every motion rule in the app is
// therefore suppressed before the page loads, and a motion test that does not
// say otherwise measures the still version and passes for the wrong reason.
// Three measurements were lost to this before it was spotted. The test forces
// the feature both ways and asserts both — motion present when it is wanted,
// and genuinely gone when it is not.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const PORT=9081,DBG=9627;
let src=readFileSync('index.html','utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/,'const NETWORK_GATE=false;');
const T=['Frieren','Vinland Saga','Mushishi','Monster','Dandadan','Oshi no Ko','Bocchi','Chainsaw Man'];
// One title deliberately carries no colour and one carries a bad one: the grade
// must collapse to nothing rather than fall back to a generic glow, which is
// the version of this effect that looks machine-made.
const C=['#e4a672','#5a7f9c','','javascript:x','#b05545','#3f6d52','#8c6d4f','#5a7f9c'];
const list=T.map((t,i)=>({id:'p'+i,kind:'watch',status:i<3?'watching':'plan',title:t,titleNa:'日本語',
  studio:'Madhouse',year:2023,aniColor:C[i],ep:3,epTotal:24,dur:24,genre:'Action',genres:['Action'],upd:1799999999000-i}));
const seed={wl_net_status:'approved',seen_release:(src.match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9'])[1],seen_msg:'1',
  animelist_v4:JSON.stringify(list),onboarded_animelist_v4:'1',tut_seen_animelist_v4:'1',backupoff_animelist_v4:'1',backup_nudge_animelist_v4:'1'};
const inject='<script>try{'+Object.entries(seed).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')+'}catch(e){}</script>';
mkdirSync('.preview',{recursive:true});writeFileSync('.preview/cinema.html',src.replace('<script',inject+'<script'));
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-cinema`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){ await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; } }
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){} process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>(await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;
const motion=v=>cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:v}]});
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:2,mobile:true});
await motion('no-preference');
await cmd('Page.navigate',{url:`http://localhost:${PORT}/.preview/cinema.html?cb=`+Math.random()});
await wait(5200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(52)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// The harness lies by default. Prove it is not lying before trusting anything.
t('the browser is not secretly in reduced motion',
  await ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`), false);
t('the cinematic rules are switched on',
  await ev(`document.documentElement.getAttribute('data-art')`), 'cinematic');
t('the hero has a light layer and a grain layer',
  await ev(`[!!document.querySelector('.bb-slide .hero-grade'),!!document.querySelector('.bb-slide .hero-grain')]`), [true,true]);
// The colour must be the SHOW's, read off the slide that was given one.
t('a show with art colour lights the frame in it',
  await ev(`(()=>{const s=[...document.querySelectorAll('.bb-slide')].find(x=>(x.getAttribute('style')||'').includes('--sc'));
    return s?(s.getAttribute('style').match(/--sc:(#[0-9a-f]{6})/i)||[])[1]:'none';})()`), '#e4a672');
// A missing or hostile colour must produce no light at all, not a default glow.
t('a show with none, or a bad one, gets no light',
  await ev(`(()=>{const bad=['','javascript:x'];
    return [...document.querySelectorAll('.bb-slide')].every(s=>{
      const st=s.getAttribute('style')||'';
      const m=st.match(/--sc:([^;]+)/); return !m || /^#[0-9a-f]{6}$/i.test(m[1].trim());});})()`), true);

const pz=async()=>await ev(`(document.querySelector('.billboard')||{style:{getPropertyValue:()=>''}}).style.getPropertyValue('--pz')`);
const tr=async(sel)=>await ev(`(()=>{const e=document.querySelector('${sel}');return e?getComputedStyle(e).translate:'missing';})()`);
t('at the top of the page nothing is displaced', await pz(), '0.0000');
await ev(`document.getElementById('pageEl').scrollTop=400`); await wait(700);
t('scrolling drives the parallax', (await pz())!=='0.0000', true);
const art=await tr('.bb-slide .hero-bg,.bb-slide .hero-bg-img'), body=await tr('.bb-slide .hero-body');
// Two planes, or it is a picture that slides. The signs must differ.
const num=v=>parseFloat(String(v).split(/\s+/)[1]||'0');
t('the art and the words move opposite ways', [num(art)>0, num(body)<0], [true,true]);
// Ken Burns owns `transform`; the parallax uses `translate` so the two compose
// instead of one silently replacing the other. If this ever becomes a
// transform, the drift stops and nothing else here would notice.
t('the drift still has its own transform',
  await ev(`(()=>{const e=document.querySelector('.bb-slide.bb-live .hero-bg-img,.bb-slide.bb-live .hero-bg');
    if(!e)return 'no live slide'; const cs=getComputedStyle(e); return cs.translate!=='none';})()`), true);

// And now the half that the default harness state would have passed for free.
await motion('reduce'); await wait(900);
t('reduced motion stops the parallax', [await tr('.bb-slide .hero-bg,.bb-slide .hero-bg-img'), await tr('.bb-slide .hero-body')], ['none','none']);
t('reduced motion stops the light drifting',
  await ev(`(()=>{const e=document.querySelector('.bb-slide.bb-live .hero-grade');
    return e?getComputedStyle(e).animationName:'no live slide';})()`), 'none');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
