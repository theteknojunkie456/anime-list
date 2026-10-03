// The nav stands up into a left rail only when there is room for it: wide AND
// tall. A phone in landscape is wide but short, and a rail would cram there.
// run: node scripts/nav-layout-test.mjs
import {spawn} from 'node:child_process';
const PORT=8979,DBG=9519;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-nav`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(3200);
const tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;w[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>(await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[]');
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4000);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(42)+String(g)+(ok?'':'  (want '+e+')'));};

async function shape(wpx,hpx){
  await cmd('Emulation.setDeviceMetricsOverride',{width:wpx,height:hpx,deviceScaleFactor:1,mobile:false});
  await wait(260);
  return await ev(`(()=>{const n=document.querySelector('.nav');const r=n.getBoundingClientRect();
    // a rail is tall and narrow and pinned left; a bar is wide and short at the bottom
    return (r.height>r.width && r.left<2 && r.top<2) ? 'rail' : 'bar';})()`);
}

t('desktop 1440x900',            await shape(1440,900),  'rail');
t('tablet landscape 1180x820',   await shape(1180,820),  'rail');
t('phone landscape 932x430',     await shape(932,430),   'bar');
t('phone portrait 430x932',      await shape(430,932),   'bar');
t('squashed window 1400x500',    await shape(1400,500),  'bar');
t('tablet portrait 820x1180',    await shape(820,1180),  'bar');
t('back to desktop still a rail',await shape(1440,900),  'rail');
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
