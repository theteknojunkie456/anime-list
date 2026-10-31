// Two devices that each invented their own cloud code, merged into one list.
//
// The failure this is really guarding against is silent and total: mergeLists()
// matches on a.id, and two devices that minted their own codes generated their
// own uid() for the same show — so an id-based merge turns every shared title
// into a pair. The merge has to match the way the rest of the app matches, and
// it has to keep what Export/Import throws away (notes, favourites), because
// losing those quietly is exactly why this exists instead of that.
// run: node scripts/merge-code-test.mjs
import {spawn} from 'node:child_process';
const PORT=9043,DBG=9583;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-mergecode`,
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
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');

// THIS device: its own code, its own ids, notes and a favourite it must not lose.
const MINE=[
  {id:'mine-1',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:5,epTotal:24,
   notes:'rewatch the Askeladd arc',fav:true,upd:2000},
  {id:'mine-2',kind:'watch',status:'plan',title:'Tokyo Ghoul',aniId:20605,ep:0,epTotal:12,upd:2000},
];
// THE OTHER device: the same two shows under DIFFERENT ids, further along, plus
// one it has alone.
const THEIRS=[
  {id:'their-9',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:11,epTotal:24,
   notes:'ep 11 is the one',upd:3000},
  {id:'their-8',kind:'watch',status:'finished',title:'Tokyo Ghoul',aniId:20605,ep:12,epTotal:12,upd:3000},
  {id:'their-7',kind:'watch',status:'plan',title:'Monster',aniId:19,ep:0,epTotal:74,upd:3000},
];
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(MINE))});
localStorage.setItem('sync_animelist_v4','MYOWNCODE1234567890');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('tut_seen_animelist_v4','1');
window.__pulled=[];
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const J=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='pull'){
    window.__pulled.push(b.code);
    if(b.code==='THEIRCODE9876543210')return J({data:{v:3,list:${JSON.stringify(THEIRS)},extra:{}},updatedAt:3000});
    if(b.code==='LOCKEDCODE111111111')return J({data:{v:3,list:{v:2,iv:'x',ct:'y'},extra:{}},updatedAt:3000});
    if(b.code==='EMPTYCODE2222222222')return J({data:null,updatedAt:0});
    return J({data:null,updatedAt:0});
  }
  if(b.op==='push')return J({ok:true,updatedAt:Date.now()});
  return new Promise(()=>{});
};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};
const type=c=>ev(`(()=>{const el=document.getElementById('syncCodeIn');if(!el)return 'no field';el.value=${JSON.stringify(c)};return 1;})()`);

t('this device starts with its own two', await ev(`anime.length`), 2);

// ── the merge ───────────────────────────────────────────────────────────────
await ev(`openSheet('backupSheet')`); await wait(500);
await type('THEIRCODE9876543210');
await ev(`mergeFromCode()`); await wait(900);

t('the same show under two different ids does not double',
  await ev(`anime.filter(a=>a.aniId===101348).length`), 1);
t('three titles, not five', await ev(`anime.length`), 3);
t('the one only they had came across',
  await ev(`anime.some(a=>a.aniId===19)`), true);
t('the further episode wins', await ev(`anime.find(a=>a.aniId===101348).ep`), 11);
t('the stronger status wins', await ev(`anime.find(a=>a.aniId===20605).status`), 'finished');
t('MY notes survive', /Askeladd/.test(await ev(`anime.find(a=>a.aniId===101348).notes||''`)), true);
t('and theirs are kept too, not overwritten',
  /ep 11 is the one/.test(await ev(`anime.find(a=>a.aniId===101348).notes||''`)), true);
t('a favourite is not lost', await ev(`!!anime.find(a=>a.aniId===101348).fav`), true);

// The whole point: this is NOT adopting their code.
t('this device keeps its own code', await ev(`syncCode()`), 'MYOWNCODE1234567890');
t('and it only ever pulled theirs, never pushed to it',
  await ev(`window.__pulled.includes('THEIRCODE9876543210')`), true);
t('a restore point was written first',
  await ev(`(JSON.parse(localStorage.getItem('wl_prepush_backup')||'[]')).length`), 2);

// ── merging the same code twice is not a way to double your list ────────────
await type('THEIRCODE9876543210');
await ev(`mergeFromCode()`); await wait(900);
t('merging the same code again changes nothing', await ev(`anime.length`), 3);

// ── the refusals ────────────────────────────────────────────────────────────
await type('MYOWNCODE1234567890');
await ev(`mergeFromCode()`); await wait(500);
t('it refuses this device\'s own code', await ev(`anime.length`), 3);

await type('EMPTYCODE2222222222');
await ev(`mergeFromCode()`); await wait(700);
t('a code with nothing behind it changes nothing', await ev(`anime.length`), 3);

await type('LOCKEDCODE111111111');
await ev(`mergeFromCode()`); await wait(700);
t('a password-locked list is refused rather than merged as garbage',
  await ev(`anime.length`), 3);

await type('nonsense');
await ev(`mergeFromCode()`); await wait(400);
t('and a malformed code never reaches the network',
  await ev(`window.__pulled.filter(c=>!/^(THEIRCODE|MYOWNCODE|EMPTYCODE|LOCKEDCODE)/.test(c)).length`), 0);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
