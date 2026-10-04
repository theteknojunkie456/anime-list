// The opening's sound is synthesised at runtime, so it can be checked the same
// way the visuals are: by watching what it schedules. Browsers also block audio
// until the page has been interacted with, and staying silent in that case is
// part of the behaviour, not a failure.
// run: node scripts/boot-sfx-test.mjs
import {spawn} from 'node:child_process';
const PORT=9027,DBG=9569;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-sfx`,
  '--autoplay-policy=no-user-gesture-required',
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
localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(50)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// watch what the cue builds, rather than trying to listen to it
const spy=await ev(`(()=>{
  const log={osc:[],noise:0,nodes:[],gains:[],closed:false};
  const AC=window.AudioContext;
  window.AudioContext=function(){
    const ctx=new AC();
    const co=ctx.createOscillator.bind(ctx), cb=ctx.createBufferSource.bind(ctx),
          cf=ctx.createBiquadFilter.bind(ctx), cg=ctx.createGain.bind(ctx),
          cl=ctx.close.bind(ctx);
    ctx.createOscillator=()=>{const o=co();const st=o.start.bind(o);
      o.start=(t)=>{log.osc.push(o.type);return st(t);};return o;};
    ctx.createBufferSource=()=>{log.noise++;return cb();};
    // Keep the NODE, not its type: a BiquadFilterNode is born 'lowpass' and the
    // code sets its real type on the next line, so reading .type at creation
    // records the default every time and says nothing about the cue.
    ctx.createBiquadFilter=()=>{const f=cf();log.nodes.push(f);return f;};
    // Record gains IN ORDER rather than taking the maximum. The first one built is
    // the master that feeds the destination; the ones after it are internal
    // routing and a send, and those are supposed to sit at 1.0. Taking a max
    // across all of them measured the plumbing and called it the volume.
    ctx.createGain=()=>{const g=cg();
      Object.defineProperty(g.gain,'value',{set(v){log.gains.push(v);},get(){return 0;},configurable:true});
      return g;};
    ctx.close=()=>{log.closed=true;return cl();};
    return ctx;
  };
  window.__sfx=log;
  bootSound();
  return {state:'ran'};})()`);
await wait(300);
const log=await ev(`(()=>{const l=window.__sfx;
  return {osc:l.osc,noise:l.noise,master:l.gains[0],gains:l.gains,
          filters:l.nodes.map(f=>f.type).sort()};})()`);
console.log('    graph:', JSON.stringify(log));
t('it schedules a stack of sines', (log.osc||[]).filter(x=>x==='sine').length>=7, true);
t('no sawtooth riser — that was the cartoon boing', (log.osc||[]).includes('sawtooth'), false);
t('no struck triangles — that was the doorbell', (log.osc||[]).includes('triangle'), false);
t('a noise burst for the impact', log.noise>=1, true);
t('lowpass filters only now', (log.filters||[]).every(f=>f==='lowpass'), true);
t('the master output stays quiet', log.master<=0.2, true);

// the preference
t('muting it stops the cue',
  await ev(`(()=>{setBootSfx(false);const before=window.__sfx.osc.length;bootSound();
    const after=window.__sfx.osc.length;setBootSfx(true);return after===before;})()`), true);
t('and the preference survives a read', await ev(`(()=>{setBootSfx(false);const v=bootSfxOn();setBootSfx(true);return v;})()`), false);
t('default is on', await ev(`(()=>{localStorage.removeItem('wl_boot_sfx');return bootSfxOn();})()`), true);
t('it never throws, whatever the state', await ev(`(()=>{try{bootSound();bootSound();return 'fine';}catch(e){return 'threw: '+e.message;}})()`), 'fine');
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
