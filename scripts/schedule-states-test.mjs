// Delayed and Airing-next on the weekly schedule.
// run: node scripts/schedule-states-test.mjs
import {spawn} from 'node:child_process';
const PORT=8975,DBG=9515;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-sch`,
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

// drive renderSchedDays directly with a known week
const res=await ev(`(()=>{
  const now=Math.floor(Date.now()/1000);
  const ws=new Date(); ws.setHours(0,0,0,0); ws.setDate(ws.getDate()-ws.getDay());
  document.getElementById('scheduleBody').innerHTML='<div class="sched-days" id="schedDays"></div>';
  renderSchedDays(ws,[
    {id:'p',title:'Already Aired',img:'',episode:1,airingAt:now-7200,aniId:1,lag:0,delayed:0},
    {id:'n',title:'The Next One',img:'',episode:2,airingAt:now+5400,aniId:2,lag:0,delayed:0},
    {id:'d',title:'Pushed Back',img:'',episode:3,airingAt:now+9000,aniId:3,lag:0,delayed:now+3600},
    {id:'l',title:'Later Still',img:'',episode:4,airingAt:now+20000,aniId:4,lag:0,delayed:0}]);
  const rows=[...document.querySelectorAll('.sched-row')];
  return {
    total:rows.length,
    next:rows.filter(r=>r.classList.contains('is-next')).map(r=>r.querySelector('.sched-row-title').textContent.replace('Airing next','').trim()),
    delayed:rows.filter(r=>r.classList.contains('is-delayed')).map(r=>r.querySelector('.sched-row-title').textContent.replace('Delayed','').trim()),
    tags:document.querySelectorAll('.sched-next-tag').length,
    badges:document.querySelectorAll('.sched-delay').length};})()`);
console.log('    ', JSON.stringify(res));
t('every episode rendered', res.total, 4);
t('exactly one row is "next"', res.next.length, 1);
t('and it is the soonest FUTURE one, not the aired one', res.next[0], 'The Next One');
t('only one next tag exists', res.tags, 1);
t('the pushed-back one is flagged', res.delayed, ['Pushed Back']);
t('with exactly one badge', res.badges, 1);

// a past-only week must not invent a "next"
const past=await ev(`(()=>{const now=Math.floor(Date.now()/1000);
  const ws=new Date(); ws.setHours(0,0,0,0); ws.setDate(ws.getDate()-ws.getDay());
  document.getElementById('schedDays').innerHTML='';
  renderSchedDays(ws,[{id:'a',title:'Gone',img:'',episode:1,airingAt:now-3600,aniId:9,lag:0,delayed:0}]);
  return document.querySelectorAll('.sched-row.is-next').length;})()`);
t('a week with nothing upcoming marks nothing', past, 0);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
