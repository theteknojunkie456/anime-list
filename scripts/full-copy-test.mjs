// A copy of EVERYTHING is the opposite of a sync bundle, and the two must not
// drift into each other. syncSkip() refuses the keys that are facts about one
// machine — that refusal is what stopped his list reverting — so the cloud copy
// is deliberately not a copy of a device. This one has to take the lot,
// including every key sync refuses, or an empty install cannot come back as the
// device it was.
// run: node scripts/full-copy-test.mjs
import {spawn} from 'node:child_process';
const PORT=9001,DBG=9649;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-full`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let i=0;i<120;i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){} process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('the test browser refused the connection'));};});
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
// A device with something of everything on it: a list, people, recommendations,
// sources, a look, and the private notes that must never travel but must be in
// the copy.
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a',title:'Monster',status:'finished',kind:'watch',ep:74,epTotal:74,rating:9,upd:Date.now()},
 {id:'b',title:'Vinland Saga',status:'watching',kind:'watch',ep:3,epTotal:24,upd:Date.now()}]));
localStorage.setItem('sync_animelist_v4','ABCDEFGHIJKLMNOPQRST');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('friends',JSON.stringify([{code:'AB12CD',name:'A friend'}]));
localStorage.setItem('friend_code','ZZ99YY');
localStorage.setItem('recs_in',JSON.stringify([{id:'r1',title:'Mushishi'}]));
localStorage.setItem('recs_passed',JSON.stringify(['r9']));
localStorage.setItem('my_services',JSON.stringify(['example.com']));
localStorage.setItem('animetheme','naruto');
localStorage.setItem('bg_bright','40');
localStorage.setItem('wl_tombs',JSON.stringify({gone:Date.now()}));
// the private ones — refused by sync on purpose, required here on purpose
localStorage.setItem('wl_device','thisdevice1234');
localStorage.setItem('wl_adopt_seen','1762200000000');
localStorage.setItem('wl_prepush_backup','{"mine":1}');
localStorage.setItem('ext_watch','{"id":"b","ep":4,"t":1,"s":""}');
localStorage.setItem('src_draft','half typed source');
window.fetch=function(){return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}}));};
`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4500);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(60)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// artwork lives in IndexedDB, not localStorage, so the copy has to go and get it
await ev(`idbSet('a:img','data:image/png;base64,AAAA')`);

const copy=await ev(`(async()=>{const o=await fullCopyRead();
  return {kind:o.kind,keys:Object.keys(o.local).length===localStorage.length,
          // Object.keys(localStorage) is the wrong list to compare against: the app
          // shadows setItem with its own function to schedule a push, and that
          // shadow is an own property while not being a stored key. Ask the
          // store itself what it holds.
          missing:(()=>{const out=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!(k in o.local))out.push(k);}return out;})(),
          titles:o.counts.titles,images:o.counts.images,
          img:o.media['a:img'],imagesAgree:o.counts.images===Object.keys(o.media).length,
          privates:['wl_device','wl_adopt_seen','wl_prepush_backup','ext_watch','src_draft','sync_animelist_v4']
                    .filter(k=>!(k in o.local))};})()`);
t('the copy says what it is', copy.kind, 'watchlist-everything');
t('it holds every key the device holds', copy.keys, true);
t('…with none missing', copy.missing, []);
t('it holds the keys the cloud refuses to carry', copy.privates, []);
t('it counts the titles it found', copy.titles, 2);
t('it goes and gets the artwork out of IndexedDB', copy.img, 'data:image/png;base64,AAAA');
t('…and the count it reports is the artwork it actually carries', copy.imagesAgree, true);

// ── the whole point: an empty device, put back ──────────────────────────────
const back=await ev(`(async()=>{
  const before=await fullCopyRead();
  const was={};for(const k in before.local)was[k]=before.local[k];
  // wipe it the way he would: nothing left at all
  localStorage.clear();
  for(const k of await idbKeys())await idbDel(k);
  const empty={keys:localStorage.length,imgs:(await idbKeys()).length};
  await fullCopyWrite(before);
  const now={};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);now[k]=localStorage.getItem(k);}
  const differ=Object.keys(was).filter(k=>now[k]!==was[k]);
  return {empty,count:Object.keys(now).length===Object.keys(was).length,differ,
          img:await idbGet('a:img'),
          list:JSON.parse(now['animelist_v4']||'[]').map(x=>x.title).sort(),
          code:now['sync_animelist_v4'],device:now['wl_device'],seen:now['wl_adopt_seen'],
          wasKeys:JSON.stringify(was),nowKeys:JSON.stringify(now)};})()`);
t('the device really was emptied first', back.empty, {keys:0,imgs:0});
// Everything comes back EXCEPT the device's identity, which is the one thing in
// the file that must not: restoring it makes this machine claim to be the
// machine the file came from, the cloud keeps one backup per device, and the
// two then overwrite each other instead of merging. See fullCopyWrite.
t('everything comes back but the identity', back.count, false);
t('…and the identity is the only thing missing',
  Object.keys(JSON.parse(back.wasKeys)).filter(k=>!(k in JSON.parse(back.nowKeys))), ['wl_device']);
t('…with every other value identical', back.differ.filter(k=>k!=='wl_device'), []);
t('the list is the list', back.list, ['Monster','Vinland Saga']);
t('the cloud key comes back', back.code, 'ABCDEFGHIJKLMNOPQRST');
// Absent rather than blank: wlDevice() mints only when the key is MISSING, so
// an empty string would leave the machine with no identity instead of a new one.
t('the restored machine does not take the other one\u2019s identity', back.device, undefined);
t('…and mints one of its own when next asked',
  await ev(`(()=>{const d=wlDevice();return !!d&&d!=='thisdevice1234';})()`), true);
t('…including which decisions it had already applied', back.seen, '1762200000000');
t('and the artwork is back', back.img, 'data:image/png;base64,AAAA');

// ── a file that is not one of these must not touch anything ─────────────────
t('a file that is not a copy of a device changes nothing',
  await ev(`(async()=>{const n=localStorage.length;
    const f=new File([JSON.stringify({kind:'something-else',local:{a:'1'}})],'x.json',{type:'application/json'});
    await fullCopyChosen({files:[f],value:''});
    return localStorage.length===n && _fullPending===null;})()`), true);
t('and neither does one with nothing in it',
  await ev(`(async()=>{const n=localStorage.length;
    const f=new File([JSON.stringify({kind:'watchlist-everything',local:{}})],'x.json',{type:'application/json'});
    await fullCopyChosen({files:[f],value:''});
    return localStorage.length===n && _fullPending===null;})()`), true);

// ── only his panel offers it ────────────────────────────────────────────────
t('the panel that offers it is the one that needs the token',
  await ev(`(()=>{setAdminToken('');renderAdmin();
    const shown=!!document.querySelector('#adminBody #fullCopyFile');
    setAdminToken('t');renderAdmin();
    const now=!!document.querySelector('#adminBody #fullCopyFile');
    setAdminToken('');
    return {locked:shown,unlocked:now};})()`), {locked:false,unlocked:true});

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
