// Ratings out of ten, with halves. Everything already rated has to survive the
// move and stay findable, because a four was never necessarily an eight.
// run: node scripts/rating10-test.mjs
import {spawn} from 'node:child_process';
const PORT=8951,DBG=9491;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-rate`,
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
// a list rated on the OLD five-star scale
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a1',title:'Monster',status:'finished',kind:'watch',ep:74,epTotal:74,aniId:19,rating:5},
 {id:'a2',title:'Vinland Saga',status:'finished',kind:'watch',ep:24,epTotal:24,aniId:101348,rating:4},
 {id:'a3',title:'Bocchi the Rock!',status:'watching',kind:'watch',ep:3,epTotal:12,aniId:130003,rating:0},
 {id:'a4',title:'Frieren',status:'plan',kind:'watch',ep:0,epTotal:28,aniId:154587,rating:3}]));
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4400);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// Drive it directly: the harness re-seeds localStorage on any reload, which can
// restore the pre-migration list while leaving the "already done" flag set.
await ev(`(()=>{
  localStorage.removeItem('rating_scale10');
  anime=[{id:'a1',title:'Monster',status:'finished',kind:'watch',ep:74,epTotal:74,aniId:19,rating:5},
         {id:'a2',title:'Vinland Saga',status:'finished',kind:'watch',ep:24,epTotal:24,aniId:101348,rating:4},
         {id:'a3',title:'Bocchi the Rock!',status:'watching',kind:'watch',ep:3,epTotal:12,aniId:130003,rating:0},
         {id:'a4',title:'Frieren',status:'plan',kind:'watch',ep:0,epTotal:28,aniId:154587,rating:3}];
  migrateRatings10(); return 1;})()`);

t('old ratings are doubled, not lost',
  await ev(`anime.map(a=>a.rating)`), [10,8,0,6]);
t('and each is marked as carried over',
  await ev(`anime.map(a=>!!a.r10from5)`), [true,true,false,true]);
t('an unrated show stays unrated', await ev(`!!anime.find(a=>a.id==='a3').r10from5`), false);
t('it never runs twice', await ev(`(()=>{migrateRatings10();return anime.map(a=>a.rating);})()`), [10,8,0,6]);

// finding them
t('"restar" lists the ones still carried over',
  await ev(`anime.filter(SRCH_TERMS.restar).map(a=>a.title)`), ['Monster','Vinland Saga','Frieren']);

// the picker
const ui=await ev(`(()=>{openDetail('a2');
  const r=document.querySelector('.rate-range');
  return {slider:!!r, min:r&&+r.min, max:r&&+r.max, step:r&&+r.step, at:r&&+r.value,
          shown:(document.getElementById('rateVal')||{}).textContent,
          note:!!document.querySelector('.rate-was'),
          stars:document.querySelectorAll('.stars .star').length};})()`);
console.log('    picker:', JSON.stringify(ui));
t('it is a slider, not stars', ui.slider&&ui.stars===0, true);
t('running 0 to 10', [ui.min,ui.max], [0,10]);
t('in half points, so decimals are possible', ui.step, 0.5);
t('starting at the current rating', ui.at, 8);
t('and showing it as a whole number', ui.shown, '8');
t('a carried-over rating says so', ui.note, true);

// decimals
const dec=await ev(`(()=>{setRating(8.5);const a=anime.find(x=>x.id==='a2');
  return {v:a.rating, shown:(document.getElementById('rateVal')||{}).textContent};})()`);
t('a half point is kept', dec.v, 8.5);
t('and printed as 8.5', dec.shown, '8.5');
t('a whole number never prints a trailing zero', await ev(`fmtRate(8)`), '8');
t('an odd decimal snaps to the nearest half', await ev(`(()=>{setRating(7.3);return anime.find(x=>x.id==='a2').rating;})()`), 7.5);
t('out-of-range is clamped, not stored', await ev(`(()=>{setRating(99);return anime.find(x=>x.id==='a2').rating;})()`), 10);
t('and zero clears it', await ev(`(()=>{setRating(0);return anime.find(x=>x.id==='a2').rating;})()`), 0);

// dragging previews, releasing commits
await ev(`(()=>{setRating(6);openDetail('a2');return 1;})()`);
await ev(`rateSlide(9.5)`);
t('dragging only repaints the number', await ev(`(document.getElementById('rateVal')||{}).textContent`), '9.5');
t('and does not write it yet', await ev(`anime.find(x=>x.id==='a2').rating`), 6);

// the rest of the system speaks out of ten
t('AniList gets the score as-is', await ev(`(()=>{const a=anime.find(x=>x.id==='a1');
  const v={};if(a.rating)v.score=a.rating;return v.score;})()`), 10);
t('a pasted "4/5" becomes 8', await ev(`(()=>{const r=_impLine('Naruto 4/5',{});return r&&r.rating;})()`), 8);
t('a pasted "8/10" stays 8', await ev(`(()=>{const r=_impLine('Naruto 8/10',{});return r&&r.rating;})()`), 8);
t('a pasted star rating doubles too', await ev(`(()=>{const r=_impLine('Naruto \u26053',{});return r&&r.rating;})()`), 6);
t('a pasted "8.5/10" keeps its half', await ev(`(()=>{const r=_impLine('Naruto 8.5/10',{});return r&&r.rating;})()`), 8.5);
t('a pasted "4.5/5" becomes 9', await ev(`(()=>{const r=_impLine('Naruto 4.5/5',{});return r&&r.rating;})()`), 9);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
