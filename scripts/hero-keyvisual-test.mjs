// THE HERO IS A KEY VISUAL, NOT A BANNER.
//
// The billboard was a 240px band with the title written across its middle. The
// frame is now 4:5 on a portrait phone, the art runs edge to edge, and the
// words sit in the bottom third — the shape a show is actually sold in.
//
// THE PART THAT IS EASY TO GET WRONG AND IMPOSSIBLE TO SEE: a taller frame fed
// the same picture is worse, not better. titleBg() returns AniList's banner,
// which is 1900x400. Cropped to 4:5 it shows about a sixth of its width, and
// whatever is in that sixth is what you get. So the tall frame has to be fed
// the cover instead — and the cover the app had stored was `coverImage.large`,
// which is not the large file: AniList resolves it to /cover/medium/, 230x318.
// Measured, not assumed. `extraLarge` is /cover/large/, 460x636, has been asked
// for in the query since covers were added, and was never read.
//
// So this file checks three things that can each silently undo the others: the
// frame is the right shape, the browser is being handed the right picture for
// that shape, and the picture it is handed is the big one.
//
// It also re-checks what hero-cinema-test established — headless Chrome claims
// `prefers-reduced-motion: reduce` unless told otherwise, and every motion rule
// is suppressed before the page loads if it is not.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const PORT=9083,DBG=9629;
const ROOT=`http://localhost:${PORT}`;
const KV=ROOT+'/.preview/kv.png', XL=ROOT+'/.preview/xl.png', BAN=ROOT+'/.preview/banner.png';
let src=readFileSync('index.html','utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/,'const NETWORK_GATE=false;');
// The second one is a real title off a real list, and the worst realistic case
// for how far up the words climb.
const T=['Vinland Saga','That Time I Got Reincarnated as a Slime','Mushishi','Monster','Dandadan','Oshi no Ko'];
const list=T.map((t,i)=>({id:'p'+i,kind:'watch',status:i<3?'watching':'plan',title:t,titleNa:'日本語',
  studio:'Wit',year:2019,aniColor:'#5a7f9c',ep:3,epTotal:24,dur:24,genre:'Action',genres:['Action'],
  // Every slide carries both shapes of art, so the <picture> has a real choice.
  // The banner has to be STAMPED with the id it came from: repairBanners() drops
  // any banner it cannot vouch for on load, so an unstamped one is gone before
  // the first render and the test measures a hero with no banner in it at all.
  aniId:100+i,banner:BAN,bannerFor:100+i,img:KV,imgXL:XL,upd:1799999999000-i}));
// …except the last, which has no art at all: it must not emit a broken <img>.
list.push({id:'pz',kind:'watch',status:'watching',title:'No Art At All',ep:1,epTotal:12,
  aniId:199,banner:'',img:'',imgXL:'',upd:1700000000000});
const seed={wl_net_status:'approved',seen_release:(src.match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9'])[1],seen_msg:'1',
  animelist_v4:JSON.stringify(list),onboarded_animelist_v4:'1',tut_seen_animelist_v4:'1',backupoff_animelist_v4:'1',backup_nudge_animelist_v4:'1'};
const inject='<script>try{'+Object.entries(seed).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')+'}catch(e){}</script>';
mkdirSync('.preview',{recursive:true});
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
for(const f of ['kv.png','xl.png','banner.png'])writeFileSync('.preview/'+f,PNG);
writeFileSync('.preview/keyvisual.html',src.replace('<script',inject+'<script'));
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-keyvisual`,
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
const screen=(w,h)=>cmd('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});
await cmd('Page.enable');await cmd('Runtime.enable');
await screen(393,852);
await motion('no-preference');
await cmd('Page.navigate',{url:`${ROOT}/.preview/keyvisual.html?cb=`+Math.random()});
await wait(5200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(54)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// The harness lies by default. Prove it is not lying before trusting anything.
t('the browser is not secretly in reduced motion',
  await ev(`matchMedia('(prefers-reduced-motion: reduce)').matches`), false);

// ── the frame ────────────────────────────────────────────────────────────
const box=async()=>await ev(`(()=>{const b=document.querySelector('.billboard');if(!b)return null;
  const r=b.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)];})()`);
const bb=await box();
t('the hero is 4:5, not a band', bb && Math.abs(bb[0]/bb[1]-0.8)<0.02, true);
t('and that is taller than the band it replaced', bb && bb[1]>300, true);

// Words in the bottom third. Measured as a FRACTION of the frame, so it stays
// true at any size — a pixel figure here would pass on one phone and lie on all
// the others. Two readings, because a title is not one length: the usual case
// has to make the bottom third, and the two-line case still has to leave the
// art more than half the frame.
const share=async(i)=>await ev(`(()=>{const b=document.querySelector('.billboard'),
    y=document.querySelectorAll('.bb-slide .hero-body')[${i}];
  if(!b||!y)return 99;const B=b.getBoundingClientRect(),Y=y.getBoundingClientRect();
  return Math.round(100*Y.height/B.height);})()`);
const lines=async(i)=>await ev(`(()=>{const e=document.querySelectorAll('.bb-slide .hero-title')[${i}];
  if(!e)return 0;const cs=getComputedStyle(e);
  return Math.round(e.getBoundingClientRect().height/parseFloat(cs.lineHeight||cs.fontSize));})()`);
// Slide 0 of the track is the loop's clone of the LAST item; slide 1 is the
// first real one, and slide 2 the long title behind it.
t('an ordinary title leaves the art the top two thirds', (await share(1))<=36, true);
t('the long title really does wrap', (await lines(2))>1, true);
t('but never past three lines', (await lines(2))<=3, true);
t('so even then the art keeps half the frame', (await share(2))<=50, true);
t('the pill that was in the way is gone from the tall frame',
  await ev(`getComputedStyle(document.querySelector('.bb-slide .hero-cta')).display`), 'none');
t('and they still finish inside the frame',
  await ev(`(()=>{const b=document.querySelector('.billboard'),y=document.querySelector('.bb-slide .hero-body');
    if(!b||!y)return 'missing';const B=b.getBoundingClientRect(),Y=y.getBoundingClientRect();
    return Math.round(Y.bottom)<=Math.round(B.bottom)+1;})()`), true);
// The top of the picture is the picture. If the shade starts opaque at 0% the
// frame is a dimmed rectangle again and every other assertion here still passes.
t('the shade leaves the top of the art alone',
  await ev(`(()=>{const e=document.querySelector('.bb-slide .hero-shade');
    return e?/rgba\\(0,\\s*0,\\s*0,\\s*0\\)\\s*0%/.test(getComputedStyle(e).backgroundImage):'missing';})()`), true);

// ── the picture inside it ────────────────────────────────────────────────
// currentSrc is what the browser actually fetched, not what the markup asked
// for: the only honest way to tell which <source> won.
const shown=async()=>await ev(`(()=>{const i=document.querySelector('.bb-slide .hero-bg-img');
  return i?String(i.currentSrc||i.src).split('/').pop():'missing';})()`);
t('the tall frame is fed the key visual, not the banner', await shown(), 'xl.png');
t('the key visual is the big file, not the 230px one',
  await ev(`keyVisual({imgXL:'${XL}',img:'${KV}'})`), XL);
t('and the cover is still the fallback when there is no big one',
  await ev(`keyVisual({img:'${KV}'})`), KV);
t('a background the owner set themselves outranks both',
  await ev(`keyVisual({bgImage:'${BAN}',imgXL:'${XL}',img:'${KV}'})`), BAN);
// A title with no art must render nothing, not an <img> pointing at the page.
t('a title with no art at all emits no empty image',
  await ev(`[...document.querySelectorAll('.bb-slide .hero-bg-img')].every(i=>i.getAttribute('src'))`), true);

// ── motion, in the new shape ─────────────────────────────────────────────
const tr=async(sel)=>await ev(`(()=>{const e=document.querySelector('${sel}');return e?getComputedStyle(e).translate:'missing';})()`);
const num=v=>parseFloat(String(v).split(/\s+/)[1]||'0');
await ev(`document.getElementById('pageEl').scrollTop=400`); await wait(700);
const art=await tr('.bb-slide .hero-bg-img'), body=await tr('.bb-slide .hero-body');
t('the two planes still pull apart in the tall frame', [num(art)>0, num(body)<0], [true,true]);
t('and further than they did in the short one', num(art)>18, true);
await motion('reduce'); await wait(900);
t('reduced motion stops it here too',
  [await tr('.bb-slide .hero-bg-img'), await tr('.bb-slide .hero-body')], ['none','none']);
await motion('no-preference'); await wait(400);

// ── the shapes this must NOT have taken over ─────────────────────────────
// A landscape phone has 393px of height for everything. The strip rule has to
// still win there, or the hero eats the screen it was cut down to fit.
await screen(852,393); await wait(900);
const land=await box();
t('a landscape phone keeps its strip', land && land[1]<200, true);
t('and is fed the wide banner for it', await shown(), 'banner.png');
await screen(1024,1366); await wait(900);
const tab=await box();
t('a tablet keeps the wide composition', tab && tab[0]/tab[1]>1.2, true);
t('and keeps the button, because there the hero is a card',
  await ev(`getComputedStyle(document.querySelector('.bb-slide .hero-cta')).display`), 'inline-flex');
t('and the banner with it', await shown(), 'banner.png');

// ── THE SAME QUESTION, ON THE PAGE BEHIND IT ─────────────────────────────
// The title page header is full-bleed and 360px tall on a phone — near enough
// square — and it was fed the same 1900x400 banner, so it showed about a
// quarter of its width. Same mistake as the hero, one surface along; the same
// <picture> answers it, and the wide shapes must still get the banner.
await screen(393,852); await wait(1000);
await ev(`openDetail('p0')`); await wait(1500);
const dtShown=async()=>await ev(`(()=>{const i=document.querySelector('#detailSheet .dt-banner-img');
  return i?String(i.currentSrc||i.src).split('/').pop():'missing';})()`);
t('the title page header is fed the key visual too', await dtShown(), 'xl.png');
// One <picture>, one <img> inside it. Two images with one hidden would pass any
// assertion about what is on screen while costing every open title a second
// download it never shows.
t('and it is a real <picture>, not two images one of which is hidden',
  await ev(`[document.querySelectorAll('#detailSheet .dt-banner picture').length,
            document.querySelectorAll('#detailSheet .dt-banner img').length]`), [1,1]);
await screen(1024,1366); await wait(1400);
t('a wide header still gets the banner, which is its shape', await dtShown(), 'banner.png');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
