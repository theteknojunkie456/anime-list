// A filter word is not a title. Typing `restar` and being offered a show called
// "restar" is the app not recognising its own vocabulary.
// run: node scripts/search-term-empty-test.mjs
import {spawn} from 'node:child_process';
const PORT=8961,DBG=9501;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-tm`,
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
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a1',title:'Monster',status:'finished',kind:'watch',ep:74,epTotal:74,rating:8},
 {id:'a2',title:'Vinland Saga',status:'watching',kind:'watch',ep:3,epTotal:24}]));
localStorage.setItem('rating_scale10','1');
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// The input is debounced by 110ms before it renders, so type, wait, then read.
const look=async q=>{
  await ev('(()=>{const i=document.getElementById("searchIn");i.value='+JSON.stringify(q)+';i.dispatchEvent(new Event("input",{bubbles:true}));return 1;})()');
  await wait(340);
  return ev('(()=>{const g=document.getElementById("pageEl");const txt=(g&&g.textContent)||"";'
    +'return {say:txt.replace(/\\s+/g," ").trim().slice(0,130), addsTitle:/Add\\s*[\u201c"]/.test(txt)};})()');
};

const r1=await look('restar');
console.log('    restar:', JSON.stringify(r1));
t('it says what was asked, not "no matches"', /carried over from a star rating/.test(r1.say), true);
t('and never offers to add it as a show', r1.addsTitle, false);

const r2=await look('weak');
t('the same for a doubtful match', /doubtfully matched/.test(r2.say), true);
t('still no add button', r2.addsTitle, false);

const r3=await look('unrated');
t('a term that DOES match still just filters', /No matches/.test(r3.say), false);

const r4=await look('zzzznotashow');
console.log('    real search:', JSON.stringify(r4));
t('a real title search still says no matches', /No matches/.test(r4.say), true);
t('and still offers to add it', r4.addsTitle, true);

const r5=await look('restar zzzznotashow');
t('a term mixed with text is a search again', r5.addsTitle, true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
