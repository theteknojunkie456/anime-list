// Every cover has to pixelate to the SAME block size, whatever resolution its
// art happened to arrive at. run: node scripts/pixel-consistency-test.mjs
import {spawn} from 'node:child_process';
const PORT=8957,DBG=9497;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-px2`,
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
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('animetheme','retro');localStorage.setItem('retro_on','1');
window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// the whole bug: two covers, same card, wildly different source resolutions
const same=await ev(`(()=>{
  const el={clientWidth:200,getBoundingClientRect:()=>({width:200})};
  const small=pxCells(el,pxBlock(),100,142);     // the medium file
  const big  =pxCells(el,pxBlock(),460,653);     // the extraLarge file
  return {small,big};})()`);
console.log('    same card, two sources:', JSON.stringify(same));
t('a small source and a large one get the same blocks', same.small.w===same.big.w, true);
t('and the same height in blocks', same.small.h===same.big.h, true);

t('a wider card gets proportionally more blocks, so the block stays one size',
  await ev(`(()=>{const mk=w=>({clientWidth:w,getBoundingClientRect:()=>({width:w})});
    const a=pxCells(mk(200),3,460,653).w, b=pxCells(mk(400),3,460,653).w;
    return Math.abs(b-a*2)<=1;})()`), true);   // rounding, not doubling exactly

t('an unlaid-out element still gets a sane count',
  await ev(`pxCells({clientWidth:0,getBoundingClientRect:()=>({width:0})},3,460,653).w`), 67);
t('and it never drops below a picture',
  await ev(`pxCells({clientWidth:8,getBoundingClientRect:()=>({width:8})},3,460,653).w`), 16);

// the setting is real again
t('the coarseness setting is read back',
  await ev(`(()=>{setRetroBits('8');const a=retroBits();setRetroBits('64');const b=retroBits();
    setRetroBits('16');return [a,b,retroBits()];})()`), ['8','64','16']);
t('and each level is a different block size',
  await ev(`(()=>{const o={};['8','16','64'].forEach(v=>{setRetroBits(v);o[v]=pxBlock();});setRetroBits('16');return o;})()`),
  {'8':6,'16':3,'64':2});
t('off resamples nothing',
  await ev(`(()=>{setRetroBits('off');const n=pxBlock();setRetroBits('16');return n;})()`), 0);
t('the default is the middle, not the coarsest',
  await ev(`(()=>{localStorage.removeItem('retro_bits');return retroBits();})()`), '16');
t('and the document carries it for the CSS',
  await ev(`(()=>{setRetroBits('64');applyRetroMode();
    const v=document.documentElement.getAttribute('data-bits');setRetroBits('16');return v;})()`), '64');

// uploaded art is no longer skipped
t('a data: cover is not passed over',
  await ev(`typeof pxCanvasFallback==='function' && /data:/.test(pxOne.toString())`), true);
t('and the URL is no longer downgraded to the small file',
  await ev(`pxSrc('https://s4.anilist.co/file/anilistcdn/media/anime/cover/extraLarge/bx1-x.jpg')`),
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/extraLarge/bx1-x.jpg');
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
