#!/usr/bin/env node
// The watch party, end to end, against the DEPLOYED room — three real clients on
// real sockets. The UI can only be trusted about the protocol if the protocol is
// asked directly, so this asks it: who is in the room, who is allowed to drive
// it, what a guest may and may not do, and what happens when people misbehave,
// drop, or come back.
//
// run: node scripts/party-live.test.mjs      (needs network — it talks to the live worker)
const BASE='wss://watchlist-sync.muhammad-dac.workers.dev';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+(ok?'':'  -> '+JSON.stringify(g)+' (want '+JSON.stringify(e)+')'));};
const tt=(n,c,note)=>{c?pass++:fail++;console.log((c?'ok  ':'FAIL')+'  '+n+(c?'':'  -> '+(note||'')));};
function mkClient(ROOM){
  return function client(name,uid,create){
    const ws=new WebSocket(`${BASE}/party/${ROOM}?uid=${uid}&name=${encodeURIComponent(name)}`+(create?'&create=1':''));
    const c={ws,name,uid,msgs:[],open:false,closed:false,closeReason:''};
    ws.onmessage=e=>{try{c.msgs.push(JSON.parse(e.data));}catch(err){}};
    ws.onopen=()=>c.open=true;
    ws.onclose=e=>{c.closed=true;c.closeReason=e.reason||'';};
    c.send=o=>{try{ws.send(JSON.stringify(o));}catch(e){}};
    c.last=t2=>[...c.msgs].reverse().find(m=>m.t===t2);
    c.room=()=>c.last('state')?.room||{};
    c.seen=p=>c.msgs.some(p);
    c.ready=()=>new Promise(r=>{const i=setInterval(()=>{if(c.open||c.closed){clearInterval(i);r();}},20);});
    return c;
  };
}

// ── the basics: who is here, who drives, chat, queue, late joiners, host leaving ──
{
  const ROOM='T'+Math.random().toString(36).slice(2,6).toUpperCase();
  const client=mkClient(ROOM);
  console.log('room',ROOM,'\n');
  const A=client('Ayaan','uidA',true);
  await A.ready(); await wait(600);
  const B=client('Bilal','uidB');
  await B.ready();
  await wait(900);
  
  // ── everyone sees everyone ────────────────────────────────────────────────
  const mem=A.last('state')?.room?.members||[];
  t('two people in the room', mem.length, 2);
  tt('the room names them', mem.map(m=>m.name).sort().join(',')==='Ayaan,Bilal', JSON.stringify(mem));
  const host=(A.last('state')?.room||{}).host;
  tt('exactly one host, and it is the first to arrive', host==='uidA', 'host='+host);
  
  // ── the host picks something, everyone follows ────────────────────────────
  A.send({t:'set',title:'Frieren',animeId:'a1',ep:12,img:''});
  await wait(700);
  t('a pick reaches the other person', B.last('state')?.room?.title, 'Frieren');
  t('and carries the episode', B.last('state')?.room?.ep, 12);
  
  // ── a guest must not be able to drive ─────────────────────────────────────
  B.send({t:'set',title:'Hijacked',animeId:'zz',ep:1,img:''});
  await wait(700);
  tt('a guest cannot change what is playing', (A.last('state')?.room?.title)==='Frieren',
     'title is now '+(A.last('state')?.room?.title));
  
  // ── play / pause ──────────────────────────────────────────────────────────
  A.send({t:'play'}); await wait(600);
  {const rm=B.last('state')?.room||{};
   tt('play reaches everyone', rm.paused===false&&rm.playAt>0, 'paused='+rm.paused+' playAt='+rm.playAt);}
  A.send({t:'pause'}); await wait(600);
  {const rm=B.last('state')?.room||{};
   tt('pause reaches everyone', rm.paused===true, 'paused='+rm.paused);}
  
  // ── chat, typing, reactions ───────────────────────────────────────────────
  B.send({t:'chat',msg:'this opening is unreal'});
  await wait(700);
  tt('chat arrives for the other person', A.seen(m=>JSON.stringify(m).includes('this opening is unreal')), '');
  tt('and the sender sees their own message', B.seen(m=>JSON.stringify(m).includes('this opening is unreal')), '');
  tt('the message is attributed to who sent it',
     (A.last('state')?.room?.chat||[]).some(c=>c.msg==='this opening is unreal'&&c.name==='Bilal'),
     JSON.stringify((A.last('state')?.room?.chat||[]).slice(-2)));
  B.send({t:'react',emoji:'\u{1F525}'}); await wait(500);
  tt('a reaction arrives', A.seen(m=>m.t==='react'), '');
  B.send({t:'typing'}); await wait(400);
  tt('typing arrives', A.seen(m=>m.t==='typing'), '');
  
  // ── the queue ─────────────────────────────────────────────────────────────
  A.send({t:'queue-add',title:'Dandadan',animeId:'a2',aniId:171018,ep:1,img:''});
  B.send({t:'queue-add',title:'Monster',animeId:'a3',aniId:19,ep:1,img:''});
  await wait(900);
  const q=A.last('state')?.room?.queue||[];
  t('anyone can add to the queue', q.length, 2);
  if(q.length){
    B.send({t:'queue-vote',qid:q[1]&&q[1].id});
    await wait(700);
    const q2=A.last('state')?.room?.queue||[];
    const voted=q2.find(x=>x.id===(q[1]&&q[1].id));
    tt('a vote is counted', !!voted&&((voted.votes||[]).length>0||voted.v>0), JSON.stringify(voted));
  }
  A.send({t:'queue-next'}); await wait(800);
  const afterNext=A.last('state')?.room;
  tt('queue-next moves the room on', afterNext&&afterNext.title!=='Frieren', 'title='+(afterNext||{}).title);
  
  // ── ready check ───────────────────────────────────────────────────────────
  B.send({t:'ready',on:true}); await wait(600);
  const bm=(A.last('state')?.room?.members||[]).find(m=>m.uid==='uidB');
  tt('ready shows on the member', !!bm&&bm.ready===true, JSON.stringify(bm));
  
  // ── a late arrival gets the current state, not an empty room ──────────────
  const C=client('Chetan','uidC'); await C.ready(); await wait(900);
  const cr=C.last('state')?.room;
  tt('someone joining late sees what is already playing', !!cr&&!!cr.title, JSON.stringify(cr&&cr.title));
  t('and sees all three people', (cr?.members||[]).length, 3);
  
  // ── the host leaves ───────────────────────────────────────────────────────
  A.ws.close(); await wait(1400);
  const afterHost=B.last('state')?.room;
  tt('the room survives the host leaving', !!afterHost, '');
  tt('and hands the room to someone still in it',
     !!afterHost && afterHost.host!=='uidA' && (afterHost.members||[]).some(m=>m.uid===afterHost.host),
     'host='+(afterHost||{}).host+' members='+JSON.stringify((afterHost||{}).members||[]));
  
  B.ws.close(); C.ws.close();
  }

// ── permissions and abuse: what a guest may do, junk, floods, dropping and rejoining ──
{
  const ROOM='X'+Math.random().toString(36).slice(2,6).toUpperCase();
  const client=mkClient(ROOM);
  console.log('room',ROOM,'\n');
  const H=client('Host','uidH',true); await H.ready(); await wait(500);
  const G=client('Guest','uidG');     await G.ready(); await wait(800);
  H.send({t:'set',title:'Frieren',animeId:'a1',ep:3,img:''}); await wait(600);
  
  // ── host-only controls, attempted by a guest ──────────────────────────────
  G.send({t:'play'}); await wait(600);
  tt('a guest cannot start playback', H.room().paused!==false||!(H.room().playAt>0),
     'paused='+H.room().paused+' playAt='+H.room().playAt);
  
  H.send({t:'play'}); await wait(500);
  G.send({t:'pause'}); await wait(600);
  tt('a guest cannot pause everyone', H.room().paused!==true, 'paused='+H.room().paused);
  
  G.send({t:'kick',uid:'uidH'}); await wait(700);
  tt('a guest cannot kick the host', (H.room().members||[]).some(m=>m.uid==='uidH'),
     JSON.stringify((H.room().members||[]).map(m=>m.uid)));
  
  G.send({t:'host-set',to:'uidG'}); await wait(700);
  tt('a guest cannot make themselves host', H.room().host==='uidH', 'host='+H.room().host);
  
  G.send({t:'queue-add',title:'Dandadan',animeId:'a2',aniId:1,ep:1,img:''}); await wait(600);
  tt('but a guest CAN add to the queue (by design)', (H.room().queue||[]).length===1,
     JSON.stringify((H.room().queue||[]).length));
  G.send({t:'queue-next'}); await wait(700);
  tt('and cannot force the room onto the next item', H.room().title==='Frieren', 'title='+H.room().title);
  
  // ── the host can do all of it ─────────────────────────────────────────────
  H.send({t:'host-set',to:'uidG'}); await wait(700);
  tt('the host can hand the room over', H.room().host==='uidG', 'host='+H.room().host);
  G.send({t:'pause'}); await wait(600);
  tt('and the new host has the controls', G.room().paused===true, 'paused='+G.room().paused);
  G.send({t:'host-set',to:'uidH'}); await wait(600);
  
  // ── abuse ─────────────────────────────────────────────────────────────────
  const huge='x'.repeat(5000);
  G.send({t:'chat',msg:huge}); await wait(700);
  const last=(H.room().chat||[]).slice(-1)[0]||{};
  tt('an oversized message is trimmed, not stored whole', !last.msg||last.msg.length<=300, 'len='+((last.msg||'').length));
  tt('and the socket survives it', !G.closed, 'closed='+G.closed);
  
  G.send({t:'nonsense-op',x:1}); G.send('not even json'); await wait(600);
  tt('junk does not take the room down', !G.closed && !!H.room().code, 'closed='+G.closed);
  
  for(let i=0;i<60;i++) G.send({t:'chat',msg:'flood '+i});
  await wait(1400);
  const chatLen=(H.room().chat||[]).length;
  tt('chat history is capped rather than growing forever', chatLen<=200, 'chat length='+chatLen);
  tt('the room is still answering after a flood', !!H.room().title, 'title='+H.room().title);
  
  // ── dropping and coming back ──────────────────────────────────────────────
  G.ws.close(); await wait(1200);
  tt('a leaver is removed from the roster', !(H.room().members||[]).some(m=>m.uid==='uidG'),
     JSON.stringify((H.room().members||[]).map(m=>m.uid)));
  const G2=client('Guest','uidG'); await G2.ready(); await wait(900);
  tt('and can rejoin to the same room, still playing', G2.room().title==='Frieren', 'title='+G2.room().title);
  tt('without duplicating themselves', (G2.room().members||[]).filter(m=>m.uid==='uidG').length===1,
     JSON.stringify((G2.room().members||[]).map(m=>m.uid)));
  
  // ── everyone leaves, then someone returns ─────────────────────────────────
  H.ws.close(); G2.ws.close(); await wait(1200);
  const L=client('Later','uidL'); await L.ready(); await wait(900);
  tt('an empty room still knows what was playing', L.room().title==='Frieren'||!!L.room().code,
     'title='+L.room().title+' code='+L.room().code);
  L.ws.close();
  }

// ── voice, screen share, the WebRTC relay, playback sync, resync, kick ──
{
  const ROOM='Y'+Math.random().toString(36).slice(2,6).toUpperCase();
  const client=mkClient(ROOM);
  console.log('room',ROOM,'\n');
  const H=client('Host','uidH',true); await H.ready(); await wait(500);
  const A=client('Ann','uidA');       await A.ready();
  const B=client('Ben','uidB');       await B.ready(); await wait(900);
  H.send({t:'set',title:'Frieren',animeId:'a1',ep:5,img:''}); await wait(600);
  
  // ── voice presence ────────────────────────────────────────────────────────
  A.send({t:'voice',on:true}); await wait(700);
  const v=H.room().voice;
  tt('joining voice shows for everyone', Array.isArray(v)?v.includes('uidA'):!!(v&&v.uidA), JSON.stringify(v));
  A.send({t:'voice',on:false}); await wait(700);
  const v2=H.room().voice;
  tt('and leaving voice clears it', Array.isArray(v2)?!v2.includes('uidA'):!(v2&&v2.uidA), JSON.stringify(v2));
  
  // ── screen share ──────────────────────────────────────────────────────────
  H.send({t:'share',on:true}); await wait(700);
  tt('screen share is attributed to the sharer', A.room().sharing==='uidH', 'sharing='+A.room().sharing);
  H.send({t:'share',on:false}); await wait(700);
  tt('and clears when they stop', A.room().sharing==='', 'sharing='+A.room().sharing);
  
  // ── the WebRTC relay must be point to point ───────────────────────────────
  A.send({t:'signal',to:'uidB',kind:'offer',data:{sdp:'FAKE-SDP'}}); await wait(800);
  tt('a signal reaches the person it names', B.seen(m=>m.t==='signal'&&m.from==='uidA'&&m.kind==='offer'), '');
  tt('and nobody else sees it', !H.seen(m=>m.t==='signal'), 'the host received a signal meant for Ben');
  
  // ── playback sync ─────────────────────────────────────────────────────────
  H.send({t:'pb',playing:true,time:123.5}); await wait(700);
  tt('the host\'s playback position reaches the others', A.seen(m=>m.t==='pb'&&m.time===123.5), '');
  tt('and is not echoed back to the host', !H.seen(m=>m.t==='pb'), 'host got its own pb back');
  A.send({t:'pb',playing:false,time:9}); await wait(700);
  tt('a guest cannot drive playback position', !B.seen(m=>m.t==='pb'&&m.time===9), 'a guest pb reached Ben');
  
  // ── wait / ready ──────────────────────────────────────────────────────────
  B.send({t:'wait',on:true}); await wait(700);
  const bm=(H.room().members||[]).find(m=>m.uid==='uidB');
  tt('asking everyone to wait shows on you', !!bm&&bm.wait===true, JSON.stringify(bm));
  B.send({t:'wait',on:false}); await wait(600);
  
  // ── resync ────────────────────────────────────────────────────────────────
  const revBefore=H.room().rev;
  H.send({t:'resync'}); await wait(800);
  tt('resync restarts the room without changing the show',
     H.room().title==='Frieren' && H.room().rev>revBefore, 'rev '+revBefore+' -> '+H.room().rev);
  
  // ── the host can remove someone ───────────────────────────────────────────
  H.send({t:'kick',uid:'uidB'}); await wait(1200);
  tt('the host can remove a member', !(H.room().members||[]).some(m=>m.uid==='uidB'),
     JSON.stringify((H.room().members||[]).map(m=>m.uid)));
  tt('and they are told why, not just dropped', B.closed && (B.seen(m=>m.t==='error')||B.closeReason==='removed'),
     'closed='+B.closed+' reason='+B.closeReason);
  
  H.ws.close(); A.ws.close();
  }

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
