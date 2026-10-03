// "Use this device's list everywhere" has to mean everywhere: other devices take
// the copy whole instead of merging their extras back into it — once, and never
// an empty one. run: node scripts/adopt-everywhere-test.mjs
import {spawn} from 'node:child_process';
const PORT=8985,DBG=9525;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-ad`,
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
const NOW=Date.now();
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
// this device holds three titles, one of which the other device does not have
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a',title:'Shared One',status:'watching',kind:'watch',ep:1,epTotal:12,upd:${NOW}},
 {id:'b',title:'Shared Two',status:'plan',kind:'watch',ep:0,upd:${NOW}},
 {id:'mine',title:'Only Here',status:'plan',kind:'watch',ep:0,upd:${NOW}}]));
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
window.__cloudList=[{id:'a',title:'Shared One',status:'watching',kind:'watch',ep:5,epTotal:12,upd:${NOW-99999}},
                    {id:'b',title:'Shared Two',status:'plan',kind:'watch',ep:0,upd:${NOW-99999}}];
window.__adopt=0;
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op==='push')return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}}));
  const data={v:3,list:window.__cloudList,extra:null};
  if(window.__adopt){data.adopt=window.__adopt;data.adoptBy='otherdev';}
  return Promise.resolve(new Response(JSON.stringify({ok:true,data,updatedAt:Date.now()}),
    {status:200,headers:{'Content-Type':'application/json'}}));};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// without the flag it MERGES — the local-only title survives
const merged=await ev(`(async()=>{window.__adopt=0;setSyncAt(0);localStorage.setItem('wl_adopt_seen','0');
  await syncOnOpen();await new Promise(r=>setTimeout(r,500));
  return anime.map(a=>a.title).sort();})()`);
t('normally it merges and keeps local-only titles', merged, ['Only Here','Shared One','Shared Two']);

// with the flag it ADOPTS — the local-only title goes
const adopted=await ev(`(async()=>{window.__adopt=Date.now();setSyncAt(0);
  await syncOnOpen();await new Promise(r=>setTimeout(r,500));
  return {titles:anime.map(a=>a.title).sort(), backup:!!localStorage.getItem('wl_prepush_backup')};})()`);
t('with the flag it takes the other copy whole', adopted.titles, ['Shared One','Shared Two']);
t('and keeps a restore point before doing it', adopted.backup, true);

// and only once
const again=await ev(`(async()=>{
  anime.push({id:'new',title:'Added After',status:'plan',kind:'watch',ep:0,upd:Date.now()});
  setSyncAt(0); await syncOnOpen(); await new Promise(r=>setTimeout(r,500));
  return anime.map(a=>a.title).sort();})()`);
t('the same instruction is not honoured twice', again.includes('Added After'), true);

// never an empty one
const empty=await ev(`(async()=>{const keep=window.__cloudList;window.__cloudList=[];
  window.__adopt=Date.now()+1000; setSyncAt(0);
  await syncOnOpen(); await new Promise(r=>setTimeout(r,500));
  const n=anime.length; window.__cloudList=keep; return n;})()`);
t('an empty cloud copy is never adopted', empty>0, true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
