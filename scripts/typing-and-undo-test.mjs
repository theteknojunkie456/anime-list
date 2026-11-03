// Three things a person does with their hands, and one thing the app says about
// itself while it cannot read its own list.
//
//  1. Codes used to accept anything and tidy up only on submit, so twenty
//     characters went in with no way to see which one you were on.
//  2. There was no undo. The keyboard's most-expected shortcut did nothing,
//     and removing a title was final.
//  3. A LOCKED device reported "Titles here 0" and "nothing has reached the
//     cloud yet" — which is what losing a library looks like. The titles were
//     there; the device just could not read them yet.
// run: node scripts/typing-and-undo-test.mjs
import {spawn} from 'node:child_process';
const PORT=9055,DBG=9595;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-typing`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let tabs=null;
for(let _i=0;_i<120;_i++){
  await wait(500);
  try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
}
if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s');
  try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){} process.exit(1); }
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
  ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
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

const MINE=[
  {id:'u1',kind:'watch',status:'watching',title:'Vinland Saga',aniId:101348,ep:5,epTotal:24,upd:2000},
  {id:'u2',kind:'watch',status:'plan',title:'Monster',aniId:19,ep:0,epTotal:74,upd:2000},
  {id:'u3',kind:'watch',status:'watching',title:'Tokyo Ghoul',aniId:20605,ep:3,epTotal:12,upd:2000},
];
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
localStorage.setItem('animelist_v4',${JSON.stringify(JSON.stringify(MINE))});
localStorage.setItem('sync_animelist_v4','DESKCODE12345678901X');
localStorage.setItem('wl_net_status','approved');
localStorage.setItem('tut_seen_animelist_v4','1');
localStorage.setItem('seen_release','2026-11-02.66');
// The browser profile survives between runs, so tombstones written by the LAST
// run are still here — and "undo removes the tombstone" only holds if there was
// no tombstone before the removal. Without this the file passes once and then
// fails for ever, which is the failure mode suite.sh --twice exists to catch.
localStorage.removeItem('wl_tombs');
window.fetch=function(u,o){
  let b={};try{b=JSON.parse((o&&o.body)||'{}');}catch(e){}
  const J=v=>Promise.resolve(new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}}));
  if(b.op==='push')return J({ok:true,updatedAt:Date.now()});
  if(b.op==='pull')return J({data:null,updatedAt:0});
  return new Promise(()=>{});
};`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

await ev(`openSheet('backupSheet')`); await wait(600);
t('the shortcut handler is installed', await ev(`typeof undoLast==='function'&&typeof redoLast==='function'`), true);

// ── 1. codes keep their shape while they are typed ─────────────────────────
const fmt=(val,max,group,caret)=>ev(`(()=>{
  const el=document.createElement('input');document.body.appendChild(el);
  el.value=${JSON.stringify(val)};
  try{el.setSelectionRange(${caret===undefined?'el.value.length':caret},${caret===undefined?'el.value.length':caret});}catch(e){}
  formatCodeInput(el,${max},${group});
  const out={v:el.value,caret:el.selectionStart};el.remove();return out;})()`);

t('lower case comes out upper', (await fmt('h7b5nzrn',8,4)).v, 'H7B5 NZRN');
t('a twenty-character key is grouped in fours',
  (await fmt('h7b5nzrn3za2rnuelcka',20,4)).v, 'H7B5 NZRN 3ZA2 RNUE LCKA');
t('punctuation someone pasted is dropped, not rejected',
  (await fmt('h7b5-nzrn-3za2-rnue-lcka',20,4)).v, 'H7B5 NZRN 3ZA2 RNUE LCKA');
t('it stops at the length of the code',
  (await fmt('ABCD2345EXTRAJUNK',8,4)).v, 'ABCD 2345');
t('typing on past a group boundary leaves the caret after what you typed',
  await fmt('ABCDE',8,4), {v:'ABCD E',caret:6});
// The one that makes it usable: fixing a character in the middle must not
// throw the caret to the end.
t('editing in the middle keeps the caret in the middle',
  await fmt('H7B5 NZRN 3ZA2',20,4,6), {v:'H7B5 NZRN 3ZA2',caret:6});
t('the real pairing field is wired to it',
  await ev(`(()=>{const el=document.getElementById('pairCodeIn');if(!el)return 'missing';
    el.value='k7t2m9x4';formatCodeInput(el,8,4);return el.value;})()`), 'K7T2 M9X4');

// ── 2. undo ────────────────────────────────────────────────────────────────
await ev(`closeAll&&closeAll()`); await wait(200);
t('nothing to undo yet', await ev(`(()=>{_undo=[];return _undo.length;})()`), 0);

// a removal
await ev(`(()=>{deleteId='u2';doDelete();return 1;})()`); await wait(300);
t('the title is gone', await ev(`anime.some(a=>a.id==='u2')`), false);
t('and a tombstone was recorded, or sync would bring it back',
  await ev(`!!JSON.parse(localStorage.getItem('wl_tombs')||'{}')['u2']`), true);
await ev(`undoLast()`); await wait(300);
t('undo puts it back', await ev(`anime.some(a=>a.id==='u2')`), true);
t('and takes the tombstone off — otherwise the next sync deletes it again',
  await ev(`!!JSON.parse(localStorage.getItem('wl_tombs')||'{}')['u2']`), false);
t('it does not duplicate it', await ev(`anime.filter(a=>a.id==='u2').length`), 1);

// an episode
await ev(`(()=>{detailId='u1';return 1;})()`);
await ev(`bumpEp(1)`); await wait(400);
t('the episode moved', await ev(`anime.find(a=>a.id==='u1').ep`), 6);
await ev(`undoLast()`); await wait(300);
t('undo moves it back', await ev(`anime.find(a=>a.id==='u1').ep`), 5);

// a status, and the date that rides with it
await ev(`(()=>{detailId='u3';setDetailStatus('finished');return 1;})()`); await wait(400);
t('the status changed', await ev(`anime.find(a=>a.id==='u3').status`), 'finished');
t('finishing filled the episode count in', await ev(`anime.find(a=>a.id==='u3').ep`), 12);
await ev(`undoLast()`); await wait(300);
t('undo puts the status back', await ev(`anime.find(a=>a.id==='u3').status`), 'watching');
t('and the episode count with it', await ev(`anime.find(a=>a.id==='u3').ep`), 3);
t('and clears the finished date it invented',
  await ev(`anime.find(a=>a.id==='u3').finAt===undefined`), true);

t('undoing past the start says so rather than throwing',
  await ev(`(()=>{_undo=[];_redo=[];undoLast();redoLast();return 'survived';})()`), 'survived');

// ── redo, and the keys themselves ──────────────────────────────────────────
const key=(k,o={})=>ev(`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',
  Object.assign({key:${JSON.stringify(k)},bubbles:true,cancelable:true},${JSON.stringify(o)})));return 1;})()`);

await ev(`closeAll&&closeAll()`); await wait(200);
await ev(`(()=>{_undo=[];_redo=[];deleteId='u2';doDelete();return 1;})()`); await wait(300);
t('removed again, to undo with the keyboard this time', await ev(`anime.some(a=>a.id==='u2')`), false);
await key('z',{metaKey:true}); await wait(400);
t('\u2318Z undoes it', await ev(`anime.some(a=>a.id==='u2')`), true);
await key('z',{metaKey:true,shiftKey:true}); await wait(400);
t('\u2318\u21e7Z redoes it', await ev(`anime.some(a=>a.id==='u2')`), false);
t('and the tombstone came back with the redo',
  await ev(`!!JSON.parse(localStorage.getItem('wl_tombs')||'{}')['u2']`), true);
await key('z',{metaKey:true}); await wait(400);
t('and it undoes a second time', await ev(`anime.some(a=>a.id==='u2')`), true);

t('a fresh action clears the redo line',
  await ev(`(()=>{_redo=[{label:'stale'}];pushUndo('x',()=>{},()=>{});return _redo.length;})()`), 0);

// Inside a field, ⌘Z is the browser's undo of your typing. Taking it there
// would make editing a note a trap.
await ev(`(()=>{_undo=[];_redo=[];const i=document.getElementById('searchIn');i.focus();
  deleteId='u3';doDelete();return 1;})()`); await wait(300);
await key('z',{metaKey:true}); await wait(350);
t('\u2318Z in a text field leaves the list alone',
  await ev(`anime.some(a=>a.id==='u3')`), false);
await ev(`(()=>{document.getElementById('searchIn').blur();undoLast();return 1;})()`); await wait(300);
t('and still works once the field is left', await ev(`anime.some(a=>a.id==='u3')`), true);

// Ctrl is the same shortcut on a PC.
await ev(`(()=>{_undo=[];_redo=[];deleteId='u3';doDelete();return 1;})()`); await wait(300);
await key('z',{ctrlKey:true}); await wait(400);
t('Ctrl+Z does the same thing', await ev(`anime.some(a=>a.id==='u3')`), true);

// ── the open-title keys ────────────────────────────────────────────────────
await ev(`openDetail('u1')`); await wait(600);
const ep0=await ev(`anime.find(a=>a.id==='u1').ep`);
await key('.'); await wait(500);
t('"." moves to the next episode', await ev(`anime.find(a=>a.id==='u1').ep`), ep0+1);
await key(','); await wait(500);
t('"," moves back', await ev(`anime.find(a=>a.id==='u1').ep`), ep0);
const fav0=await ev(`!!anime.find(a=>a.id==='u1').fav`);
await key('f'); await wait(400);
t('"f" favourites what is open', await ev(`!!anime.find(a=>a.id==='u1').fav`), !fav0);
await ev(`closeAll()`); await wait(300);

// ── the help card lists what was added ─────────────────────────────────────
const help=await ev(`(()=>{const rows=KB_HELP.map(r=>r[0]+'|'+r[1]).join('\\n');return rows;})()`);
for(const [k,label] of [['\u2318 Z','Undo'],['\u2318 \u21e7 Z','Redo'],['e','Edit the focused card'],
                        ['.','Next episode'],['\u2318 \u232b','Remove the focused card, or the selection']])
  t('the help card lists '+label, help.includes(k+'|'+label), true);
t('and it is grouped, not one flat run',
  await ev(`KB_HELP.filter(r=>r[0]==='').length>=3`), true);
// The data being right is not the same as the card drawing. A group row has no
// keys to draw, and the renderer has to notice that rather than printing an
// empty key cap.
t('the card actually draws, with headings and no empty key caps',
  await ev(`(()=>{try{toggleKbHelp();const el=document.getElementById('kbHelp');
    const grps=el.querySelectorAll('.kbhelp-grp').length;
    const empty=Array.prototype.some.call(el.querySelectorAll('.kbkey'),k=>!k.textContent.trim());
    const rows=el.querySelectorAll('.kbhelp-row').length;
    closeKbHelp();
    // Counted from the table rather than hard-coded, so adding a shortcut does
    // not fail this for the wrong reason.
    const wantGrps=KB_HELP.filter(r=>r[0]==='').length;
    const wantRows=KB_HELP.length-wantGrps;
    return {grpsOk:grps===wantGrps,rowsOk:rows===wantRows,empty};
    }catch(e){return 'threw: '+e.message;}})()`),
  {grpsOk:true,rowsOk:true,empty:false});

// ── 3. a locked device does not report an empty library ────────────────────
await ev(`openSheet('backupSheet')`); await wait(400);
await ev(`(()=>{appLocked=true;renderSyncUI();return 1;})()`); await wait(300);
const box=await ev(`(document.getElementById('syncBox')||{}).textContent||''`);
t('the panel says the list is locked', /your list is locked/i.test(box), true);
t('it does not say nothing has been saved', /nothing saved yet/i.test(box), false);
t('and it does not offer to back up what it cannot read',
  await ev(`!!document.getElementById('backupNowBtn')`), false);
t('it offers to unlock instead', /Unlock your list/.test(box), true);

await ev(`showSyncDiagnosis()`); await wait(1200);
const diag=await ev(`(document.getElementById('syncDiagBox')||{}).textContent||''`);
t('the diagnosis leads with locked, not with a count',
  /list is locked on this device/i.test(diag), true);
t('and reports the titles as locked rather than as zero',
  /Titles on this device\s*locked/i.test(diag.replace(/\s+/g,' ')), true);
await ev(`(()=>{appLocked=false;return 1;})()`);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
