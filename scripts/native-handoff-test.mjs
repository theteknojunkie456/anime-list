// The official app must never frame another site: an App Store binary that
// presents someone else's video inside its own chrome, and injects a script into
// that page, is the thing a review or a rights-holder complaint lands on. The web
// build is a browser and keeps doing browser things. IS_NATIVE comes from the
// user agent, so this runs the same page twice — once as the app, once as the web.
// run: node scripts/native-handoff-test.mjs
import {spawn} from 'node:child_process';
const NATIVE_UA='Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 WatchListNative/1.0';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

async function run(ua,port,dbg,profile){
  const srv=spawn('python3',['-m','http.server',String(port)],{cwd:process.cwd(),stdio:'ignore'});
  const args=['--headless=new','--remote-debugging-port='+dbg,
    `--user-data-dir=${(process.env.TMPDIR||'/tmp')}/${profile}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run'];
  if(ua)args.push('--user-agent='+ua);
  args.push('about:blank');
  const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args,{stdio:'ignore'});
  await wait(3200);
  const tabs=await (await fetch('http://127.0.0.1:'+dbg+'/json/list')).json();
  const ws=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);
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
     {id:'w1',title:'Vinland Saga',status:'watching',kind:'watch',ep:3,epTotal:24,aniId:101348,
      srcUrl:'https://example.com/watch/{title}'}]));
    localStorage.setItem('wl_net_status','approved');
    window.__sent=[];
    window.webkit={messageHandlers:{wl:{postMessage:m=>window.__sent.push(m)}}};
    window.open=()=>{window.__sent.push({type:'window.open'});return null;};
    window.fetch=()=>new Promise(()=>{});`});
  await cmd('Page.navigate',{url:`http://localhost:${port}/index.html?cb=`+Math.random()});
  await wait(4200);
  const isNative=await ev(`IS_NATIVE`);
  const watch=await ev(`(async()=>{window.__sent=[];await watchAnime('w1');
    const f=document.getElementById('pvFrame');
    return {out:window.__sent.some(m=>m.type==='openurl'||m.type==='window.open'),
            framed:!!(f&&f.src&&f.src!=='about:blank'),
            playerOpen:document.getElementById('playerView').classList.contains('on')};})()`);
  // reading must follow the same rule watching does
  const read=await ev(`(()=>{window.__sent=[];
    const f=document.getElementById('pvFrame'); if(f)f.src='about:blank';
    // A reading source must be SET for a hand-off to be the right outcome. With
    // none, the official app deliberately prompts instead — it ships no reading
    // default, which is the other half of this change.
    anime.push({id:'r1',title:'Some Manga',status:'watching',kind:'read',ep:3,aniId:555,
      srcUrl:'https://example.com/read/{slug}',upd:Date.now()});
    // readManga awaits readerCodes(), and this harness stubs fetch to never
    // resolve — so without this the function hangs before it reaches the handoff.
    window.readerCodes=async()=>({});
    try{readManga('r1',4);}catch(e){}
    return new Promise(r=>setTimeout(()=>r({out:window.__sent.some(m=>m.type==='openurl'||m.type==='window.open'),
            framed:!!(f&&f.src&&f.src!=='about:blank')}),600));})()`);
  const yt=await ev(`(()=>{window.__sent=[];const f=document.getElementById('ytFrame');f.innerHTML='';
    openYT('https://archive.org/embed/whatever','x');
    return {out:window.__sent.some(m=>m.type==='openurl'||m.type==='window.open'),
            iframe:/iframe/i.test(f.innerHTML)};})()`);
  ws.close();ch.kill();srv.kill();
  return {isNative,watch,yt,read};
}

const app=await run(NATIVE_UA,8965,9505,'wl-nat');
console.log('    official app:', JSON.stringify(app));
t('the build identifies as the app', app.isNative, true);
t('Watch hands the link out', app.watch.out, true);
t('and never loads it in the player frame', app.watch.framed, false);
t('and does not open the in-app player', app.watch.playerOpen, false);
t('an embed is handed out too', app.yt.out, true);
t('reading hands off as well', app.read.out, true);
t('and does not frame the reader', app.read.framed, false);
t('and no iframe is created for it', app.yt.iframe, false);

const web=await run('',8966,9506,'wl-web');
console.log('    web build:', JSON.stringify(web));
t('the web build is not the app', web.isNative, false);
t('and still frames its embed', web.yt.iframe, true);
console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
