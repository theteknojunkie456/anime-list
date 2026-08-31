// "+N more shows" named the shows you were behind on and then hid them, inside a
// button that could only start the first one. run: node scripts/resume-more-test.mjs
import {spawn} from 'node:child_process';
const PORT=8959,DBG=9499;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-res`,
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
localStorage.setItem('animelist_v4','[]');
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// three shows behind, so the banner has a first and two others
const setup=`(()=>{
  window.behindItems=()=>[
    {a:{id:'x1',title:'KAIJU GIRL CARAMELISE',ep:8,img:''},behind:1},
    {a:{id:'x2',title:'The Ogre\\u2019s Bride',ep:9,img:''},behind:2},
    {a:{id:'x3',title:'Fairy Tail',ep:1,img:''},behind:5}];
  _resumeGone='';_resumeOpen=false;return 1;})()`;
await ev(setup);

const shut=await ev(`(()=>{const h=behindHTML();const d=document.createElement('div');d.innerHTML=h;
  return {more:(d.querySelector('.resume-more')||{}).textContent, rows:d.querySelectorAll('.resume-row').length,
          inCard:/more show/.test((d.querySelector('.resume-card')||{}).textContent||'')};})()`);
console.log('    collapsed:', JSON.stringify(shut));
t('the count is its own control', shut.more, '+2 more shows');
t('and no longer buried in the card button', shut.inCard, false);
t('nothing listed until asked', shut.rows, 0);

const open=await ev(`(()=>{_resumeOpen=true;const d=document.createElement('div');d.innerHTML=behindHTML();
  return {rows:[...d.querySelectorAll('.resume-row-t')].map(e=>e.textContent),
          label:(d.querySelector('.resume-more')||{}).textContent,
          eps:[...d.querySelectorAll('.resume-row-s')].map(e=>e.textContent)};})()`);
console.log('    expanded:', JSON.stringify(open));
t('pressing it shows every other show', open.rows, ['The Ogre’s Bride','Fairy Tail']);
t('each with the episode it resumes at', open.eps, ['Episode 10 · 2 waiting','Episode 2 · 5 waiting']);
t('and it can be closed again', open.label, 'Show less');

t('each row starts its own show, not the first one',
  await ev(`(()=>{_resumeOpen=true;const d=document.createElement('div');d.innerHTML=behindHTML();
    return [...d.querySelectorAll('.resume-row')].map(b=>b.getAttribute('onclick'));})()`),
  ["resumeWatch('x2')","resumeWatch('x3')"]);

t('one show behind offers no expander',
  await ev(`(()=>{window.behindItems=()=>[{a:{id:'y',title:'Solo',ep:0,img:''},behind:1}];_resumeGone='';
    const d=document.createElement('div');d.innerHTML=behindHTML();
    return d.querySelectorAll('.resume-more').length;})()`), 0);

t('no button is nested inside another',
  await ev(`(()=>{window.behindItems=()=>[
    {a:{id:'x1',title:'A',ep:1,img:''},behind:1},{a:{id:'x2',title:'B',ep:2,img:''},behind:1}];
    _resumeGone='';_resumeOpen=true;
    const d=document.createElement('div');d.innerHTML=behindHTML();
    return [...d.querySelectorAll('button')].some(b=>b.querySelector('button'));})()`), false);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
