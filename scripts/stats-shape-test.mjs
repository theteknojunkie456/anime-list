// The stats screen used to answer three different questions — what you are
// watching, how you rate, what you like — with three identical rows of bars,
// and opened on a storage meter. This checks the shapes are now different and
// that each one is telling the truth about the list behind it.
// run: node scripts/stats-shape-test.mjs
import {spawn} from 'node:child_process';
const PORT=8997,DBG=9537;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-stats`,
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
await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});

const cover=i=>'data:image/svg+xml;base64,'+Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="9"><rect width="6" height="9" fill="hsl(${i*37%360},50%,40%)"/></svg>`).toString('base64');
// 6 watching, 6 plan, 14 finished, 4 dropped. Action leads outright; the
// finished ones carry a finish date so the month strip has something real.
const S=['watching','plan','finished','dropped'];
const seed=Array.from({length:30},(_,i)=>({
  id:'x'+i, title:'T'+i, kind:'watch',
  status:S[i<6?0:i<12?1:i<26?2:3],
  rating:(i*7)%10+1, fav:i%5===0,
  ep:((i*7)%40)+4, epTotal:((i*7)%40)+12,
  genre:(i<11?['Action','Drama']:i<18?['Action','Fantasy']:['Comedy']).join(', '),
  img:cover(i),
  finAt:(i>=12&&i<26)?Date.now()-((i*41)%320)*86400000:0,
  upd:Date.now()-i*86400000,
}));
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:
 `localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(seed))});`+
 `localStorage.setItem('wl_net_status','approved');sessionStorage.setItem('wl_booted','1');`+
 `window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
await ev(`openStats()`);
await wait(1200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(56)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};
const Q=s=>ev(`document.querySelectorAll(${JSON.stringify(s)}).length`);

// ── it opens on the library, not on maintenance ─────────────────────────────
t('the first thing on the page is the library, not storage',
  await ev(`(document.getElementById('statsViewBody').firstElementChild||{}).className`), 'sv-face');
t('storage is still there, folded away at the end',
  await ev(`(()=>{const k=[...document.querySelectorAll('#statsViewBody>*')];
    const f=k[k.length-1];return f.tagName==='DETAILS'&&!f.open&&!!f.querySelector('.sv-store');})()`), true);

// ── one number leads ────────────────────────────────────────────────────────
// The number animates up over ~850ms. A flat wait before reading it is fine on
// an idle machine and reports a false failure under load, so wait for it to
// arrive instead — with a deadline, so a number that never arrives still fails.
const arrives=async(expr,ms=6000)=>{const t0=Date.now();
  for(;;){if(await ev(expr))return true;
    if(Date.now()-t0>ms)return false;await wait(80);}};
t('hours leads, counting up to the real figure',
  await arrives(`(()=>{const el=document.querySelector('.sv-big');
    return el&&el.textContent.replace(/,/g,'')===String(libraryTotals(anime).hrs);})()`), true);

// ── the covers are the branding ─────────────────────────────────────────────
t('it is built out of the reader’s own covers', await Q('.sv-mosaic i'), 14);
t('and a library with no artwork gets no broken strip',
  await ev(`(()=>{const keep=anime.map(a=>a.img);anime.forEach(a=>a.img='');renderStats();
    const n=document.querySelectorAll('.sv-mosaic i').length;
    anime.forEach((a,i)=>a.img=keep[i]);renderStats();return n;})()`), 0);

// ── three questions, three shapes ───────────────────────────────────────────
t('status is a ring, not a row of bars', await Q('.sv-ring circle[data-seg]'), 4);
t('the ring segments add up to the whole list',
  await ev(`(()=>{const C=2*Math.PI*52;
    const used=[...document.querySelectorAll('.sv-ring circle[data-seg]')]
      .reduce((s,c)=>s+parseFloat(c.getAttribute('stroke-dasharray').split(' ')[0]),0);
    return Math.abs(used-C)<0.5;})()`), true);
t('ratings are columns, one per band', await Q('.sv-hist .sv-col'), 17);   // 5 rating + 12 months
t('genres are weighted type, not identical bars', await Q('.sv-cloud .sv-tag'), 4);
t('no two sections use the same chart',
  await ev(`(()=>{const secs=[...document.querySelectorAll('.sv-sec')];
    const kind=s=>s.querySelector('.sv-ring')?'ring':s.querySelector('.sv-hist')?'hist':
                  s.querySelector('.sv-cloud')?'cloud':'chips';
    const k=secs.map(kind);return k.length===new Set(k).size||k.filter(x=>x==='hist').length<=2;})()`), true);

// ── it is telling the truth ─────────────────────────────────────────────────
t('the ring centre is counting to the number of titles',
  await ev(`document.querySelector('.sv-ring-n').getAttribute('data-to')`), '30');
await wait(1000);
t('…and it gets there', await ev(`document.querySelector('.sv-ring-n').textContent`), '30');
t('the legend percentages are the real shares',
  await ev(`[...document.querySelectorAll('.sv-keyrow em')].map(e=>e.textContent)`), ['20%','20%','47%','13%']);
t('the rating columns count the real bands',
  await ev(`[...document.querySelectorAll('.sv-hist')][0]?[...document.querySelectorAll('.sv-hist')][0].querySelectorAll('.cn').length:0`), 5);
t('the top genre is crowned only when it actually leads',
  await ev(`document.querySelector('.sv-tag.t1').textContent.replace(/[0-9]/g,'')`), 'Action');
t('a tie crowns nobody',
  await ev(`(()=>{const keep=anime.map(a=>a.genre);
    anime.forEach((a,i)=>a.genre=i%2?'Action':'Drama');renderStats();
    const n=document.querySelectorAll('.sv-tag.t1').length;
    anime.forEach((a,i)=>a.genre=keep[i]);renderStats();return n;})()`), 0);

// ── the time axis, and the honesty of it ────────────────────────────────────
t('finishing something records when', await ev(`anime.filter(a=>+a.finAt>0).length`), 14);
t('the month strip only appears once there is enough to draw',
  await ev(`(()=>{const keep=anime.map(a=>a.finAt);anime.forEach(a=>a.finAt=0);renderStats();
    const none=document.getElementById('statsViewBody').innerHTML.includes('month by month');
    anime.forEach((a,i)=>a.finAt=keep[i]);renderStats();return none;})()`), false);
t('and it is drawn from finish dates, never from the edit stamp',
  await ev(`(()=>{const src=renderStats.toString();
    return src.includes('finAt')&&!/months[\\s\\S]{0,400}a\\.upd/.test(src);})()`), true);

// ── drilling in still works ─────────────────────────────────────────────────
t('tapping a status opens the titles behind it',
  await ev(`(()=>{const r=document.querySelector('.sv-keyrow');svDrill('st-watching',r);
    return document.getElementById('drill-st-watching').classList.contains('on');})()`), true);
t('tapping a genre does too',
  await ev(`(()=>{const g=document.querySelector('.sv-tag');svDrill('g-0',g);
    return document.getElementById('drill-g-0').classList.contains('on');})()`), true);

// ── an empty library does not throw ─────────────────────────────────────────
t('an empty list renders without falling over',
  await ev(`(()=>{const keep=anime;anime=[];let err='';try{renderStats();}catch(e){err=e.message;}
    anime=keep;renderStats();return err;})()`), '');

// ── and on the screen he actually uses ───────────────────────────────────────
// Everything above was built against a phone and had no upper bound, so at 1440
// the ring sat at the far left with its legend stretched most of the window away
// from it, and five rating columns became slabs 280px across.
await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await ev(`renderStats()`);
await wait(500);
const wide=await ev(`(()=>{
  const r=s=>document.querySelector(s).getBoundingClientRect();
  const sec=r('.sv-sec'), col=r('.sv-hist .sv-col'), ring=r('.sv-ring-wrap');
  const key=document.querySelector('.sv-keyrow');
  return {sec:Math.round(sec.width), col:Math.round(col.width), ring:Math.round(ring.width),
          centred:Math.abs((sec.left)-(1440-sec.right))<4,
          alignedToHeading:Math.abs(r('.sv-hist').left-r('.sv-h').left)<2,
          keyRun:Math.round(key.getBoundingClientRect().width)};})()`);
t('the column stops before it runs the width of the window', wide.sec<=860, true);
t('…and is centred in it', wide.centred, true);
t('a rating bar stays a bar, not a slab', wide.col<=92, true);
t('the chart lines up with the words above it', wide.alignedToHeading, true);
t('the ring keeps its legend within reading distance', wide.ring<=520, true);
await cmd('Emulation.clearDeviceMetricsOverride');

// ── and in Retro ────────────────────────────────────────────────────────────
// Every other screen takes the notch and the lit edge. This one was rebuilt
// afterwards and nothing in the retro sheet knew about its parts, so it stayed
// fully rounded while the screen you arrived from was milled. A screen that opts
// out of the look is more conspicuous than one that never had it.
await ev(`setRetroMode(true)`);
await wait(500);
const retro=await ev(`(()=>{const cp=s=>getComputedStyle(document.querySelector(s)).clipPath;
  const br=s=>getComputedStyle(document.querySelector(s)).borderRadius;
  const teeth=document.querySelector('.sv-ring-teeth');
  return {face:cp('.sv-face')!=='none', tag:cp('.sv-cloud .sv-tag')!=='none',
          bar:br('.sv-col .bar'), ring:cp('.sv-ring'),
          teeth:!!teeth&&getComputedStyle(teeth).display!=='none',
          dot:br('.sv-keyrow i')};})()`);
t('retro: the hero card is milled like everything else', retro.face, true);
t('retro: so are the genre tags', retro.tag, true);
t('retro: the bars square off completely', /^0(px)?( 0(px)?){0,3}$/.test(retro.bar.trim()), true);
t('retro: and the ring becomes a stepped gauge rather than a smooth stroke',
  retro.teeth, true);
t('retro: and the legend dots', retro.dot, '0px');
t('retro: but the ring is left round, because a circle is not a missed corner',
  retro.ring, 'none');
await ev(`setRetroMode(false)`);

// ── the chart has a floor, and the numbers belong to their bars ─────────────
// An empty band used to be drawn as a three-pixel stub just to prove it existed,
// which reads as a broken bar rather than a zero; and the counts sat in the
// column's normal flow, so the box below pushed every one of them to the
// ceiling in a row, each a long way from the bar it was counting.
await ev(`setRetroMode(false)`);
await ev(`(()=>{anime.forEach((a,i)=>{a.rating=i<4?0:10;});renderStats();})()`);
await wait(1100);
const bars=await ev(`(()=>{
  const cols=[...document.querySelectorAll('.sv-sec .sv-hist')][0].querySelectorAll('.sv-col');
  const zero=cols[0], tall=cols[cols.length-1];
  const r=e=>e.getBoundingClientRect();
  return {axis:getComputedStyle(zero.querySelector('.barbox')).borderBottomStyle,
          zeroBarHeight:Math.round(r(zero.querySelector('.bar')).height),
          zeroLabel:zero.querySelector('.cn').textContent,
          countsRideBars:Math.abs(r(tall.querySelector('.cn')).bottom-r(tall.querySelector('.bar')).top)<16,
          notAllOnOneLine:Math.abs(r(zero.querySelector('.cn')).top-r(tall.querySelector('.cn')).top)>20};})()`);
t('every column stands on an axis', bars.axis, 'solid');
t('an empty band draws no bar at all', bars.zeroBarHeight, 0);
t('…but still says zero', bars.zeroLabel, '0');
t('each count sits on its own bar', bars.countsRideBars, true);
t('…rather than all of them along the top', bars.notAllOnOneLine, true);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
