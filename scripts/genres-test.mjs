// Ten call sites each split a.genre their own way and none deduplicated. A title
// that picked up "Action" from an import and again from autofill drew the chip
// twice on the detail screen — and counted twice in the stats ranking, so one
// show outweighed another purely because its genres had been written down twice.
// run: node scripts/genres-test.mjs
import {spawn} from 'node:child_process';
const PORT=9017,DBG=9563;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-gen`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(4000);
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
const seed=[
 {id:'a',title:'Doubled',status:'watching',kind:'watch',ep:1,epTotal:12,genre:'Action, Action, Drama',upd:Date.now()},
 {id:'b',title:'Cased',status:'watching',kind:'watch',ep:1,epTotal:12,genre:'action,ACTION,Comedy',upd:Date.now()},
 {id:'c',title:'Spaced',status:'finished',kind:'watch',ep:12,epTotal:12,genre:'  Drama ,, Drama,',upd:Date.now()},
 {id:'d',title:'Clean',status:'plan',kind:'watch',ep:0,epTotal:12,genre:'Mystery',upd:Date.now()}];
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:
 `localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(seed))});`+
 `localStorage.setItem('wl_net_status','approved');sessionStorage.setItem('wl_booted','1');`+
 `window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(56)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

t('a repeated genre is read once',
  await ev(`genresOf({genre:'Action, Action, Drama'})`), ['Action','Drama']);
t('however it was capitalised, keeping the first spelling',
  await ev(`genresOf({genre:'action,ACTION,Comedy'})`), ['action','Comedy']);
t('blanks and stray commas are dropped',
  await ev(`genresOf({genre:'  Drama ,, Drama,'})`), ['Drama']);
t('nothing at all is an empty list, not a crash',
  await ev(`[genresOf({}),genresOf({genre:''}),genresOf(null)].map(x=>x.length).join(',')`), '0,0,0');

t('the detail screen draws each genre once',
  await ev(`(()=>{openDetail('a');
    const chips=[...document.querySelectorAll('#detailSheet .chip')].map(c=>c.textContent);
    closeAll();return chips;})()`), ['Action','Drama']);

t('a doubled genre no longer outweighs anything in the stats',
  await ev(`(()=>{openStats();
    const tags=[...document.querySelectorAll('.sv-cloud .sv-tag')]
      .map(x=>({g:x.textContent.replace(/[0-9]+$/,''),n:+(x.querySelector('s')||{}).textContent}));
    closeStats&&closeStats();
    const action=tags.find(x=>/action/i.test(x.g));
    return action?action.n:null;})()`), 2);

t('and the drill-down still finds the titles behind it',
  await ev(`(()=>{openStats();
    const tag=[...document.querySelectorAll('.sv-cloud .sv-tag')].find(x=>/action/i.test(x.textContent));
    const i=[...document.querySelectorAll('.sv-cloud .sv-tag')].indexOf(tag);
    svDrill('g-'+i,tag);
    const n=document.getElementById('drill-g-'+i).querySelectorAll('.sv-chip').length;
    closeStats&&closeStats();return n;})()`), 2);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
