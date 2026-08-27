// A raised hand and a talking marker on the party's member chips.
// run: node scripts/party-chips-test.mjs
import {spawn} from 'node:child_process';
const PORT=8935,DBG=9475;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-hand`,
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
