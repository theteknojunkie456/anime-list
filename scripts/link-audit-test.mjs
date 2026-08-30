// Re-checks every stored database link against the sibling rule. A wrong link
// never announces itself, and a flaky network must never be able to mark a
// list doubtful. run: node scripts/link-audit-test.mjs
import {spawn} from 'node:child_process';
const PORT=8953,DBG=9493;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-aud`,
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
// his actual case: a finished series bound to its own Specials
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',JSON.stringify([
 {id:'a1',title:'The Quintessential Quintuplets',status:'finished',kind:'watch',ep:12,epTotal:2,aniId:9999},
 {id:'a2',title:'Vinland Saga',status:'finished',kind:'watch',ep:24,epTotal:24,aniId:101348},
 {id:'a3',title:'Bocchi',status:'watching',kind:'watch',ep:3,epTotal:12,aniId:130003,alt:['Bocchi the Rock!']},
 {id:'a4',title:'Gone Forever',status:'plan',kind:'watch',ep:0,aniId:777777},
 {id:'a5',title:'No Link Here',status:'plan',kind:'watch',ep:0}]));
localStorage.setItem('wl_net_status','approved');
window.__al=0;
const real=window.fetch;
window.fetch=function(u,o){
  if(String(u).includes('graphql.anilist.co')){
    window.__al++;
    if(window.__alFail)return Promise.reject(new Error('Failed to fetch'));
    const body=JSON.parse(o.body||'{}');
    const ids=(body.variables&&body.variables.ids)||[];
    const DB={9999:{english:'The Quintessential Quintuplets Specials',romaji:'Go-toubun no Hanayome Specials'},
              101348:{english:'Vinland Saga',romaji:'Vinland Saga'},
              130003:{english:'Bocchi the Rock!',romaji:'Bocchi the Rock!'}};
    const media=ids.filter(i=>DB[i]).map(i=>({id:i,title:{english:DB[i].english,romaji:DB[i].romaji,native:null}}));
    return Promise.resolve(new Response(JSON.stringify({data:{Page:{media}}}),
      {status:200,headers:{'Content-Type':'application/json'}}));
  }
  return new Promise(()=>{});
};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4400);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const r=await ev(`(async()=>{const r=await auditLinks();return r;})()`);
console.log('    result:', JSON.stringify(r));
t('it checks every linked show', r.checked, 4);
t('and flags the one bound to its specials', r.flagged, 2);   // the specials + the vanished id
t('an unlinked show is not checked at all', await ev(`!!anime.find(a=>a.id==='a5').idWeak`), false);

t('the mis-bound one is marked', await ev(`!!anime.find(a=>a.id==='a1').idWeak`), true);
t('a correct link is left alone', await ev(`!!anime.find(a=>a.id==='a2').idWeak`), false);
t('an abbreviation still counts as a match', await ev(`!!anime.find(a=>a.id==='a3').idWeak`), false);
t('an id that resolves to nothing is marked', await ev(`!!anime.find(a=>a.id==='a4').idWeak`), true);
t('"weak" lists exactly those', await ev(`anime.filter(SRCH_TERMS.weak).map(a=>a.title)`),
  ['The Quintessential Quintuplets','Gone Forever']);

// a second pass must be stable, and must clear a link that is fine again
const again=await ev(`(async()=>{const r=await auditLinks();return {flagged:r.flagged,cleared:r.cleared};})()`);
t('running it twice flags nothing new', again, {flagged:0,cleared:0});

const heal=await ev(`(async()=>{
  anime.find(a=>a.id==='a1').title='The Quintessential Quintuplets Specials';
  const r=await auditLinks(); return {cleared:r.cleared, weak:!!anime.find(a=>a.id==='a1').idWeak};})()`);
t('and clears one once it genuinely matches', heal, {cleared:1,weak:false});

// a dead network must never mark a list doubtful
const net=await ev(`(async()=>{
  anime.forEach(a=>delete a.idWeak);
  window.__alFail=1; const r=await auditLinks(); window.__alFail=0;
  return {failed:r.failed, flagged:r.flagged, unknown:r.unknown,
          anyWeak:anime.some(a=>a.idWeak)};})()`);
console.log('    offline:', JSON.stringify(net));
t('a failed check marks nothing', net.anyWeak, false);
t('and says so rather than claiming a result', net.failed, true);
t('counting what it could not reach', net.unknown, 4);
console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
