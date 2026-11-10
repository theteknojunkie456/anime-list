// A restore must not hand this machine the identity of the machine the file
// came from, and a device that already holds somebody else's identity has to be
// able to get out of it on its own.
// run: node scripts/device-identity-test.mjs
import {spawn} from 'node:child_process';
const PORT=8971,DBG=9571;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-devid`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let i=0;i<120;i++){await wait(500);try{tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json();if(tabs&&tabs.length)break;}catch(e){tabs=null;}}
if(!tabs||!tabs.length){console.log('could not reach the test browser');try{srv.kill();ch.kill();}catch(e){}process.exit(1);}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('no connect')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
let id=0;const w={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const bail=t=>{console.log(t);try{srv.kill();ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>(await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true})).result?.result?.value;
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[]');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('wl_device','dTHISMACHINE');
window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4000);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(52)+String(g)+(ok?'':'  (want '+e+')'));};

// ── a restored copy brings everything except who the machine is ─────────────
const after=await ev(`(async()=>{
  const creds=JSON.stringify({at:Date.now(),v:{friend_code:'fc1',wl_device:'dOTHERMACHINE'}});
  await fullCopyWrite({local:{animelist_v4:'[]',wl_device:'dOTHERMACHINE',theme:'naruto'},
                       media:{__creds__:creds}});
  const back=await idbGet('__creds__');
  return {id:localStorage.getItem('wl_device'),
          theme:localStorage.getItem('theme'),
          credHasId:/wl_device/.test(back||''),
          credKeptFriend:/fc1/.test(back||'')};})()`);
t('the restore does not take the other machine’s id', after.id, null);
t('and it is not smuggled in through the creds blob', after.credHasId, false);
t('the rest of the credentials still come back', after.credKeptFriend, true);
t('and so does everything else in the file', after.theme, 'naruto');
// Absent, not blank: wlDevice() mints only when the key is missing, so an empty
// string here would leave the machine with no identity at all rather than a new one.
const minted=await ev(`(()=>{const a=wlDevice();return {fresh:a!=='dOTHERMACHINE'&&a!=='dTHISMACHINE',stable:a===wlDevice()};})()`);
t('a fresh id is minted on the next ask', minted.fresh, true);
t('and then it stays put', minted.stable, true);

// ── a machine already wearing another one's identity gets itself out ────────
const heal=await ev(`(async()=>{
  localStorage.setItem('wl_device','dSHARED');
  localStorage.setItem('sync_animelist_v4','TESTCODE1234567890AB');
  const label=deviceLabel();
  // the roster says the row carrying MY id was last written by someone else
  window.syncDevices=async()=>({ok:true,devices:[{id:'dSHARED',name:label+' (other)',at:Date.now(),n:9}]});
  const did=await healDeviceClash();
  const now=localStorage.getItem('wl_device');
  // and the opposite case: the row is mine, so nothing should move
  localStorage.setItem('wl_device','dMINE');
  window.syncDevices=async()=>({ok:true,devices:[{id:'dMINE',name:label,at:Date.now(),n:9}]});
  const did2=await healDeviceClash();
  return {did,changed:now!=='dSHARED',did2,still:localStorage.getItem('wl_device')};})()`);
t('a shared identity is noticed', heal.did, true);
t('and the device takes a new one', heal.changed, true);
t('its own row is left alone', heal.did2, false);
t('and the id with it', heal.still, 'dMINE');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
