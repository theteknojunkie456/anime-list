// A friend's recommendation whose cover had not arrived yet rendered as a flat
// var(--bg4) rectangle with a coloured outline and a dismiss button floating in
// it. That does not read as "loading", it reads as broken, and that is how it
// was reported. The cover is also the one friend-supplied image in the app that
// skipped safeImg — the helper whose own comment names friend recommendations
// as the reason it exists.
// run: node scripts/rec-card-test.mjs
import {spawn} from 'node:child_process';
const PORT=9003,DBG=9549;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-reccard`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(4000);
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
sessionStorage.setItem('wl_booted','1');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4000);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(58)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};
const card=(title,img)=>`recCard('k',{item:{title:${JSON.stringify(title)},img:${JSON.stringify(img)},aniId:0},senders:[{code:'AAAAAAAAAA',name:'Rin'}]})`;

// ── a cover still in flight is a poster, not a hole ────────────────────────
t('an unloaded cover still draws the title’s initial',
  await ev(`(()=>{const d=document.createElement('div');d.innerHTML=${card('Berserk','https://example.com/x.jpg')};
    const ph=d.querySelector('.rec-ph');return ph?ph.textContent:null;})()`), 'B');
t('and the cover starts hidden, over the top of it',
  await ev(`(()=>{const d=document.createElement('div');d.innerHTML=${card('Berserk','https://example.com/x.jpg')};
    const i=d.querySelector('.rec-img');return {hasImg:!!i,litUp:i?i.classList.contains('on'):null};})()`),
  {hasImg:true,litUp:false});
t('a recommendation with no cover at all draws the same tile',
  await ev(`(()=>{const d=document.createElement('div');d.innerHTML=${card('Mushishi','')};
    return {ph:(d.querySelector('.rec-ph')||{}).textContent,img:!!d.querySelector('.rec-img')};})()`),
  {ph:'M',img:false});
t('both layers are anchored to the same box',
  await ev(`(()=>{const h=document.createElement('div');h.style.cssText='position:fixed;left:0;top:0;width:900px';
    h.innerHTML=${card('Frieren','https://example.com/x.jpg')};document.body.appendChild(h);
    const w=h.querySelector('.rec-wrap').getBoundingClientRect(),
          p=h.querySelector('.rec-ph').getBoundingClientRect(),
          i=h.querySelector('.rec-img').getBoundingClientRect();
    h.remove();
    return {sized:w.width>40&&w.height>40,
            same:Math.abs(p.width-i.width)<1&&Math.abs(p.height-i.height)<1&&Math.abs(p.width-w.width)<1};})()`),
  {sized:true,same:true});
t('a cover that 404s leaves the tile behind, not a hole',
  await ev(`(async()=>{const h=document.createElement('div');h.style.cssText='position:fixed;left:0;top:0;width:900px';
    h.innerHTML=${card('Dandadan','http://localhost:'+PORT+'/__missing__.jpg')};document.body.appendChild(h);
    await new Promise(r=>setTimeout(r,900));
    const out={img:!!h.querySelector('.rec-img'),ph:(h.querySelector('.rec-ph')||{}).textContent};
    h.remove();return out;})()`), {img:false,ph:'D'});
t('a cover that loads is revealed',
  await ev(`(async()=>{const u='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="6" height="9"><rect width="6" height="9" fill="#357"/></svg>');
    const h=document.createElement('div');h.style.cssText='position:fixed;left:0;top:0;width:900px';
    h.innerHTML=recCard('k',{item:{title:'Frieren',img:u,aniId:0},senders:[{code:'AAAAAAAAAA',name:'Rin'}]});
    document.body.appendChild(h);await new Promise(r=>setTimeout(r,700));
    const on=h.querySelector('.rec-img').classList.contains('on');h.remove();return on;})()`), true);

// ── the cover comes from another person, so it goes through safeImg ────────
// Stated as what it is, not as what the name first claimed: safeImg gates the
// SCHEME and the breakout characters, not the host. Any https URL a friend sends
// is loaded, because real covers come from arbitrary CDNs and there is no
// allowlist that would not break them. The cost is that a sender can tell when
// you looked — worth knowing, not worth breaking every cover over.
t('any https cover from a friend is loaded, host unchecked',
  await ev(`(()=>{const d=document.createElement('div');d.innerHTML=${card('X','https://tracker.example.com/beacon?u=me')};
    const i=d.querySelector('.rec-img');return i?i.getAttribute('src'):'(none)';})()`),
  'https://tracker.example.com/beacon?u=me');
t('a javascript: cover is refused',
  await ev(`(()=>{const d=document.createElement('div');d.innerHTML=${card('X','javascript:alert(1)')};
    return !!d.querySelector('.rec-img');})()`), false);
t('a cover carrying a quote cannot break out of the attribute',
  await ev(`(()=>{const d=document.createElement('div');d.innerHTML=${card('X','https://e.com/a.jpg" onerror="window.__pwned=1')};
    return {img:!!d.querySelector('.rec-img'),pwned:!!window.__pwned};})()`), {img:false,pwned:false});
t('and the title is still escaped',
  await ev(`(()=>{const d=document.createElement('div');d.innerHTML=${card('<img src=x onerror=window.__t=1>','')};
    document.body.appendChild(d);const bad=!!window.__t;d.remove();return bad;})()`), false);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
