// Coming back with your cloud key on a device that has been wiped.
//
// This never worked. The server learns your cloud code from the /join body, and
// the only moments it saw one were the first probe and the join form — both of
// which happen before you are inside the app, and cloud backup is set up inside
// the app. So idn:<code> was written for nobody, and every returning device was
// told its own key was "not on this network yet".
// run: node cloud/rejoin.test.mjs
import assert from 'node:assert';
import worker from './notify-worker.js';

const OLD='dev-old-phone', NEW='dev-new-phone', SYNC='EF3N8VL4CW2AHVM3P3JY';

function mkEnv(){
  const e={ reads:0, writes:0, sent:[],
    SUBS:{ map:new Map(),
      async get(k){e.reads++;return this.map.get(k);},
      async put(k,v){e.writes++;this.map.set(k,v);},
      async delete(k){this.map.delete(k);},
      async list(o){const p=(o&&o.prefix)||'';return {keys:[...this.map.keys()].filter(k=>k.startsWith(p)).map(name=>({name})),list_complete:true};},
    },
    ADMIN_TOKEN:'t0ken', CAP:'50',
  };
  return e;
}
const call=(env,path,body)=>worker.fetch(new Request('https://n'+path,{method:'POST',body:JSON.stringify(body)}),env,{waitUntil:p=>p});
const j=r=>r.json();

let n=0; const ok=m=>{n++;console.log('ok  '+m);};

// Set the scene: an approved device that later turns on cloud backup.
async function approvedDevice(env){
  await call(env,'/join',{deviceId:OLD,name:'Faiz Hasan'});                    // joins, no backup yet
  const rec=JSON.parse(env.SUBS.map.get('dev:'+OLD)); rec.status='approved';
  env.SUBS.map.set('dev:'+OLD,JSON.stringify(rec));
}

// ── the bug, stated as a test ──────────────────────────────────────────────
{
  const env=mkEnv(); await approvedDevice(env);
  // Backup is switched on AFTER approval, so the code exists only from now on.
  // If the app never checks in again, the server never hears it.
  const wiped=await j(await call(env,'/join',{deviceId:NEW,name:'Returning device',sync:SYNC}));
  assert.equal(wiped.status,'pending','without a check-in there is nothing to match, so a request is all that is possible');
  ok('never checking in leaves a returning device with no way back (the old behaviour)');
}

// ── with the daily check-in, the key works ─────────────────────────────────
{
  const env=mkEnv(); await approvedDevice(env);
  await call(env,'/join',{deviceId:OLD,name:'Faiz Hasan',sync:SYNC});          // the check-in
  assert.equal(env.SUBS.map.get('idn:'+SYNC),OLD,'the check-in is what records the code');

  const back=await j(await call(env,'/join',{deviceId:NEW,name:'Returning device',sync:SYNC}));
  assert.equal(back.status,'approved','the key proves who they are; no admin needed');
  assert.equal(back.rejoined,true);
  assert.equal(back.name,'Faiz Hasan','they come back as themselves, not as a new row');
  ok('after a check-in, a wiped device gets straight back in with its own key');
}

// ── the old device keeps working ───────────────────────────────────────────
{
  const env=mkEnv(); await approvedDevice(env);
  await call(env,'/join',{deviceId:OLD,name:'Faiz Hasan',sync:SYNC});
  await call(env,'/join',{deviceId:NEW,name:'Returning device',sync:SYNC});
  const old=await j(await call(env,'/join',{deviceId:OLD,name:'Faiz Hasan',sync:SYNC}));
  assert.equal(old.status,'approved','a phone and a laptop share one code — neither may evict the other');
  ok('rejoining does not sign the original device out');
}

// ── checking in costs a read, not a write ──────────────────────────────────
{
  const env=mkEnv(); await approvedDevice(env);
  await call(env,'/join',{deviceId:OLD,name:'Faiz Hasan',sync:SYNC});
  const after=env.writes;
  for(let i=0;i<10;i++) await call(env,'/join',{deviceId:OLD,name:'Faiz Hasan',sync:SYNC});
  assert.equal(env.writes,after,'ten more check-ins must not spend ten of the thousand daily writes');
  ok('repeat check-ins spend no KV writes');
}

// ── a friend code still cannot be used as a key ────────────────────────────
{
  const env=mkEnv(); await approvedDevice(env);
  await call(env,'/join',{deviceId:OLD,name:'Faiz Hasan',sync:SYNC,fcode:'PUBLICCODE12'});
  assert.equal(env.SUBS.map.get('idn:PUBLICCODE12'),undefined,'the friend code is handed out on purpose and must never open the door');
  const imposter=await j(await call(env,'/join',{deviceId:'dev-imposter',name:'Imposter',sync:'PUBLICCODE12'}));
  assert.equal(imposter.status,'pending','holding somebody\'s public code gets you a request, nothing more');
  ok('a friend code is not a way in');
}

// ── a wrong key is still just a request ────────────────────────────────────
{
  const env=mkEnv(); await approvedDevice(env);
  await call(env,'/join',{deviceId:OLD,name:'Faiz Hasan',sync:SYNC});
  const typo=await j(await call(env,'/join',{deviceId:'dev-typo',name:'Returning device',sync:'EF3N8VL4CW2AHVM3P3JX'}));
  assert.equal(typo.status,'pending');
  ok('a mistyped key falls back to asking, it does not let you in');
}

console.log('\n'+n+' passed');
