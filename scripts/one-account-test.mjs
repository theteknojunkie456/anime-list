// One person, one cloud key. A device that quietly invents its own splits an
// account in two and says nothing. run: node scripts/one-account-test.mjs
import {spawn} from 'node:child_process';
const PORT=8939,DBG=9479;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-key`,
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
localStorage.setItem('animelist_v4','[{"id":"a1","title":"Monster","status":"watching","kind":"watch","ep":3,"epTotal":74,"aniId":19}]');
localStorage.setItem('wl_net_status','approved');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};
const banner=async setup=>ev(`(()=>{${setup};renderSync?renderSync():render();
  const n=document.querySelector('.nudge-t');return n?n.textContent.trim():'(none)';})()`);

// a device that invented its own key, with friends → it has probably split an account
await ev(`(()=>{try{localStorage.removeItem('codeseen_'+LSKEY);}catch(e){}
  setSyncCode(''); localStorage.removeItem(KEY_SELF); ensureBackup(); return 1;})()`);
t('a device with a list mints a key on its own', await ev(`!!syncCode()`), true);
t('and records that it invented it', await ev(`keySelfMade()`), true);

t('with no friends it just says to save the code',
  (await banner(`localStorage.setItem('friends','[]')`)).slice(0,26), 'Your list is backed up. Sa');
t('with friends it names the split instead',
  /already have one/.test(await banner(`localStorage.setItem('friends','[{"code":"bbbbbbbbbb2","name":"Rin"}]')`)), true);

// the backup sheet must say what switching costs
const sheet=await ev(`(()=>{renderSyncUI&&renderSyncUI();
  const b=document.getElementById('syncBox')||document.body;
  return b.textContent||'';})()`);
t('the backup screen warns the local list is not merged', /not merged in/.test(sheet), true);
t('and counts what would be lost', /has 1 of its own/.test(sheet), true);

// entering somebody's key means this device joined rather than started
await ev(`clearKeySelf()`);
t('entering a key clears the "I invented this" mark', await ev(`keySelfMade()`), false);
t('and the banner goes back to normal',
  (await banner(``)).slice(0,26), 'Your list is backed up. Sa');
t('the mark never syncs to another device', await ev(`syncSkip(KEY_SELF)`), true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
