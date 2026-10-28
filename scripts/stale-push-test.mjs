// CAN A DEVICE HOLDING AN OLD LIST DRAG THE CLOUD BACKWARDS?
//
// The merge was never the problem: mergeLists picks the newest edit per title
// and sync-merge-test proves it. But that only runs on devices that PULL. A
// push REPLACES the cloud copy, and the guards around it only refuse a list
// that is empty or has collapsed — a stale list is neither. It is the right
// size and full of real titles; it is simply missing what happened elsewhere.
//
// So one device opening with yesterday's list and saving anything at all
// republished yesterday's list over everyone's newer one, and the whole list
// walked backwards. This is that, reproduced: a device whose copy of a title is
// older than the cloud's, pushing.
import {spawn} from 'node:child_process';
const PORT=8794, DIR=process.cwd();
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:DIR,stdio:'ignore'});
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prof=(process.env.TMPDIR||'/tmp')+'/wl-stale-push-profile';
const ch=spawn(CHROME,['--headless=new','--remote-debugging-port=9583',`--user-data-dir=${prof}`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run',
  '--disable-background-timer-throttling','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const bye=c=>{try{ws&&ws.close();}catch(e){}try{ch.kill();}catch(e){}try{srv.kill();}catch(e){}process.exit(c);};
// Poll for the debugger rather than guessing how long Chrome takes to come up.
// A fixed sleep is the reason this reported "could not reach the test browser"
// on a loaded machine, which says nothing about the thing under test.
let ws,tabs=null;
for(let i=0;i<120;i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:9583/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){console.log('could not reach the test browser after 60s');bye(1);}
try{ ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl); }
catch(e){console.log('could not open a CDP socket:',e.message);bye(1);}
// onopen alone never fires if the socket errors or closes instead, which is the
// same infinite wait one line earlier.
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('the test browser refused the connection'));};});
let id=0; const waiters={};
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&waiters[m.id])waiters[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;waiters[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:r.result.exceptionDetails.exception?.description||'threw'};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Emulation.setFocusEmulationEnabled',{enabled:true});

const T=1700000000000;
// This device: "Love Unseen" NOT yet watched, and its copy is the older one.
// Another title it legitimately owns the newest edit of, so the merge has to
// keep that too rather than just handing the cloud's copy back wholesale.
const localList=[
  {id:'lu',title:'Love Unseen Beneath the Night Sky',status:'watching',kind:'watch',ep:0,epTotal:12,upd:T},
  {id:'fr',title:'Frieren',status:'watching',kind:'watch',ep:9,epTotal:28,upd:T+9000},
];
// The cloud, written by the device he actually used: Love Unseen finished.
const cloudList=[
  {id:'lu',title:'Love Unseen Beneath the Night Sky',status:'finished',kind:'watch',ep:12,epTotal:12,upd:T+5000},
  {id:'fr',title:'Frieren',status:'watching',kind:'watch',ep:3,epTotal:28,upd:T+1000},
];
const seed=`
localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(localList))});
localStorage.setItem('sync_code','testcode123');
localStorage.setItem('wt_seen','1');
localStorage.setItem('wl_seen_tut','1');
localStorage.setItem('wl_net_status','approved');
// This device last synced BEFORE the cloud write, which is the whole point:
// the cloud holds an edit it has never merged.
localStorage.setItem('syncat_animelist_v4','${T+2000}');
window.__cloud={v:3,list:${JSON.stringify(cloudList)},extra:{}};
window.__cloudAt=${T+5000};
window.__pushed=0;
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const J=x=>Promise.resolve(new Response(JSON.stringify(x),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='pull')return J({data:window.__cloud,updatedAt:window.__cloudAt});
  if(b.op==='push'){window.__pushed++;window.__cloud=b.data;window.__cloudAt=Date.now();return J({ok:true,updatedAt:window.__cloudAt});}
  if(b.op==='rec_pull')return J({recs:[],passes:[],echoes:[],parties:[]});
  return J({data:null,updatedAt:0});
};
`;
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:seed});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html`});
await wait(5000);

let pass=0,fail=0;
const check=(name,got,want)=>{const o=got===want;o?pass++:fail++;
  console.log((o?'ok  ':'FAIL')+'  '+name+'  -> '+JSON.stringify(got)+(o?'':' (want '+JSON.stringify(want)+')'));};

// Force the device to publish, the way saving anything would.
await ev(`(async()=>{try{await syncPush();}catch(e){}return 1;})()`);
await ev(`(async()=>{try{flushPush();}catch(e){}await new Promise(r=>setTimeout(r,2500));return 1;})()`);
await ev(`(async()=>{try{await syncPush();}catch(e){}await new Promise(r=>setTimeout(r,900));return 1;})()`);

const cloudLU=await ev(`(()=>{const c=window.__cloud;const L=(c&&c.list)||[];const x=L.find&&L.find(a=>a.id==='lu');return x?x.ep:'gone';})()`);
const cloudFR=await ev(`(()=>{const c=window.__cloud;const L=(c&&c.list)||[];const x=L.find&&L.find(a=>a.id==='fr');return x?x.ep:'gone';})()`);
const localLU=await ev(`(()=>{const x=(typeof anime!=='undefined'?anime:[]).find(a=>a.id==='lu');return x?x.ep:'gone';})()`);

check('the cloud still has Love Unseen watched, not reverted',cloudLU,12);
check('this device ended up with the watched state too',localLU,12);
check("this device's own newer edit survived the reconcile",cloudFR,9);

console.log(`\n${pass} passed, ${fail} failed`);
bye(fail?1:0);
