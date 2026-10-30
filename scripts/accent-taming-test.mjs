// Whatever colour you pick, the app still looks like itself.
//
// The point is not that the picker works — it is that the four ways a free
// colour picker ruins a dark UI are all closed: a navy too dark to read, a
// neon that buzzes, a grey that makes the app look broken rather than themed,
// and white-on-a-pale-fill. The hue you chose survives all four fixes, because
// the hue is the part you actually meant.
// run: node scripts/accent-taming-test.mjs
import {spawn} from 'node:child_process';
const PORT=9041,DBG=9581;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-accent`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){} process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:
 `localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');
  localStorage.setItem('tut_seen_animelist_v4','1');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// The four ways it goes wrong, each named by what it looks like.
const CASES=[
  ['a navy nobody can read',   '#0a1038'],
  ['a neon that buzzes',       '#00ff2a'],
  ['a grey that reads as broken','#6e6e70'],
  ['a near-white',             '#fbfbff'],
  ['a muddy brown',            '#3a2a16'],
  ['pure black',               '#000000'],
];
for(const [name,hex] of CASES){
  const r=await ev(`(()=>{const out=tameAccent('${hex}');
    return {out, contrast:+_contrast(out,'#0b0b0d').toFixed(2), hue:Math.round(_rgb2hsl(..._hex2rgb(out))[0]),
            srcHue:Math.round(_rgb2hsl(..._hex2rgb('${hex}'))[0]), sat:+_rgb2hsl(..._hex2rgb(out))[1].toFixed(2), light:+_rgb2hsl(..._hex2rgb(out))[2].toFixed(2)};})()`);
  t(name+': still legible on the ground', r.contrast>=4.5, true);
  t(name+': saturation lands in the band', r.sat>=0.39&&r.sat<=0.75, true);
  t(name+': lightness lands in the band', r.light>=0.45&&r.light<=0.89, true);
  // Pure black and pure grey have no hue to keep, so they are exempt from this one.
  if(!/^#000000$|^#6e6e70$/.test(hex))
    t(name+': and it is still the colour you chose', Math.abs(r.hue-r.srcHue)<=2, true);
}

// It is what gets SAVED, not just what gets painted — otherwise the swatch lies
// and every other device re-derives its own answer.
await ev(`setAccent('#0a1038',false)`);
await wait(200);
const stored=await ev(`localStorage.getItem('accent_override')`);
t('the tamed colour is what is stored', stored!=='#0a1038'&&/^#[0-9a-f]{6}$/i.test(stored||''), true);
t('and the painted accent matches the stored one',
  (await ev(`getComputedStyle(document.documentElement).getPropertyValue('--a').trim()`)).toLowerCase(), String(stored).toLowerCase());
t('text on the accent fill is dark, never white on a pale colour',
  await ev(`(()=>{const fg=getComputedStyle(document.documentElement).getPropertyValue('--aFg').trim();
     return _contrast(fg,getComputedStyle(document.documentElement).getPropertyValue('--a').trim())>=4.5;})()`), true);

// Clearing it has to actually clear it, or "back to default" is a trap.
await ev(`setAccent('',false)`);
await wait(200);
t('clearing goes back to the default, not to a tamed blank',
  await ev(`localStorage.getItem('accent_override')`), null);

// Nonsense in, nothing out — never a half-applied colour.
t('garbage is refused rather than guessed at', await ev(`tameAccent('not a colour')`), '');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
