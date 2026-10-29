// The two ends of a setup kit, in a real browser: what a kit is allowed to
// carry out of the sender's app, and what opening one does to the recipient's.
//
// The assertion that matters most is the dullest: kitCollect must not pick up
// the sender's cloud code, AI key or identity. collectExtra() — which already
// exists and is exactly this shape — carries all three quite correctly for
// your own backup, so the tempting implementation is also the one that hands
// a stranger the keys to your list. That is what the allow-list is for, and
// this is what stops someone "simplifying" it back.
// run: node scripts/setup-kit-ui-test.mjs
import {spawn} from 'node:child_process';
const PORT=9037,DBG=9577;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-kitui`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){}
  process.exit(1); }
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

// The sender's app: a real list, a cloud code, an AI key, friends, identity.
const SEED=`
localStorage.setItem('animelist_v4',JSON.stringify([{id:'a',title:'A Show',status:'watching',kind:'watch',ep:3,epTotal:12,upd:Date.now()}]));
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('sync_animelist_v4','SENDERSCODE123456789');
localStorage.setItem('anthropic_key','sk-ant-secret');
localStorage.setItem('wl_admin_token','admintoken');
localStorage.setItem('wl_device','sender-device');
localStorage.setItem('friend_code','SENDERFRIEND1');
localStorage.setItem('friend_name','Muhammad');
localStorage.setItem('friends',JSON.stringify([{code:'OTHERFRIEND1',name:'Rin'}]));
localStorage.setItem('animetheme','sasuke');
localStorage.setItem('retro_on','1');
localStorage.setItem('my_services',JSON.stringify([{name:'A site',url:'https://x/{slug}?ep={ep}'}]));
localStorage.setItem('onboarded_animelist_v4','1');
localStorage.setItem('tut_seen_animelist_v4','1');
window.fetch=()=>new Promise(()=>{});`;
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:SEED});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// ── what leaves the sender's app ────────────────────────────────────────────
const kit=await ev(`JSON.stringify(kitCollect({}))`);
const K=JSON.parse(kit||'{}');
const keys=Object.keys(K.look||{});
t('the look travels', [K.look.animetheme,K.look.retro_on], ['sasuke','1']);
t('and the sources with it', !!K.look.my_services, true);
t('the sender is offered as a friend, which is an address not a secret', K.fromCode, 'SENDERFRIEND1');
t('under their name', K.fromName, 'Muhammad');

t('THE CLOUD CODE NEVER TRAVELS', keys.some(k=>/^sync/.test(k)), false);
t('nor the AI key', keys.includes('anthropic_key'), false);
t('nor the admin token', keys.includes('wl_admin_token'), false);
t('nor the device identity', keys.some(k=>k==='wl_device'||k==='friend_code'), false);
t('nor their friends list', keys.includes('friends'), false);
t('nor the list itself', keys.includes('animelist_v4'), false);
t('and the whole payload mentions none of those values',
  /SENDERSCODE123456789|sk-ant-secret|admintoken|sender-device/.test(kit||''), false);

t('the summary is generated from the payload, so it cannot drift',
  (await ev(`JSON.stringify(kitSummary(kitCollect({})))`)).includes('sasuke'), true);

// ── the link is taken out of the address bar ────────────────────────────────
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?kit=abcd1234ef&cb=`+Math.random()});
await wait(3800);
t('the kit id is remembered', await ev(`pendingKit()`), 'abcd1234ef');
t('and taken out of the URL, so it is not handed on by the back button',
  await ev(`location.search.includes('kit=')`), false);

// ── the recipient's app ─────────────────────────────────────────────────────
// A fresh profile with the worker stubbed: one unclaimed kit, then a used one.
const RECIP=`
localStorage.clear();
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('animetheme','default');
window.__claims=0;
window.fetch=function(u,o){
  const url=String(u||'');
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const J=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(url.endsWith('/kit-peek'))return J({ok:true,label:'For you',from:'Muhammad',used:window.__used||false,expired:false});
  if(url.endsWith('/kit-claim')){
    if(window.__used)return J({ok:false,error:'used'});
    window.__claims++;
    return J({ok:true,joined:'approved',aiCap:200,payload:{v:1,look:{animetheme:'zoro',retro_on:'1'},fromCode:'SENDERFRIEND1',fromName:'Muhammad',onboard:true,notify:true}});
  }
  return new Promise(()=>{});
};`;
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:RECIP});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?kit=abcd1234ef&cb=`+Math.random()});
await wait(4600);

const until=async(expr,ms=9000)=>{const t0=Date.now();
  for(;;){const v=await ev(expr);if(v)return v;if(Date.now()-t0>ms)return null;await wait(80);}};
t('the welcome appears', await until(`!!document.querySelector('#kitGate.on')`), true);
t('and names who sent it', /Muhammad set WatchList up for you/.test(await ev(`(document.querySelector('.kit-title')||{}).textContent||''`)), true);
t('nothing is applied before you agree', await ev(`localStorage.getItem('animetheme')`), 'default');
t('and the ordinary welcome is not stacked underneath it',
  await ev(`!document.querySelector('#onb.on')`), true);
t('and nothing has been claimed yet', await ev(`window.__claims`), 0);

await ev(`kitAccept()`);
await wait(1200);
t('accepting applies the look', await ev(`localStorage.getItem('animetheme')`), 'zoro');
t('and paints it', await ev(`document.documentElement.getAttribute('data-theme')`), 'zoro');
t('the sender is in their friends', await ev(`friendsList().some(f=>f.code==='SENDERFRIEND1')`), true);
// NOT "onboarding is marked done". A kit skips the three cards explaining what
// the app is — which is exactly what somebody handed it by a friend does not
// need — and then shows the checklist, because two of its rows are jobs no
// link can do: adding to the Home Screen, which the browser owns and which on
// iPhone is the only way an alert ever arrives, and the notification
// permission, which needs their own tap. Calling those done would mean "fully
// set up" quietly meant no alerts, in a tab.
t('the explaining cards are skipped', await ev(`localStorage.getItem('tut_seen_'+LSKEY)`), '1');
t('but the checklist is shown, not skipped', await until(`!!document.querySelector('#onb.on')`), true);
t('open at the last card, where the jobs are', await ev(`onbIdx===ONB.length-1`), true);
t('with the two it cannot do for them still to do',
  await ev(`JSON.stringify(onbTasks().filter(t=>!t.done).map(t=>t.k).sort())`), '["alerts","backup","install","lock"]');
t('the borrowed AI budget is switched on', await ev(`localStorage.getItem('wl_ai_borrowed')`), '1');
t('the welcome is gone', await ev(`!document.querySelector('#kitGate.on')`), true);
t('and the kit is not left pending', await ev(`pendingKit()`), '');
t('claimed exactly once', await ev(`window.__claims`), 1);

// ── a link somebody forwarded ───────────────────────────────────────────────
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:RECIP+`window.__used=true;`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?kit=abcd1234ef&cb=`+Math.random()});
await wait(4600);
t('a used link says so rather than failing quietly',
  /already been used/.test(await until(`(document.querySelector('.kit-title')||{}).textContent||''`)||''), true);
t('and changes nothing', await ev(`localStorage.getItem('animetheme')`), 'default');
t('and does not keep asking on every open', await ev(`pendingKit()`), '');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
