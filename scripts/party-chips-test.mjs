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
// ── the way IN, which is the half nobody could test ────────────────────────
//
// partyJoin() has always required a name, and the only name field on this screen
// lived inside the "Start a party" panel. So on a device that had never set one --
// every device somebody has just been sent a code on -- typing the code and
// pressing Join answered "Enter a name first" with no field on that half to put
// one in. Three test files covered this screen and all three passed, because none
// of them ever tried to join.
const entry=await ev(`(()=>{try{localStorage.removeItem('party_name');}catch(e){}
  partyCode='';partyJoinErr='';openSheet('partySheet');renderParty();
  return [!!document.getElementById('ptName'),!!document.getElementById('ptJoin')].join(',');})()`);
t('the party screen asks for a name once, for both ways in', entry, 'true,true');

const nameInStart=await ev(`(()=>{const n=document.getElementById('ptName');
  // It must not sit inside something that only belongs to starting a party.
  return !!(n&&n.closest('.pt-start'));})()`);
t('and the field is not buried in the start panel', nameInStart, false);

const refused=await ev(`(()=>{partyJoinErr='';partyTriedCode='';
  document.getElementById('ptName').value='';
  document.getElementById('ptJoin').value='ABC123';partyJoin();
  return partyCode;})()`);
t('a join with no name does not start one either', refused, '');

// A refused join keeps the reason and the code on screen. Both used to go: the
// toast faded and the field was cleared by the re-render, so a mistyped or expired
// code left nothing behind that said what had happened.
const kept=await ev(`(()=>{partyCode='';partyJoinErr='No party with that code.';partyTriedCode='WRONG1';
  renderParty();
  const i=document.getElementById('ptJoin'),e=document.getElementById('ptJoinErr');
  return [i?i.value:'',!!e,!!(i&&i.classList.contains('bad'))].join(',');})()`);
t('a refused code stays on screen with its reason', kept, 'WRONG1,true,true');

const cleared=await ev(`(()=>{const i=document.getElementById('ptJoin');
  i.value='W';i.dispatchEvent(new Event('input'));
  return [i.classList.contains('bad'),!!document.getElementById('ptJoinErr')].join(',');})()`);
t('and clears the moment you start retyping', cleared, 'false,false');

// ── the host pressing Play has to reach everyone ───────────────────────────
//
// playAt is the instant the room starts, set a few seconds ahead so every device
// counts down to the same moment. On the web it is the only thing holding a party
// together, because a page cannot read or move a video on another origin. It was
// being ignored: partyCue() was defined and never called, partySeenPlay was set
// once and never read, and partyFollowHost is only reachable through partyCue.
const cued=await ev(`(()=>{partyCode='Z1';partyIsHost=false;partySeenPlay=0;
  const ov=document.getElementById('partyCount');if(ov)ov.classList.remove('on');
  applyRoom({code:'Z1',host:'someone-else',title:'Frieren',ep:3,animeId:'154587',
    playAt:Date.now()+3600,members:[],chat:[],queue:[]});
  return !!(ov&&ov.classList.contains('on'));})()`);
t('the host pressing play counts everyone in', cued, true);

const once=await ev(`(()=>{const at=partySeenPlay;
  const ov=document.getElementById('partyCount');ov.classList.remove('on');
  // the same room arriving again (a reconnect, a member joining) must not re-cue
  applyRoom({code:'Z1',host:'someone-else',title:'Frieren',ep:3,animeId:'154587',
    playAt:at,members:[{uid:'x',name:'New'}],chat:[],queue:[]});
  return ov.classList.contains('on');})()`);
t('and does not count them in again on the next message', once, false);

const late=await ev(`(()=>{partySeenPlay=0;
  const ov=document.getElementById('partyCount');ov.classList.remove('on');
  // arriving ten minutes into something: the room's playAt is long past
  applyRoom({code:'Z1',host:'someone-else',title:'Frieren',ep:3,animeId:'154587',
    playAt:Date.now()-600000,members:[],chat:[],queue:[]});
  return ov.classList.contains('on');})()`);
t('someone arriving late is not counted into a start that is over', late, false);

// ── somebody else sharing must not take your screen ────────────────────────
//
// A video track arriving used to closeAll() and raise the full-screen overlay on
// the spot, so whatever you were doing was closed under you by an action on
// another person's machine. The panel has had a "Watch the shared screen" button
// the whole time; the takeover just got there first.
const tookOver=await ev(`(()=>{
  const sv=document.getElementById('shareView');sv.classList.remove('on');
  openSheet('partySheet');
  attachShareStream(new MediaStream());
  return {overlay:sv.classList.contains('on'),
          sheet:document.getElementById('partySheet').classList.contains('on')};})()`);
t('a stream arriving does not raise the overlay', JSON.parse(JSON.stringify(tookOver)).overlay, false);
t('and does not close what you were looking at', JSON.parse(JSON.stringify(tookOver)).sheet, true);

const opens=await ev(`(()=>{const sv=document.getElementById('shareView');sv.classList.remove('on');
  reopenShareView();return sv.classList.contains('on');})()`);
t('asking for it still opens it', opens, true);

const stays=await ev(`(()=>{const sv=document.getElementById('shareView');
  sv.classList.add('on');attachShareStream(new MediaStream());
  return sv.classList.contains('on');})()`);
t('a new stream while watching does not drop you out', stays, true);

// ── a shared screen keeps its own shape ────────────────────────────────────
//
// fitShare() used to turn the picture a quarter turn by itself whenever the area
// would grow by a third. Nothing is stretched by that and the arithmetic is right,
// but the picture arrives on its side and the way back was a pill that faded after
// seven seconds. Upright and letterboxed is the default; the turn is offered.
const shaped=await ev(`(async()=>{
  const c=document.createElement('canvas');c.width=1280;c.height=720;
  const x=c.getContext('2d');x.fillStyle='#123';x.fillRect(0,0,1280,720);
  const v=document.getElementById('shareVideo');v.muted=true;v.setAttribute('playsinline','');
  partyCode='Z1';partyRoom={title:'T',code:'Z1'};
  attachShareStream(c.captureStream(30));reopenShareView();
  try{await v.play();}catch(e){}
  for(let i=0;i<60&&!v.videoWidth;i++)await new Promise(r=>setTimeout(r,50));
  // The test browser's window is landscape, where a 16:9 picture has no area to
  // gain and the turn is correctly never offered. The case worth pinning is a
  // phone held upright, so give the stage that shape.
  const st=document.querySelector('#shareView .sh-stage');
  st.style.width='400px';st.style.height='880px';st.style.inset='auto';
  fitShare();
  return v.videoWidth+'x'+v.videoHeight+'|rot='+v.classList.contains('sh-rot');})()`);
t('a 16:9 screen is not turned on its own', shaped, '1280x720|rot=false');

const offered=await ev(`(()=>{const b=document.getElementById('shRotBtn');
  return b?b.textContent.trim():'(no offer)';})()`);
t('the turn is offered instead', offered, 'Turn it to fill your screen');

const turned=await ev(`(()=>{document.getElementById('shRotBtn').click();
  const v=document.getElementById('shareVideo');
  return v.classList.contains('sh-rot')+'|'+document.getElementById('shRotBtn').textContent.trim();})()`);
t('tapping it turns the picture, and says how to undo', turned, 'true|Turned · tap to put it upright');

const back=await ev(`(()=>{document.getElementById('shRotBtn').click();
  const v=document.getElementById('shareVideo');
  return v.classList.contains('sh-rot')+'|'+(v.style.getPropertyValue('--rot-w')||'(cleared)');})()`);
t('and tapping again puts it upright', back, 'false|(cleared)');

// ── a party of one has exactly one job ─────────────────────────────────────
//
// The invite code used to be second from the bottom: under the chat nobody is in
// yet and under a row of controls for things you cannot do alone. The moment you
// start a party, the code is the only thing that matters.
// Built by concatenation, not a nested template: a `${p}` inside a template that is
// itself inside a template reaches the page as the literal characters and the browser
// answers with a SyntaxError that looks like a bug in the app.
const order=p=>"(()=>{partyCode='Z9';partyIsHost=true;"+
  "applyRoom({code:'Z9',host:partyUid(),title:'',ep:0,members:"+p+",chat:[],queue:[],reacts:[]});"+
  "renderParty();"+
  "const box=document.getElementById('partyBody');"+
  "const inv=box.querySelector('.pt-invite'),chat=document.getElementById('ptChat');"+
  "if(!inv||!chat)return 'missing';"+
  "return (inv.compareDocumentPosition(chat)&Node.DOCUMENT_POSITION_FOLLOWING)?'invite first':'chat first';})()";

const solo=await ev(order("[{uid:partyUid(),name:'Me'}]"));
t('on your own, the code comes before the chat', solo, 'invite first');

const soloSays=await ev(`(()=>!!document.querySelector('.pt-alone'))()`);
t('and says why it is there', soloSays, true);

const two=await ev(order("[{uid:partyUid(),name:'Me'},{uid:'b',name:'Yasso'}]"));
t('once somebody is here it goes back below', two, 'chat first');

const twoQuiet=await ev(`(()=>!!document.querySelector('.pt-alone'))()`);
t('and stops saying nobody is here', twoQuiet, false);

// ── ending is not leaving ──────────────────────────────────────────────────
//
// One button did both, on one tap, from a row styled like any other option. A guest
// pressing it loses nothing -- the party carries on and the code still works. A host
// pressing it closes the party for everyone and kills the code.
const guestOut=await ev(`(()=>{partyCode='Z9';partyIsHost=false;
  partyRoom={code:'Z9',host:'other',members:[{uid:'other',name:'H'},{uid:partyUid(),name:'Me'}]};
  partyLeaveOrEnd();
  const box=document.getElementById('confirmBox');
  return {asked:!!(box&&box.classList.contains('on')),code:partyCode};})()`);
t('a guest leaving is not asked to confirm', JSON.parse(JSON.stringify(guestOut)).asked, false);
t('and is out of the party', JSON.parse(JSON.stringify(guestOut)).code, '');

const hostAsked=await ev(`(()=>{partyCode='Z9';partyIsHost=true;
  partyRoom={code:'Z9',host:partyUid(),members:[{uid:partyUid(),name:'Me'},{uid:'b',name:'Yasso'},{uid:'c',name:'Huz'}]};
  partyLeaveOrEnd();
  const box=document.getElementById('confirmBox');
  return (box&&box.classList.contains('on'))?document.getElementById('confirmMsg').textContent:'(not asked)';})()`);
t('a host is told who it ends it for', hostAsked,
  '2 other people are watching with you. Ending it closes the party for them too, and the code stops working.');

const stillOn=await ev(`partyCode`);
t('and nothing has ended while the question is open', stillOn, 'Z9');

const alone=await ev(`(()=>{document.getElementById('confirmBox').classList.remove('on');
  partyCode='Z9';partyIsHost=true;partyRoom={code:'Z9',host:partyUid(),members:[{uid:partyUid(),name:'Me'}]};
  partyLeaveOrEnd();return document.getElementById('confirmMsg').textContent;})()`);
t('and told what it costs even with nobody there', alone,
  'The code stops working, so anyone you have sent it to will not be able to get in.');

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
