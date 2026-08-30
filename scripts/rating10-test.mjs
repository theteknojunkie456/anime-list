// Ratings moved from five stars to a number out of ten. Everything already
// rated has to survive the move and stay findable, because a four was never
// necessarily an eight. run: node scripts/rating10-test.mjs
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
  const btns=[...document.querySelectorAll('.rate-n')];
  return {count:btns.length, labels:btns.map(b=>b.textContent).join(''),
          lit:btns.filter(b=>b.classList.contains('on')).length,
          picked:(btns.find(b=>b.classList.contains('pick'))||{}).textContent,
          note:!!document.querySelector('.rate-was'),
          stars:document.querySelectorAll('.stars .star').length};})()`);
console.log('    picker:', JSON.stringify(ui));
t('ten buttons, one to ten', ui.count===10&&ui.labels==='12345678910', true);
t('no stars left', ui.stars, 0);
t('the scale fills to the score', ui.lit, 8);
t('and marks the exact one', ui.picked, '8');
t('a carried-over rating says so', ui.note, true);

const after=await ev(`(()=>{setRating(7);
  const a=anime.find(x=>x.id==='a2');
  return {v:a.rating, still:!!a.r10from5, note:!!document.querySelector('.rate-was')};})()`);
t('re-rating sets the new value', after.v, 7);
t('and stops calling it carried over', after.still, false);
t('and the note goes away', after.note, false);
t('so it drops out of "restar"', await ev(`anime.filter(SRCH_TERMS.restar).map(a=>a.title)`), ['Monster','Frieren']);

// the rest of the system speaks out of ten
t('AniList gets the score as-is', await ev(`(()=>{const a=anime.find(x=>x.id==='a1');
  const v={};if(a.rating)v.score=a.rating;return v.score;})()`), 10);
t('a pasted "4/5" becomes 8', await ev(`(()=>{const r=_impLine('Naruto 4/5',{});return r&&r.rating;})()`), 8);
t('a pasted "8/10" stays 8', await ev(`(()=>{const r=_impLine('Naruto 8/10',{});return r&&r.rating;})()`), 8);
t('a pasted star rating doubles too', await ev(`(()=>{const r=_impLine('Naruto \u26053',{});return r&&r.rating;})()`), 6);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
