// Retro pixelation, against two hosts: one that sends CORS headers and one that
// refuses. Both covers must end up pixelated — a crisp cover in a grid of
// blocky ones is the feature looking broken on exactly the images it could not
// reach. run: node scripts/pixelate-test.mjs
// Two covers: one host sends CORS headers, one refuses. Retro must pixelate both.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import zlib from 'node:zlib';
import {Buffer as B} from 'node:buffer';
// a real PNG, built here so the test carries its own fixture
const PNG=(()=>{
  const w=48,h=68,rows=[];
  for(let y=0;y<h;y++){
    const r=B.alloc(1+w*3);
    for(let x=0;x<w;x++){r[1+x*3]=(x*9)%256;r[2+x*3]=(y*7)%256;r[3+x*3]=120;}
    rows.push(r);
  }
  const chunk=(t,d)=>{
    const len=B.alloc(4);len.writeUInt32BE(d.length);
    const tb=B.from(t), crc=B.alloc(4);
    crc.writeUInt32BE(zlib.crc32(B.concat([tb,d]))>>>0);
    return B.concat([len,tb,d,crc]);
  };
  const ihdr=B.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  return B.concat([B.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(B.concat(rows))),chunk('IEND',B.alloc(0))]);
})();
const img=createServer((req,res)=>{
  const cors=req.url.indexOf('/cors/')===0;
  const h={'Content-Type':'image/png','Cache-Control':'no-store'};
  if(cors)h['Access-Control-Allow-Origin']='*';
  res.writeHead(200,h); res.end(PNG);
});
await new Promise(r=>img.listen(8931,r));
const PORT=8929,DBG=9471;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-px`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1','--no-first-run','about:blank'],{stdio:'ignore'});
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
 {id:'a1',title:'Allows CORS',status:'plan',kind:'watch',ep:0,epTotal:12,aniId:1,img:'http://127.0.0.1:8931/cors/a.png'},
 {id:'a2',title:'Refuses CORS',status:'plan',kind:'watch',ep:0,epTotal:12,aniId:2,img:'http://127.0.0.1:8931/nocors/b.png'}]));
localStorage.setItem('wl_net_status','approved');localStorage.setItem('retro_mode','1');
localStorage.setItem('wt_seen','1');localStorage.setItem('codeseen_animelist_v4','1');`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4500);
const r=await ev(`(async()=>{
  document.documentElement.setAttribute('data-retro','1');
  document.documentElement.setAttribute('data-bits',retroBits());
  try{renderSync?renderSync():render();}catch(e){}
  pixelateCovers();
  await new Promise(r=>setTimeout(r,2500));
  window.__dbg={retro:retroMode(),block:pxBlock(),
    imgs:document.querySelectorAll(PX_ART.map(c=>'img'+c).join(',')).length,
    unmarked:document.querySelectorAll(PX_ART.map(c=>'img'+c+':not([data-pxd])').join(',')).length,
    srcs:[...document.querySelectorAll('img.pcard-img')].map(i=>(i.getAttribute('src')||'').slice(0,44)),
    marked:[...document.querySelectorAll('img.pcard-img')].map(i=>i.dataset.pxd||'-')};
  const cards=[...document.querySelectorAll('.pcard')];
  const out=cards.map(card=>{
    const t=(card.querySelector('.pcard-title')||{}).textContent||'?';
    const im=card.querySelector('img.pcard-img');
    const cv=card.querySelector('canvas.pcard-img');
    return {title:t.trim(),
            viaDataUrl:!!(im&&(im.getAttribute('src')||'').slice(0,5)==='data:'),
            viaCanvas:!!cv,
            imgHidden:!!(im&&im.style.display==='none')};
  });
  return out;})()`);
console.log('debug:', JSON.stringify(await ev('window.__dbg')));
console.log(JSON.stringify(r,null,1));
let pass=0,fail=0;
const t=(n,c)=>{c?pass++:fail++;console.log((c?'ok  ':'FAIL')+'  '+n);};
const cors=(r||[]).find(x=>/Allows/.test(x.title))||{}, no=(r||[]).find(x=>/Refuses/.test(x.title))||{};
t('a CORS-friendly cover pixelates the fast way (data URL)', cors.viaDataUrl===true);
t('a CORS-refusing cover still pixelates (canvas stand-in)', no.viaCanvas===true);
t('and its original image is hidden behind the stand-in', no.imgHidden===true);
// turning retro off must put both back
const back=await ev(`(async()=>{pxRestore();await new Promise(r=>setTimeout(r,300));
  return {canvases:document.querySelectorAll('canvas[data-pxc="1"]').length,
          hidden:document.querySelectorAll('img[data-px-hidden="1"]').length};})()`);
t('turning pixels off removes every stand-in', back.canvases===0&&back.hidden===0);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();img.close();process.exit(fail?1:0);
