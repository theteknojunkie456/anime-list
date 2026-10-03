// Finishing a show is the one emotional peak a tracker has. It must fire once,
// clean up after itself, and respect anyone who has asked for less motion.
// Headless Chrome reports prefers-reduced-motion:reduce by default, so this
// emulates both answers rather than testing only the one that happens to be set.
// run: node scripts/finish-moment-test.mjs
import {spawn} from 'node:child_process';
const PORT=8995,DBG=9535;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-fm`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(3200);
const tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;w[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>(await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;
const motion=v=>cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:v}]});
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a',title:'Vinland Saga',status:'watching',kind:'watch',ep:20,epTotal:24,upd:Date.now()},
 {id:'b',title:'Monster',status:'watching',kind:'watch',ep:70,epTotal:74,upd:Date.now()}]));
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(46)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

await motion('no-preference'); await wait(150);
t('motion is allowed in this pass', await ev(`matchMedia('(prefers-reduced-motion:reduce)').matches`), false);
t('nothing on screen to begin with', await ev(`document.querySelectorAll('.fin-stamp').length`), 0);
await ev(`openDetail('a')`); await wait(300);
t('finishing a show lands a stamp',
  await ev(`(()=>{setDetailStatus('finished');return document.querySelectorAll('.fin-stamp').length;})()`), 1);
t('finishing the SAME one again does not',
  await ev(`(()=>{document.querySelectorAll('.fin-stamp').forEach(e=>e.remove());
    setDetailStatus('finished');return document.querySelectorAll('.fin-stamp').length;})()`), 0);
t('a different show still gets its own',
  await ev(`(()=>{openDetail('b');setDetailStatus('finished');return document.querySelectorAll('.fin-stamp').length;})()`), 1);
await wait(1200);
t('and it takes itself away', await ev(`document.querySelectorAll('.fin-stamp').length`), 0);

await motion('reduce'); await wait(150);
t('with reduced motion asked for, nothing lands',
  await ev(`(()=>{anime.find(x=>x.id==='a').status='watching';openDetail('a');
    setDetailStatus('finished');return document.querySelectorAll('.fin-stamp').length;})()`), 0);
t('but the status still changed', await ev(`(anime.find(x=>x.id==='a')||{}).status`), 'finished');
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
