// A "next season" banner is derived from an id that can change under it. Showing
// one that cannot say which id it came from is how a finished show ends up
// offering an unrelated show's sequel. run: node scripts/nextup-source-test.mjs
import {spawn} from 'node:child_process';
const PORT=8955,DBG=9495;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-nx`,
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
// the real ids: Vanitas Part 2 has no sequel; the banner claimed one anyway
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'v2',title:'The Case Study of Vanitas Part 2',status:'finished',kind:'watch',ep:12,epTotal:12,aniId:135136,seqTried:1,
  nextUp:{id:185660,title:'Dandadan 3rd Season',soon:true,from:0}},
 {id:'ok',title:'Vinland Saga',status:'finished',kind:'watch',ep:24,epTotal:24,aniId:101348,seqTried:1,
  nextUp:{id:113697,title:'Vinland Saga Season 2',soon:false,from:101348}},
 {id:'moved',title:'Some Show',status:'finished',kind:'watch',ep:12,epTotal:12,aniId:555,seqTried:1,
  nextUp:{id:999,title:'A Sequel Of The Old Id',soon:false,from:444}}]));
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4400);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

t('a banner that cannot name its source is not shown',
  await ev(`!!nextUpOf(anime.find(a=>a.id==='v2'))`), false);
t('nor one derived from an id the show no longer has',
  await ev(`!!nextUpOf(anime.find(a=>a.id==='moved'))`), false);
t('a genuine one still shows',
  await ev(`(nextUpOf(anime.find(a=>a.id==='ok'))||{}).title`), 'Vinland Saga Season 2');

t('and the unvouched ones are queued to be asked again',
  await ev(`seqNeedy().map(a=>a.id).sort()`), ['moved','v2']);
t('while the good one is left alone',
  await ev(`seqNeedy().some(a=>a.id==='ok')`), false);

t('the banner is absent from the rendered sheet',
  await ev(`(()=>{openDetail('v2');return document.querySelectorAll('.dt-next').length;})()`), 0);
t('and present for the good one',
  await ev(`(()=>{openDetail('ok');return document.querySelectorAll('.dt-next').length;})()`), 1);

// a fresh answer stamps its source, so it survives the next render
const fresh=await ev(`(()=>{const a=anime.find(x=>x.id==='v2');
  a.nextUp={id:1,title:'A Real Sequel',soon:false,from:+a.aniId};
  return {shown:(nextUpOf(a)||{}).title, needy:seqNeedy().some(x=>x.id==='v2')};})()`);
t('a freshly stamped answer is trusted', fresh.shown, 'A Real Sequel');
t('and stops being re-queued', fresh.needy, false);

// changing the id must invalidate it again
t('re-matching the show retires the old answer',
  await ev(`(()=>{const a=anime.find(x=>x.id==='v2');a.aniId=222;return !!nextUpOf(a);})()`), false);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
