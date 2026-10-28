// A raised hand and a talking marker on the party's member chips.
// run: node scripts/party-chips-test.mjs
import {spawn} from 'node:child_process';
const PORT=8935,DBG=9475;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-chips`,
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
// onopen alone never fires if the socket errors or closes instead, which is the
// same infinite wait one line earlier.
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('the test browser refused the connection'));};});
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
// A command the browser never answers makes this promise wait forever, and
// every poll in the file is built on it — so one stalled socket is not a slow
// test, it is a test that never ends. Deadline, then say which command died.
const _bail=(why)=>{console.log(why);try{srv&&srv.kill();}catch(e){}try{ch&&ch.kill();}catch(e){}process.exit(1);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;
  const k=setTimeout(()=>{if(w[i]){delete w[i];_bail('the test browser stopped answering ('+m+')');}},45000);
  w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4','[{"id":"a1","title":"Monster","status":"watching","kind":"watch","ep":3,"epTotal":74,"aniId":19}]');
localStorage.setItem('wl_net_status','approved');localStorage.setItem('party_name','Muhammad');
localStorage.setItem('party_uid','uidH');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const seed=`partyCode='K3P9M2';partyIsHost=true;partyInSession=true;
  partyRoom={code:'K3P9M2',host:'uidH',title:'Monster',animeId:'a1',ep:3,img:'',playAt:0,paused:true,sharing:'',
   queue:[],voice:[],reacts:[],chat:[],rev:1,
   members:[{uid:'uidH',name:'Muhammad',ready:true,wait:false,hand:false},
            {uid:'uidA',name:'huzi',ready:false,wait:false,hand:true},
            {uid:'uidB',name:'Yasso',ready:true,wait:false,hand:false}]};`;

t('there is a hand icon', await ev(`!!ICONS.hand`), true);
t('and a speech icon', await ev(`!!ICONS.speech`), true);

const hands=await ev(`(()=>{${seed}
  openSheet('partySheet');renderParty();
  const chips=[...document.querySelectorAll('.pt-chip')];
  return chips.map(c=>({who:(c.querySelector('.pt-chip-n')||{}).textContent,
                        hand:!!c.querySelector('.pt-flag.hand'),
                        talk:!!c.querySelector('.pt-flag.talk')}));})()`);
console.log('    chips:', JSON.stringify(hands));
t('a raised hand shows on that person only', hands.filter(c=>c.hand).length, 1);
t('and on the right person', (hands.find(c=>c.hand)||{}).who, 'huzi');
t('nobody is talking yet', hands.filter(c=>c.talk).length, 0);

const talking=await ev(`(()=>{_callSpeaker='jitsi-77';_callNames={'jitsi-77':'Yasso'};renderParty();
  const chips=[...document.querySelectorAll('.pt-chip')];
  return chips.map(c=>({who:(c.querySelector('.pt-chip-n')||{}).textContent,talk:!!c.querySelector('.pt-flag.talk')}));})()`);
console.log('    talking:', JSON.stringify(talking));
t('the speaker gets a speech marker', (talking.find(c=>c.talk)||{}).who, 'Yasso');
t('and only them', talking.filter(c=>c.talk).length, 1);

const gone=await ev(`(()=>{_callSpeaker='';renderParty();return document.querySelectorAll('.pt-flag.talk').length;})()`);
t('it clears when they stop', gone, 0);

const nameMatch=await ev(`(()=>{_callSpeaker='x';_callNames={'x':'  HUZI '};renderParty();
  const c=[...document.querySelectorAll('.pt-chip')].find(c=>/huzi/i.test(c.textContent));
  return !!(c&&c.querySelector('.pt-flag.talk'));})()`);
t('matching a name survives case and spacing', nameMatch, true);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
