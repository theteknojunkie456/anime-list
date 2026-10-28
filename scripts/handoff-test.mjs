// "i want WL to open stuff in-app. if not in-app, then like it opens a tab but
// it doesnt take you to another page"
//
// The hand-off ended `catch(e){location.href=url}`. The one case that line was
// written for — the tab failing to open — navigated WatchList ITSELF to the
// streaming site. You did not get a tab, you lost the app. And a tab blocked by
// the browser returns null rather than throwing, so that catch never ran and the
// button simply appeared dead.
// run: node scripts/handoff-test.mjs
import {spawn} from 'node:child_process';
const PORT=9005,DBG=9551;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-hand`,
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
sessionStorage.setItem('wl_booted','1');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4000);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// Intercept the two ways out of the page, and watch location for the old bug.
const HARNESS=`(()=>{
  window.__clicks=[];window.__opens=[];window.__href=location.href;
  const realClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    window.__clicks.push({href:this.href,target:this.target,rel:this.rel});
    /* do not actually navigate the harness */
  };
  window.__restore=()=>{HTMLAnchorElement.prototype.click=realClick;};
})()`;

t('a hand-off opens a tab, and it is a real link the browser asked for',
  await ev(`(()=>{${HARNESS};openExternal('https://peacocktv.com/watch/x');
    return window.__clicks.map(c=>({t:c.target,rel:c.rel}));})()`),
  [{t:'_blank',rel:'noopener noreferrer'}]);

t('…and it carries the address it was given',
  await ev(`window.__clicks[0].href`), 'https://peacocktv.com/watch/x');

t('WatchList itself never moves',
  await ev(`location.href===window.__href`), true);

// the regression that caused the report
t('a hand-off that cannot open a tab still does not move the app',
  await ev(`(()=>{
    const realOpen=window.open;
    window.open=()=>null;                      // exactly how a blocked pop-up behaves
    HTMLAnchorElement.prototype.click=()=>{throw new Error('blocked');};
    const before=location.href;
    openExternal('https://peacocktv.com/watch/x');
    const moved=location.href!==before;
    window.open=realOpen;
    return moved;})()`), false);

t('and says so, with something you can actually tap',
  await ev(`(()=>{const el=document.getElementById('toast');
    const a=el.querySelector('a.toast-link');
    return {shown:el.classList.contains('on'),
            says:el.textContent.includes('blocked'),
            href:a?a.getAttribute('href'):null,
            target:a?a.getAttribute('target'):null};})()`),
  {shown:true,says:true,href:'https://peacocktv.com/watch/x',target:'_blank'});

// the schemes that must never leave
t('a javascript: link is refused',
  await ev(`(()=>{${HARNESS};openExternal('javascript:window.__pwned=1');
    return {clicks:window.__clicks.length,pwned:!!window.__pwned};})()`), {clicks:0,pwned:false});
t('a data: link is refused',
  await ev(`(()=>{${HARNESS};openExternal('data:text/html,<script>window.__p2=1</script>');
    return window.__clicks.length;})()`), 0);
t('a custom scheme is refused',
  await ev(`(()=>{${HARNESS};openExternal('myapp://do/something');
    return window.__clicks.length;})()`), 0);

// the toast's own escaping still holds when a link rides along
t('a link toast does not become an injection point',
  await ev(`(()=>{toast('<img src=x onerror=window.__t3=1>',600,{href:'https://e.com/a',label:'<b>x</b>'});
    const el=document.getElementById('toast');
    return {ran:!!window.__t3,label:el.querySelector('a').textContent};})()`),
  {ran:false,label:'<b>x</b>'});
t('and a link that is not http is simply not offered',
  await ev(`(()=>{toast('hi',600,{href:'javascript:1',label:'go'});
    return !!document.getElementById('toast').querySelector('a.toast-link');})()`), false);

// Searching the raw source matched the comment that QUOTES the old line, which
// is the comment explaining why it is gone. Strip comments first, so this reads
// the code and not the note about the code.
const CODE=`openExternal.toString().replace(/\\/\\*[\\s\\S]*?\\*\\//g,'').replace(/\\/\\/[^\\n]*/g,'')`;
t('the native build still hands off over the bridge',
  await ev(`${CODE}.indexOf("type:'openurl'")>0`), true);
t('and no code path assigns the app’s own address any more',
  await ev(`/location\\s*\\.\\s*href\\s*=/.test(${CODE})`), false);

await ev(`window.__restore&&window.__restore()`);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
