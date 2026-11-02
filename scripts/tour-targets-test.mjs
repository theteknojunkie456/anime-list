// Every step of the walkthrough points at something that is actually there.
//
// This failure is silent by design: wtPlace() hides the ring and centres the
// card when a selector matches nothing, so a tour step aimed at a deleted
// button still *reads* — it just stops pointing, and nobody notices. That
// happened twice in one day. #nav-sources went stale the moment that button was
// removed from the bar, and a new step was added pointing at a button that only
// exists when cloud backup is on.
//
// So: walk the whole tour, let each step open whatever it wants to open, and
// require its target to resolve AND have a box on screen.
// run: node scripts/tour-targets-test.mjs
import {spawn} from 'node:child_process';
const PORT=9051,DBG=9591;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-tourtg`,
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
await cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
// A device that has been set up: backup on, a friend, a service. Several steps
// point at controls that only exist in that state, which is the state the tour
// is actually run in.
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([{id:'a',title:'Vinland Saga',aniId:101348,status:'watching',kind:'watch',ep:5,epTotal:24,upd:Date.now()}]));
localStorage.setItem('sync_animelist_v4','ABCDEFGHJK1234567890');
localStorage.setItem('tut_seen_animelist_v4','1');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('seen_release','2026-11-01.64');
localStorage.setItem('friend_code','MYFRIENDCODE1');
localStorage.setItem('friends',JSON.stringify([{code:'OTHERFRIEND1',name:'Rin'}]));
localStorage.setItem('my_services',JSON.stringify([{name:'A site',url:'https://x/{slug}?ep={ep}'}]));
window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const n=await ev(`WT_STEPS.length`);
t('the tour has steps', n>0, true);

for(let i=0;i<n;i++){
  const title=await ev(`String(WT_STEPS[${i}].t||'(untitled)')`);
  // Let the step set its own stage, exactly as wtGo does.
  await ev(`(()=>{try{closeAll();}catch(e){} const s=WT_STEPS[${i}];
            if(typeof s.open==='function')s.open();return 1;})()`);
  await wait(650);
  const r=await ev(`(()=>{const s=WT_STEPS[${i}];
    let el=null; try{ el=typeof s.sel==='function'?s.sel():document.querySelector(s.sel); }catch(e){}
    if(!el)return {found:false,onScreen:false,sel:String(s.sel)};
    return {found:true,onScreen:el.getClientRects().length>0,sel:String(s.sel)};})()`);
  t(`step ${i+1} "${title.slice(0,46)}" points at something real`,
    !!(r&&r.found&&r.onScreen), true);
  if(r&&(!r.found||!r.onScreen)) console.log('        selector: '+(r.sel||'?'));
}

// The one that was actually wrong this morning: a selector naming an element
// that no longer exists anywhere in the document.
const dead=await ev(`WT_STEPS.filter(s=>typeof s.sel==='string'&&s.sel.startsWith('#')
  &&!document.getElementById(s.sel.slice(1).split(' ')[0])).map(s=>s.sel)`);
t('no step names an id that is not in the document at all', dead, []);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
