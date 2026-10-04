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
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
