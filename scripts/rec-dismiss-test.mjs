// "Not for me" has to mean never again. A recommendation is keyed by AniList id
// when it has one and by title when it does not, so the same show arriving both
// ways produced two keys and could come back wearing the other hat.
// run: node scripts/rec-dismiss-test.mjs
import {spawn} from 'node:child_process';
const PORT=9013,DBG=9553;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-rec`,
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
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(52)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// one friend sends it WITH an id
await ev(`(()=>{localStorage.removeItem('recs_dismissed');
  recsIn=[{from:{code:'FRIEND1',name:'A'},at:Date.now(),items:[{aniId:101348,title:'Vinland Saga',kind:'watch'}]}];
  return 1;})()`);
t('it shows before anyone passes on it',
  await ev(`Object.keys(recByAni()).length`), 1);

await ev(`dismissRec(encodeURIComponent('a101348'),{stopPropagation(){},preventDefault(){}})`);
t('passing writes both identities',
  await ev(`(()=>{const m=JSON.parse(localStorage.getItem('recs_dismissed')||'{}');
    return {byId:!!m['a101348'], byTitle:!!m['tvinland saga']};})()`), {byId:true,byTitle:true});

// now the SAME show arrives from someone else with NO id — the old hole
t('the same show without an id stays hidden',
  await ev(`(()=>{const gone=JSON.parse(localStorage.getItem('recs_dismissed')||'{}');
    const it={title:'Vinland Saga',kind:'watch'};
    const isGone=(k,i)=>!!(gone[k]||(i&&i.aniId&&gone['a'+i.aniId])||(i&&i.title&&gone['t'+String(i.title).toLowerCase()]));
    return isGone('tvinland saga',it);})()`), true);

t('and a show nobody passed on is not hidden',
  await ev(`(()=>{const gone=JSON.parse(localStorage.getItem('recs_dismissed')||'{}');
    const it={aniId:999,title:'Something Else',kind:'watch'};
    const isGone=(k,i)=>!!(gone[k]||(i&&i.aniId&&gone['a'+i.aniId])||(i&&i.title&&gone['t'+String(i.title).toLowerCase()]));
    return isGone('a999',it);})()`), false);

t('the dismissal survives a reload', await ev(`!!JSON.parse(localStorage.getItem('recs_dismissed')||'{}')['a101348']`), true);
t('and it is not on the disposable list', await ev(`_DISPOSABLE.indexOf('recs_dismissed')`), -1);

// ── and the list that shows it ──────────────────────────────────────────────
// Writing the dismissal was never the part that failed. The "To you" panel
// built its rows straight from the mailbox and never asked whether any of them
// had been turned down, so pressing "Not for me" wrote the pass, said "Hidden"
// in a toast, and then drew the row again — with the waiting count still
// counting it. The rule now lives in recIsGone() and both lists ask it.
await ev(`(()=>{localStorage.removeItem('recs_dismissed');
  recsIn=[{from:{code:'FRIEND1',name:'A'},at:Date.now(),items:[
    {aniId:101348,title:'Vinland Saga',kind:'watch'},
    {aniId:20605,title:'Tokyo Ghoul',kind:'watch'}]}];
  return 1;})()`);
t('both are waiting before anyone passes',
  await ev(`recsToMeRows(1).filter(r=>r.kind==='new').length`), 2);
t('and the badge agrees', await ev(`recsWaiting()`), 2);

await ev(`rtmPass(encodeURIComponent('a101348'))`);
await wait(400);
t('the one you turned down leaves the list',
  await ev(`recsToMeRows(1).filter(r=>r.kind==='new').map(r=>r.title)`), ['Tokyo Ghoul']);
t('and the waiting count drops with it', await ev(`recsWaiting()`), 1);
t('undo brings it back rather than losing it',
  await ev(`(()=>{const m=JSON.parse(localStorage.getItem('recs_dismissed')||'{}');
    delete m['a101348'];delete m['tvinland saga'];
    localStorage.setItem('recs_dismissed',JSON.stringify(m));
    return recsToMeRows(1).filter(r=>r.kind==='new').length;})()`), 2);

// A show already on your list is a different row and must NOT be hidden by a
// pass — that section is history, not an inbox.
await ev(`(()=>{anime=[{id:'x1',title:'Tokyo Ghoul',aniId:20605,kind:'watch',status:'plan',ep:0,
  recFrom:[{code:'FRIEND1',name:'A',at:Date.now()}],upd:Date.now()}];
  const m=JSON.parse(localStorage.getItem('recs_dismissed')||'{}');
  m['a20605']=Date.now();localStorage.setItem('recs_dismissed',JSON.stringify(m));return 1;})()`);
t('something already on your list stays visible even if its key was passed',
  await ev(`recsToMeRows(1).some(r=>r.kind==='mine'&&r.title==='Tokyo Ghoul')`), true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
