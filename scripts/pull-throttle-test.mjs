// Switching back to the app must not re-pull every time. Harmless when a pull
// was one KV read; not harmless once the party rail made it one read PER
// FRIEND. run: node scripts/pull-throttle-test.mjs
import {spawn} from 'node:child_process';
const PORT=8796;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prof=(process.env.TMPDIR||'/tmp')+'/wl-pull-throttle';
const ch=spawn(CHROME,['--headless=new','--remote-debugging-port=9340',`--user-data-dir=${prof}`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run',
  '--disable-background-timer-throttling','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// Poll for the debugger rather than guessing how long Chrome needs to come
// up. A fixed sleep is why this reported ECONNREFUSED on a loaded machine —
// a failure about the harness, wearing the clothes of a failure about the
// app, which is the worst kind to read at the bottom of a run.
let tabs=null;
for(let _i=0;_i<120;_i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:9340/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  // Take the server and the browser down with it. Exiting without this
  // leaks both, and the next run's preflight refuses to start because the
  // ports it needs are held by the run that already gave up.
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){}
  process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
// onopen alone never fires if the socket errors or closes instead, which is the
// same infinite wait one line earlier.
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('the test browser refused the connection'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
// A command the browser never answers makes this promise wait forever, and
// every poll in the file is built on it — so one stalled socket is not a slow
// test, it is a test that never ends. Deadline, then say which command died.
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:r.result.exceptionDetails.exception?.description};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Emulation.setFocusEmulationEnabled',{enabled:true});
const seed=`
localStorage.setItem('animelist_v4',JSON.stringify([{id:'a1',title:'F',status:'watching',kind:'watch',ep:1,epTotal:12}]));
localStorage.setItem('friend_code','aaaaaaaaaa1');
localStorage.setItem('friends',JSON.stringify(Array.from({length:49},(_,i)=>({code:'fcode'+String(i).padStart(7,'0'),name:'F'+i}))));
localStorage.setItem('wt_seen','1');
window.__pulls=0;
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  if(b.op==='rec_pull'){window.__pulls++;window.__lastFriends=(b.friends||[]).length;
    return Promise.resolve(new Response(JSON.stringify({recs:[],passes:[],echoes:[],parties:[]}),{status:200,headers:{'Content-Type':'application/json'}}));}
  return Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));};
`;
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:seed});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html`});
await wait(4500);

let pass=0,fail=0;
const t=(n,g,e2)=>{const o=g===e2;o?pass++:fail++;console.log((o?'ok  ':'FAIL')+'  '+n+'  -> '+g+(o?'':' (want '+e2+')'));};

// 20 app-switches in quick succession
await ev(`window.__pulls=0`);
await ev(`(async()=>{for(let i=0;i<20;i++){dispatchEvent(new Event('visibilitychange'));await new Promise(r=>setTimeout(r,20));}})()`);
await wait(600);
t('20 rapid app-switches cause at most one pull', (await ev('window.__pulls'))<=1, true);

// a forced catch-up still runs every time
await ev(`window.__pulls=0`);
await ev(`(async()=>{for(let i=0;i<3;i++)await pullRecs(1);})()`);
await wait(400);
t('an explicit catch-up is never throttled', await ev('window.__pulls'), 3);

// each pull carries the friend list (this is the read fan-out being bounded)
t('the pull names the friends to check', await ev('window.__lastFriends'), 49);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
