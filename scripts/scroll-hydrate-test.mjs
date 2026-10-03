// Appending cards on scroll used to run a whole-list image pass and a full
// render(). Now only the new cards are fetched, and their pictures are patched
// into place. The pictures still have to arrive.
// run: node scripts/scroll-hydrate-test.mjs
import {spawn} from 'node:child_process';
const PORT=9005,DBG=9545;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-hyd`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','--window-size=1440,900','about:blank'],{stdio:'ignore'});
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
const mk=i=>({id:'t'+i,title:'Show '+i,status:'plan',kind:'watch',ep:0,epTotal:12,aniId:800+i,upd:Date.now()-i});
localStorage.setItem('animelist_v4',JSON.stringify(Array.from({length:120},(_,i)=>mk(i))));
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4500);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(50)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

t('cards carry their own id', await ev(`!!document.querySelector('.pcard[data-gid]')`), true);

// an offloaded image: the item has a key and no picture until IndexedDB answers
const got=await ev(`(async()=>{
  const PX='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  window.idbGet=async k=>(k==='k9'?PX:null);
  const a=anime[0]; a.imgKey='k9'; delete a.img;
  render(); await new Promise(r=>setTimeout(r,250));
  const before=(document.querySelector('.pcard[data-gid="'+a.id+'"] .pcard-img')||{}).src||'none';
  await hydrateNewCards([a]);
  await new Promise(r=>setTimeout(r,120));
  const after=(document.querySelector('.pcard[data-gid="'+a.id+'"] .pcard-img')||{}).src||'none';
  return {resolved:a.img===PX, patched:after.indexOf('base64')>0, changed:before!==after};})()`);
console.log('    ', JSON.stringify(got));
t('the offloaded image is fetched', got.resolved, true);
t('and patched into that very card', got.patched, true);

t('an item with nothing offloaded costs no work',
  await ev(`(async()=>{let calls=0;const real=window.idbGet;window.idbGet=async k=>{calls++;return null;};
    await hydrateNewCards([{id:'x',title:'No Key'}]);window.idbGet=real;return calls;})()`), 0);

t('and it never calls render()',
  await ev(`(async()=>{let n=0;const real=window.render;window.render=()=>{n++;};
    await hydrateNewCards([{id:'y',title:'Nope'}]);window.render=real;return n;})()`), 0);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
