// The three home banners, and which one wins. Two of them were unreachable for
// as long as they have existed: nudgeHTML() decides for itself which applies,
// but the call site asked shouldNudge() first, and that requires there to be NO
// sync code — while both hidden branches require one. So "cloud backup isn't
// going through" could not appear however many pushes failed, and nobody was
// ever told to save the code that restores their list.
// run: node scripts/nudge-test.mjs
import {spawn} from 'node:child_process';
const PORT=Number(process.env.PORT||8795);
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prof=(process.env.TMPDIR||'/tmp')+'/wl-nudge'+PORT;
const ch=spawn(CHROME,['--headless=new','--remote-debugging-port='+(9337+PORT-8795),`--user-data-dir=${prof}`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run',
  '--disable-background-timer-throttling','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(2500);
const tabs=await (await fetch('http://127.0.0.1:'+(9337+PORT-8795)+'/json/list')).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;w[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:r.result.exceptionDetails.exception?.description};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Emulation.setFocusEmulationEnabled',{enabled:true});
const seed=`
localStorage.setItem('animelist_v4',JSON.stringify(Array.from({length:8},(_,i)=>
 ({id:'x'+i,title:'Show '+i,status:'watching',kind:'watch',ep:1,epTotal:12}))));
localStorage.setItem('wt_seen','1');
window.fetch=()=>new Promise(()=>{});
`;
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:seed});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html`});
await wait(4500);

const banner=async setup=>{
  await ev(`(()=>{${setup};renderSync?renderSync():render();return 1;})()`);
  await wait(250);
  return (await ev(`(()=>{const n=document.querySelector('.nudge-t');return n?n.textContent.trim().slice(0,60):'(no banner)';})()`));
};
const K='pushfail_'+(await ev('String(LSKEY)'));
const SC='sync_'+(await ev('String(LSKEY)'));
const CS=await ev('String(CODE_SEEN)');
const BO=await ev('String(BACKUP_OFF)');
const NF=await ev('String(NUDGE_FLAG)');

let pass=0,fail=0;
const t=(name,got,want)=>{const o=got.includes(want);o?pass++:fail++;console.log((o?'ok  ':'FAIL')+'  '+name+'\n       '+got);};

t('backup off entirely -> offer to turn it on',
  await banner(`localStorage.removeItem('${SC}');localStorage.setItem('${BO}','1');localStorage.removeItem('${NF}');localStorage.removeItem('${K}')`),
  'Backup is off');

t('backup on, code never seen -> show the code',
  await banner(`localStorage.setItem('${SC}','abc123def');localStorage.removeItem('${CS}');localStorage.removeItem('${K}')`),
  'Save your code');

t('backup on and FAILING -> warn and offer an export',
  await banner(`localStorage.setItem('${SC}','abc123def');localStorage.setItem('${CS}','1');
                localStorage.setItem('${K}',JSON.stringify({n:4,at:Date.now(),why:'KV put() limit exceeded for the day.'}))`),
  "isn't going through");

t('a failing backup outranks the code reminder',
  await banner(`localStorage.removeItem('${CS}');
                localStorage.setItem('${K}',JSON.stringify({n:9,at:Date.now(),why:'quota'}))`),
  "isn't going through");

t('healthy backup -> no nudge at all',
  await banner(`localStorage.setItem('${CS}','1');localStorage.removeItem('${K}')`),
  '(no banner)');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
