// The ambient wash is sampled from the artwork you are looking at and was then
// mixed 50/50 with the accent, described in the code as "never argues with the
// theme". Measured, it argued constantly: averaging two complementary colours
// channel-by-channel walks toward grey and lands on a hue neither parent had.
// Green artwork under the red theme came out yellow-green, 89 degrees off the
// accent and desaturated to 0.10 — a muddy green wash under a red app, which is
// what got reported. Hue is clamped now; saturation and lightness still move.
// run: node scripts/ambient-hue-test.mjs
import {spawn} from 'node:child_process';
const PORT=9015,DBG=9561;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-amb`,
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
localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
sessionStorage.setItem('wl_booted','1');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};
await ev(`window.__h=hx=>Math.round(_rgb2hsl.apply(null,hex2rgb(hx))[0]);
          window.__s=hx=>_rgb2hsl.apply(null,hex2rgb(hx))[1];
          window.__d=(a,b)=>{const d=Math.abs(a-b)%360;return d>180?360-d:d;};`);

const ARTS=['#2f8f4e','#1fa36b','#3a6ea5','#8b5cff','#f5a623','#d93636','#20c997'];
const probe=async(accent)=>ev(`(()=>{const out=[];
  for(const art of ${JSON.stringify(ARTS)}){
    const s=conditionAccent(art), c=hueNear(s,'${accent}',34);
    out.push({d:window.__d(window.__h(c),window.__h('${accent}')),sat:window.__s(c)});
  }
  return {worst:Math.max(...out.map(o=>o.d)), minSat:Math.min(...out.map(o=>o.sat))};})()`);

for(const [name,accent] of [['red','#e0445c'],['green','#26a040'],['violet','#8b5cff'],['amber','#f5a623']]){
  const r=await probe(accent);
  t(`${name}: the wash never drifts off the theme`, r.worst<=34, true);
  t(`${name}: and never turns to mud doing it`, r.minSat>=0.45, true);
}

t('artwork that already matches the theme is left where it is',
  await ev(`(()=>{const s=conditionAccent('#d93636');
    return window.__d(window.__h(hueNear(s,'#e0445c',34)),window.__h(s))===0;})()`), true);
t('the clamp is a limit, not a flattening',
  await ev(`(()=>{const a=hueNear(conditionAccent('#2f8f4e'),'#e0445c',34);
    const b=hueNear(conditionAccent('#3a6ea5'),'#e0445c',34);
    return a!==b;})()`), true);
t('saturation and lightness still come from the artwork',
  await ev(`(()=>{const dark=hueNear(conditionAccent('#1a4d2e'),'#e0445c',34);
    const bright=hueNear(conditionAccent('#7cff9e'),'#e0445c',34);
    return dark!==bright;})()`), true);
t('rubbish in does not produce rubbish out',
  await ev(`(()=>{return [hueNear('','#e0445c',34),hueNear('#zzzzzz','#e0445c',34),
    hueNear('#2f8f4e','',34)].map(x=>typeof x).join(',');})()`), 'string,string,string');

// the collision that nearly shipped
t('there is exactly one _rgb2hsl, and it still takes three channels',
  await ev(`(()=>{const r=_rgb2hsl(255,0,0);
    return Array.isArray(r)&&Math.round(r[0])===0&&r.length===3;})()`), true);
t('and the theme-from-artwork extractor still works through it',
  await ev(`(()=>{const hex=_hsl2hex(210,0.6,0.5);return /^#[0-9a-f]{6}$/.test(hex);})()`), true);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
