// There is no built-in reading source on either build. There used to be one,
// hardcoded, with a rotating per-site token this file had to keep guessing at.
// The official app had already stopped shipping it; now neither build does.
// run: node scripts/no-builtin-reader-test.mjs
import {spawn} from 'node:child_process';
const PORT=9019,DBG=9565;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-noread`,
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
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'m',title:'Solo Leveling',status:'watching',kind:'read',ep:12,epTotal:179,aniId:105398,upd:Date.now()}]));
localStorage.setItem('wl_net_status','approved');localStorage.removeItem('read_src');
sessionStorage.setItem('wl_booted','1');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

t('nothing set means no link, rather than a site nobody picked',
  await ev(`(()=>{setReadSource('');return readURL(anime[0],5);})()`), '');
t('and the constants that built those links are gone',
  await ev(`['READ_DEFAULT','ASURA_SUFFIX','asuraSuffix'].map(n=>typeof window[n]).join(',')`),
  'undefined,undefined,undefined');
// readManga awaits readerCodes(), which fetches — and the fetch stub above never
// resolves, by design, so the await has to be given something to land on.
t('pressing Read asks which reader instead of guessing',
  await ev(`(async()=>{let asked=false;
    const realPrompt=window.showNoSourcePrompt, realCodes=window.readerCodes;
    window.showNoSourcePrompt=()=>{asked=true;};
    window.readerCodes=()=>Promise.resolve({});
    try{await readManga('m',5);}finally{
      window.showNoSourcePrompt=realPrompt;window.readerCodes=realCodes;}
    return asked;})()`), true);

t('a reader you set yourself still works end to end',
  await ev(`(()=>{setReadSource('https://my-reader.example/series/{slug}/ch-{ch}');
    const u=readURL(anime[0],5);setReadSource('');return u;})()`),
  'https://my-reader.example/series/solo-leveling/ch-5');
t('and a plain address with no tokens is used as-is',
  await ev(`(()=>{setReadSource('https://my-reader.example');
    const u=readURL(anime[0],5);setReadSource('');return u;})()`), 'https://my-reader.example');
t('a per-title pin still beats the global reader',
  await ev(`(()=>{setReadSource('https://global.example/{slug}');
    anime[0].srcUrl='https://pinned.example/series/x';
    const u=readURL(anime[0],5);delete anime[0].srcUrl;setReadSource('');return u;})()`),
  'https://pinned.example/series/x');

t('the Reading tab offers no built-in, and says what to do instead',
  await ev(`(()=>{setReadSource('');setSrcTab('read');openSheet('sourceSheet');renderSource();
    const b=document.getElementById('sourceBody');
    return {builtIn:/Built-in/.test(b.innerHTML),
            asks:/ask which reader/i.test(b.textContent),
            paste:!!b.querySelector('#rsrcQuickIn')};})()`),
  {builtIn:false,asks:true,paste:true});
t('and names your reader once you have one',
  await ev(`(()=>{setReadSource('https://my-reader.example/series/{slug}');renderSource();
    const txt=document.getElementById('sourceBody').textContent;
    setReadSource('');setSrcTab('watch');
    return /my-reader\\.example/.test(txt);})()`), true);

t('nothing anywhere in the app still names the dropped sites',
  await ev(`(()=>{const html=document.documentElement.outerHTML.toLowerCase();
    return {asura:html.includes('asurascans'),anineko:html.includes('anineko')};})()`),
  {asura:false,anineko:false});

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
