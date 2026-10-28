import {spawn} from 'node:child_process';
const PORT=9017,DBG=9557;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-fv`,
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
const ev=async x=>(await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(48)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};
const shown=async()=>ev(`(()=>{const b=document.getElementById('nav-fold');
  if(!b)return 'missing';
  const cs=getComputedStyle(b); const r=b.getBoundingClientRect();
  return cs.display!=='none' && r.width>0 && r.height>0;})()`);
// A real wrap means a child sitting BELOW the bar's own box. Counting distinct
// tops called the + a second row, which it is not — it is a taller circle that
// sits proud of its neighbours on purpose.
const navRows=async()=>ev(`(()=>{const n=document.querySelector('.nav');
  const nb=n.getBoundingClientRect();
  const kids=[...n.children].filter(k=>getComputedStyle(k).display!=='none');
  return kids.filter(k=>k.getBoundingClientRect().top>=nb.bottom-1).length;})()`);

await cmd('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
await wait(300);
t('phone portrait: no stray chevron', await shown(), false);
t('phone portrait: nothing sits below the bar', await navRows(), 0);

await cmd('Emulation.setDeviceMetricsOverride',{width:932,height:430,deviceScaleFactor:1,mobile:true});
await wait(300);
t('phone landscape: rail, so the fold is there', await shown(), true);

await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await wait(300);
t('desktop: the fold is there', await shown(), true);

await cmd('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
await wait(300);
t('back to portrait: gone again', await shown(), false);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
