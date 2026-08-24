// The admin roster shows one row per PERSON, not per device.
// run: node scripts/roster-test.mjs
import {spawn} from 'node:child_process';
const PORT=8797;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prof=(process.env.TMPDIR||'/tmp')+'/wl-roster-test';
const ch=spawn(CHROME,['--headless=new','--remote-debugging-port=9341',`--user-data-dir=${prof}`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run',
  '--disable-background-timer-throttling','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(2500);
const tabs=await (await fetch('http://127.0.0.1:9341/json/list')).json();
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0;const w={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
const cmd=(m,p={})=>new Promise(r=>{const i=++id;w[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails)return{__err:r.result.exceptionDetails.exception?.description};
  return r.result?.result?.value;};
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Emulation.setFocusEmulationEnabled',{enabled:true});

// A roster shaped like the real one: repeat rows for the same people, some with
// a friend code and some (older) without, plus a pending returning device.
const N=Date.now();
const DEVICES=[
 {id:'d1',status:'approved',name:'Faiz Hasan',acct:'a1b2c3d4e5f60718',lastSeen:N-3e5,joinedAt:N-4*864e5},
 {id:'d2',status:'approved',name:'Faiz on iPad',acct:'a1b2c3d4e5f60718',lastSeen:N-9e8,joinedAt:N-30*864e5},
 {id:'d3',status:'approved',name:'Faiz Hasan',acct:'a1b2c3d4e5f60718',lastSeen:N-2e9,joinedAt:N-60*864e5},
 {id:'d4',status:'approved',name:'Brandon',alias:'YBG',fcode:'brandonc0001',lastSeen:N-2e8,joinedAt:N-20*864e5},
 {id:'d5',status:'approved',name:'Brandon',alias:'YBG',lastSeen:N-5e8,joinedAt:N-40*864e5},
 {id:'d6',status:'approved',name:'Ibraahiim',fcode:'ibracode0001',lastSeen:N-4e8,joinedAt:N-13*864e5},
 {id:'d7',status:'approved',name:'Omad',lastSeen:N-9e8,joinedAt:N-19*864e5},
 {id:'d8',status:'pending', name:'Returning device',acct:'a1b2c3d4e5f60718',joinedAt:N-6e4},
 {id:'d9',status:'denied',  name:'Spammer',joinedAt:N-50*864e5},
];
const seed=`
localStorage.setItem('animelist_v4','[{"id":"a","title":"t","status":"watching","kind":"watch"}]');
localStorage.setItem('wl_admin_token','tok');
localStorage.setItem('wt_seen','1');
window.__calls=[];
window.fetch=function(u,o){let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const path=String(u).split('workers.dev')[1]||String(u);
  window.__calls.push(path+(b.deviceId?':'+b.deviceId:''));
  if(path.indexOf('/members')>=0)
    return Promise.resolve(new Response(JSON.stringify({ok:true,approved:7,cap:50,devices:${JSON.stringify(DEVICES)}}),{status:200,headers:{'Content-Type':'application/json'}}));
  return Promise.resolve(new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}}));};
`;
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:seed});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html`});
await wait(4500);

await ev(`(async()=>{renderAdmin();await loadMembers();return 1;})()`);
await wait(600);

let pass=0,fail=0;
const t=(n,g,e2)=>{const o=JSON.stringify(g)===JSON.stringify(e2);o?pass++:fail++;console.log((o?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(o?'':' (want '+JSON.stringify(e2)+')'));};

const names=await ev(`[...document.querySelectorAll('#adminMembers .src-name')].map(e=>e.textContent.trim())`);
console.log('rows shown:', JSON.stringify(names));
t('nine device rows collapse to six people', names.length, 6);
t('one account shows as one person even with different device names', names.filter(n=>n.indexOf('Faiz')>=0).length, 1);
const subs=await ev(`[...document.querySelectorAll('#adminMembers .src-sub')].map(e=>e.textContent.trim())`);
t('his row says how many devices', subs.some(x=>x.indexOf('3 devices')>=0), true);
t('only the multi-device people mention devices', subs.filter(x=>x.indexOf('devices')>=0).length, 2);
const hdr=await ev(`document.querySelector('#adminMembers .dt-label').textContent.trim()`);
console.log('header:', hdr);
t('the header separates people from devices', /Everyone . 6/.test(hdr)&&/9 devices/.test(hdr), true);

// Removing a person must remove every row they hold.
await ev(`window.__calls=[]`);
const btn=await ev(`(()=>{const b=[...document.querySelectorAll('#adminMembers button')].find(x=>x.textContent.indexOf('Remove all 3')>=0);if(!b)return'';b.click();b.click();return b.textContent.trim();})()`);
await wait(700);
const calls=await ev(`window.__calls.filter(c=>c.indexOf('/forget')>=0)`);
t('the button names the whole set', btn, 'Remove all 3');
t('removing Faiz forgets all three of his devices', calls.length, 3);

const tags=await ev(`[...document.querySelectorAll('#adminMembers .src-tag')].map(e=>e.textContent.trim())`);
t('a returning member is flagged as one, not treated as a stranger', tags.some(x=>/Faiz Hasan again/.test(x)), true);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
