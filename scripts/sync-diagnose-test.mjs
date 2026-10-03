// The diagnostic has to report the disagreement correctly and must not change
// anything while doing it. run: node scripts/sync-diagnose-test.mjs
import {spawn} from 'node:child_process';
const PORT=8983,DBG=9523;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-dg`,
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
const OLD=Date.now()-86400000, NEW=Date.now();
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a',title:'Here Only',status:'watching',kind:'watch',ep:1,epTotal:12,upd:${NEW}}]));
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
window.__pushes=0;
window.__cloud=JSON.stringify([
 {id:'a',title:'Here Only',status:'watching',kind:'watch',ep:1,epTotal:12,upd:${OLD}},
 {id:'b',title:'Cloud Only',status:'plan',kind:'watch',ep:0,upd:${OLD}}]);
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op==='push'){window.__pushes++;return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}}));}
  return Promise.resolve(new Response(JSON.stringify({ok:true,data:window.__cloud,updatedAt:${OLD}}),{status:200,headers:{'Content-Type':'application/json'}}));};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const before=await ev(`JSON.stringify({n:realList().length,pushes:window.__pushes,at:syncAt()})`);
const d=await ev(`(async()=>{const d=await syncDiagnose();return {lc:d.localCount,cc:d.cloudCount,
  newerHere:d.localNewest>d.cloudNewest, build:d.build, fails:d.pushFails};})()`);
console.log('    ', JSON.stringify(d));
t('it counts this device', d.lc, 1);
t('and counts the cloud copy', d.cc, 2);
t('and says which side is newer', d.newerHere, true);
t('and reports the build', typeof d.build==='string'&&d.build.length>3, true);

const after=await ev(`JSON.stringify({n:realList().length,pushes:window.__pushes,at:syncAt()})`);
t('it changed nothing it looked at', after, before);

const txt=await ev(`(async()=>{document.body.insertAdjacentHTML('beforeend','<div id="syncDiagBox"></div>');
  await showSyncDiagnosis();return document.getElementById('syncDiagBox').textContent;})()`);
t('and says so in words', /THIS device holds the newer edits/.test(txt), true);
t('listing both counts', /Titles here1|Titles here\s*1/.test(txt.replace(/\s+/g,'')+txt), true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
