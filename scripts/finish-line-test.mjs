// IT IS CALLED A LIST. YOU GET TO THE BOTTOM OF A LIST.
//
// Everything the app counted, it counted the way round with no end in it:
// 9 / 24 is where you are, hours watched is where you have been. Neither is a
// finish line. This file holds the other direction — what is LEFT — at the
// three scales it shows up: one title, one shelf, the whole list.
//
// THE TWO THINGS THAT WOULD MAKE IT UNTRUSTWORTHY, and the reason most of these
// assertions exist:
//
//   1. "2 left" about an episode that has not aired yet. The count is right and
//      the sentence is a lie, and once a countdown has lied about one evening
//      nobody reads the next one. Anything still airing is excluded everywhere.
//   2. A title that quietly LEAVES the home screen. Nearly-done titles are
//      lifted out of Up next rather than added a second time (the home-screen
//      invariant in ARCHITECTURE.md) — so switching the shelf off has to put
//      them back, or hiding a section costs you the titles that were on it.
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const PORT=9091,DBG=9637;
let src=readFileSync('index.html','utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/,'const NETWORK_GATE=false;');
const DAY=86400, now=Math.floor(Date.now()/1000);
const base={kind:'watch',dur:24,genre:'Action',genres:['Action'],aniColor:'#5a7f9c'};
// Five of these exist only to fill the billboard. The home screen shows each
// title once: the spotlight is computed first and takes the five most recent
// watching titles, so on a ten-title list EVERY nearly-done title would be up
// in the hero and the shelf would correctly be empty — a seed that proves
// nothing. On a real library the hero is five of hundreds.
const filler=Array.from({length:5},(_,i)=>({...base,id:'fill'+i,title:'Filler '+i,
  status:'watching',ep:5,epTotal:24,upd:20000+i}));
const list=[
  ...filler,
  // in reach, and nothing left to air — these are the shelf
  {...base,id:'n1',title:'Two Left',        status:'watching',ep:22,epTotal:24,upd:9000},
  {...base,id:'n2',title:'One Left',        status:'watching',ep:11,epTotal:12,upd:8000},
  {...base,id:'n3',title:'Three Left',      status:'watching',ep:21,epTotal:24,upd:7000},
  // in reach by the count, but the finale is on Saturday. NOT the shelf.
  {...base,id:'air',title:'Still Airing',   status:'watching',ep:10,epTotal:12,airAt:now+3*DAY,airEp:11,upd:6000},
  // out of reach: stays a fraction, stays in Up next
  {...base,id:'far',title:'Long Way Off',   status:'watching',ep:4,epTotal:51,upd:5000},
  // nothing honest to count against
  {...base,id:'open',title:'No Total',      status:'watching',ep:30,epTotal:0,upd:4000},
  // the rest of the library, for the whole-list figure
  {...base,id:'f1',title:'Done One',        status:'finished',ep:12,epTotal:12,upd:3000},
  {...base,id:'f2',title:'Done Two',        status:'finished',ep:24,epTotal:24,upd:2900},
  {...base,id:'p1',title:'Not Started',     status:'plan',    ep:0, epTotal:10,upd:2800},
  // dropped is a decision, not outstanding work: out of both halves
  {...base,id:'d1',title:'Given Up On',     status:'dropped', ep:2, epTotal:100,upd:2700},
];
const seed={wl_net_status:'approved',seen_release:(src.match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9'])[1],seen_msg:'1',
  animelist_v4:JSON.stringify(list),onboarded_animelist_v4:'1',tut_seen_animelist_v4:'1',backupoff_animelist_v4:'1',backup_nudge_animelist_v4:'1'};
const inject='<script>try{'+Object.entries(seed).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')+'}catch(e){}</script>';
mkdirSync('.preview',{recursive:true});writeFileSync('.preview/finish.html',src.replace('<script',inject+'<script'));
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-finish`,
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
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:2,mobile:true});
await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/.preview/finish.html?cb=`+Math.random()});
await wait(5200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(56)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// ── the arithmetic ───────────────────────────────────────────────────────
t('what is left is the total minus where you are',
  await ev(`leftOf({status:'watching',ep:22,epTotal:24})`), 2);
t('a finished title has nothing left, whatever the count says',
  await ev(`leftOf({status:'finished',ep:3,epTotal:24})`), 0);
t('an open-ended series counts as nothing rather than guessing',
  await ev(`leftOf({status:'watching',ep:300,epTotal:0})`), 0);
t('and a count past the end cannot go negative',
  await ev(`leftOf({status:'watching',ep:99,epTotal:24})`), 0);
t('a plan-to-watch title is its whole length',
  await ev(`leftOf({status:'plan',ep:0,epTotal:10})`), 10);

// ── the rule that keeps it honest ────────────────────────────────────────
t('two from the end, with nothing to air, can be finished',
  await ev(`finishable(anime.find(a=>a.id==='n1'))`), true);
t('two from the end with the finale still to air CANNOT',
  await ev(`finishable(anime.find(a=>a.id==='air'))`), false);
t('so the shelf will not carry it either',
  await ev(`nearlyDone(anime).map(a=>a.id).includes('air')`), false);

// ── the shelf ────────────────────────────────────────────────────────────
const shelf=async()=>await ev(`(()=>{const h=[...document.querySelectorAll('.row-sec')]
    .find(r=>(r.querySelector('.row-title')||{}).textContent==='Nearly done');
  if(!h)return null;return [...h.querySelectorAll('.pcard')].map(c=>c.getAttribute('data-gid'));})()`);
t('the shelf exists and holds the ones within reach, nearest first',
  await shelf(), ['n2','n1','n3']);
t('the long way off is not on it',
  (await shelf()||[]).includes('far'), false);

// ── a title appears once on the home screen ──────────────────────────────
const rail=async()=>await ev(`[...document.querySelectorAll('.rz-card')].length
  ? [...document.querySelectorAll('.rz-card')].map(c=>String(c.getAttribute('onclick')).replace(/\\D+/g,'')).join(',') : ''`);
t('Up next gave them up rather than showing them twice',
  await ev(`(()=>{const near=new Set(nearlyDone(anime).map(a=>a.id));
    const rail=[...document.querySelectorAll('.rz-card')].map(c=>(String(c.getAttribute('onclick')).match(/'([^']+)'/)||[])[1]);
    return rail.filter(id=>near.has(id)).length;})()`), 0);
t('but Up next still has the ones that are not nearly done',
  await ev(`(()=>{const rail=[...document.querySelectorAll('.rz-card')].map(c=>(String(c.getAttribute('onclick')).match(/'([^']+)'/)||[])[1]);
    return ['far','open','air'].every(id=>rail.includes(id));})()`), true);
// Hiding a section must cost you a shelf, never the titles that were on it.
await ev(`toggleHomeSection('nearly')`); await wait(900);
t('switching the shelf off puts them back in Up next',
  await ev(`(()=>{const rail=[...document.querySelectorAll('.rz-card')].map(c=>(String(c.getAttribute('onclick')).match(/'([^']+)'/)||[])[1]);
    return ['n1','n2','n3'].every(id=>rail.includes(id));})()`), true);
t('and the shelf is gone with it', await shelf(), null);
await ev(`toggleHomeSection('nearly')`); await wait(900);
t('switching it back on restores the shelf', await shelf(), ['n2','n1','n3']);
// Every card on this shelf is Watching, so a WATCHING badge on each of them is
// one word repeated down the row — the rule the status shelves already follow.
t('the shelf does not label every card with the status they share',
  await ev(`(()=>{const h=[...document.querySelectorAll('.row-sec')]
      .find(r=>(r.querySelector('.row-title')||{}).textContent==='Nearly done');
    const sc=h&&h.querySelector('.row-scroll');
    const b=h&&h.querySelector('.pcard-badge');
    return [sc?sc.getAttribute('data-onestatus'):'no row', b?getComputedStyle(b).display:'no badge'];})()`),
  ['watching','none']);

// ── the title ────────────────────────────────────────────────────────────
const card=async(gid,sel)=>await ev(`(()=>{const c=document.querySelector('[data-gid="${gid}"] ${sel}');
  return c?c.textContent.trim():'none';})()`);
t('a card within reach counts down', await card('n1','.pc-left'), '2 left');
t('a card out of reach stays a fraction', await card('far','.pc-ep'), '4/51');
t('and out of reach never shows a countdown', await card('far','.pc-left'), 'none');
t('a still-airing card stays a fraction too', [await card('air','.pc-left'), await card('air','.pc-ep')], ['none','10/12']);

// ── the whole list ───────────────────────────────────────────────────────
// Fifteen titles seeded, one of them dropped: the dropped one is out of the
// denominator AND out of the work left, or the only way to reach 100% would be
// to finish the thing you chose to stop watching.
const EPS_LEFT=5*19 + 2+1+3 + 2 + 47 + 0 + 10;   // fillers, the near three, airing, far, open-ended, plan
t('dropped is out of both halves of the figure',
  await ev(`(()=>{const F=finishLine(anime);return [F.total,F.done,F.pct];})()`), [14,2,14]);
t('and its 98 unwatched episodes are not counted as work left',
  await ev(`finishLine(anime).eps`), EPS_LEFT);
t('the hours left come off the real runtime',
  await ev(`finishLine(anime).hrs`), Math.round(EPS_LEFT*24/60));
await ev(`openStats()`); await wait(1200);
t('Stats draws the finish line',
  await ev(`(()=>{const h=[...document.querySelectorAll('.sv-h')].find(e=>/How far through/.test(e.textContent));
    if(!h)return 'missing';const s=h.parentNode.querySelector('.sv-fin-sub');
    return s?s.textContent.replace(/\\s+/g,' ').trim():'no sub';})()`),
  EPS_LEFT+' episodes to go, about '+Math.round(EPS_LEFT*24/60)+' hours');
t('and the bar is filled to the same figure',
  await ev(`(()=>{const h=[...document.querySelectorAll('.sv-h')].find(e=>/How far through/.test(e.textContent));
    const f=h&&h.parentNode.querySelector('.pfill');return f?f.style.width:'missing';})()`), '14%');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
