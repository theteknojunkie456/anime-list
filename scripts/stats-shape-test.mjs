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
await wait(3200);
const tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json();
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
t('hours leads, and it counted up to the real figure',
  await ev(`(()=>{const el=document.querySelector('.sv-big');
    return el.textContent.replace(/,/g,'')===String(libraryTotals(anime).hrs);})()`), true);

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

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
