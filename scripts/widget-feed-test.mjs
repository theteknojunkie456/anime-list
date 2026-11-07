// WHAT THE HOME SCREEN WIDGET IS TOLD.
//
// The widget is a separate process. It cannot read the page, so everything on it
// was decided here and posted over the native bridge — which makes this file the
// only place the two halves can be checked against each other. Two kinds of row:
//
//   • the feed: what the page sends, when it sends it, and when it stays quiet
//     (a locked list, an unchanged list, the web build — all silence).
//   • the contract: every key the page sends is a key the Swift side reads.
//     Nothing in Xcode fails if they drift; the widget just quietly shows an
//     empty tile, which is the kind of bug nobody reports.
//
// run: node scripts/widget-feed-test.mjs
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const NATIVE_UA='Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 WatchListNative/1.0';
const WEB_UA='Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17.0 Safari/604.1';
const PORT=9059, DBG=9599;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

// ── the contract, no browser needed ─────────────────────────────────────────
function contract(){
  const sw=readFileSync('ios-broadcast/WidgetBridge.swift','utf8');
  const shared=readFileSync('ios-broadcast/WidgetShared.swift','utf8');
  const widget=readFileSync('ios-broadcast/Widget/WatchListWidget.swift','utf8');
  const cv=readFileSync('ios-broadcast/ContentView.swift','utf8');
  const html=readFileSync('index.html','utf8');

  for(const k of ['up','air','watching','theme'])
    t('the shell reads the "'+k+'" the page sends', sw.includes('body["'+k+'"]'), true);
  for(const k of ['id','title','ep','total','img','banner'])
    t('an up-next row’s "'+k+'" is read', sw.includes('r["'+k+'"]'), true);
  for(const k of ['title','at','ep'])
    t('the air time’s "'+k+'" is read', sw.includes('a["'+k+'"]'), true);
  for(const k of ['a','bg','bg2','t1','t2'])
    t('the theme’s "'+k+'" is read', sw.includes('th["'+k+'"]'), true);

  t('both messages the page can send are handled', ['case "widget":','case "widgetclear":'].every(x=>cv.includes(x)), true);
  t('a widget tap calls back into the page', cv.includes('window.wlOpenTitle') && html.includes('window.wlOpenTitle='), true);
  t('and the page registers the scheme that carries it',
    readFileSync('ios-broadcast/project.yml','utf8').includes('CFBundleURLSchemes'), true);
  // project.yml, not Generated/ — the entitlement files are produced by
  // XcodeGen and gitignored, so a fresh clone (CI) has neither. The spec is the
  // thing that has to be right; the files follow from it.
  const groups=(readFileSync('ios-broadcast/project.yml','utf8')
    .match(/- group\.com\.humblezone\.watchlist/g)||[]).length;
  t('the app and the widget name the same App Group',
    groups===2 && shared.includes('group.com.humblezone.watchlist'), true);
  // A widget that pulls in WebRTC is an extension that gets killed for memory
  // on a Home Screen refresh.
  const yml=readFileSync('ios-broadcast/project.yml','utf8');
  const wblock=yml.slice(yml.indexOf('  WatchListWidget:'));
  t('the widget target depends on nothing heavy', /package:\s*WebRTC/.test(wblock), false);
  t('the widget draws from a file, never the network',
    widget.includes('Data(contentsOf:') && !/URLSession/.test(widget), true);
  // A countdown built as a String freezes until the next timeline entry, an hour
  // away — so "in 4 hr" still says four hours at a quarter to. The system ticks
  // Text(_:style:) for free; anything else is a lie that costs a reload to fix.
  t('the countdown ticks instead of being baked into a string',
    /Text\(air\.when, style: \.relative\)/.test(widget), true);
  t('and it says which show it is counting down',
    widget.includes('withTitle') && widget.includes('air.title'), true);
  // Cover art is cached under the title's id, so nothing would ever replace it
  // when a cover is re-picked, and nothing would ever remove it when the title
  // drops off the widget.
  t('a re-picked cover drops the cached one', /wasCover\[r\.id\] != r\.img/.test(sw), true);
  t('and so does a changed banner', /wasWide\[r\.id\] != r\.banner/.test(sw), true);
  // THE ARTWORK IS THE WIDGET. Everything the first version stacked on top of
  // the poster — a caps label, the title, the episode line, a scrim over a
  // third of the picture — is the dashboard-tile look, and it is gone. What is
  // left over the art is the progress hairline and nothing else.
  t('nothing is stacked on the artwork but progress',
    !/UP NEXT/.test(widget) && !/LinearGradient\(colors: \[\.black/.test(widget), true);
  t('the wide size prefers the art drawn wide',
    /wide: wide\) \?\? WLArt\.image\(item\.id, wide: false\)/.test(widget), true);
  t('and the bar carries its own track rather than a scrim',
    widget.includes('Color.black.opacity(0.5)') && widget.includes('ProgressStrip'), true);
  t('and art for titles the widget no longer shows is swept',
    /func prune\(keeping/.test(sw) && /prune\(keeping: s\.up\)/.test(sw), true);
}

async function run(ua,label){
  const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
  const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new','--remote-debugging-port='+DBG,
     `--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-widget-${label}`,
     '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run',
     '--user-agent='+ua,'about:blank'],{stdio:'ignore'});
  let tabs=null;
  for(let i=0;i<120;i++){
    await wait(500);
    try{ tabs=await (await fetch('http://127.0.0.1:'+DBG+'/json/list')).json(); if(tabs&&tabs.length)break; }catch(e){ tabs=null; }
  }
  const down=()=>{try{srv&&srv.kill();}catch(e){} try{ch&&ch.kill();}catch(e){}};
  if(!tabs||!tabs.length){ console.log('could not reach the test browser after 60s'); down(); process.exit(1); }
  const ws=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{const k=setTimeout(()=>j(new Error('the test browser never accepted a connection')),20000);
    ws.onopen=()=>{clearTimeout(k);r();};ws.onerror=()=>{clearTimeout(k);j(new Error('refused'));};});
  let id=0;const w={};
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w[m.id])w[m.id](m);};
  const bail=why=>{console.log(why);down();process.exit(1);};
  const cmd=(m,p={})=>new Promise(r=>{const i=++id;
    const k=setTimeout(()=>{if(w[i]){delete w[i];bail('the test browser stopped answering ('+m+')');}},45000);
    w[i]=v=>{clearTimeout(k);r(v);};ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});
    if(r.result?.exceptionDetails)return{__err:(r.result.exceptionDetails.exception?.description||'').split('\n')[0]};
    return r.result?.result?.value;};
  await cmd('Page.enable');await cmd('Runtime.enable');

  // Three watching titles, one of them airing soonest, plus one finished title
  // that has no business being on a "what are you part-way through" widget.
  const soon=Math.floor(Date.now()/1000)+3*3600;
  const later=Math.floor(Date.now()/1000)+4*86400;
  await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    localStorage.setItem('animelist_v4',JSON.stringify([
      {id:'w1',title:'Vinland Saga',status:'watching',kind:'watch',ep:3,epTotal:24,img:'https://x/1.jpg',upd:300,airAt:${later},airEp:5},
      {id:'w2',title:'Frieren',status:'watching',kind:'watch',ep:11,epTotal:28,img:'https://x/2.jpg',upd:200,airAt:${soon},airEp:12},
      {id:'w3',title:'Dandadan',status:'watching',kind:'watch',ep:6,epTotal:0,img:'',upd:100},
      {id:'d1',title:'Steins;Gate',status:'finished',kind:'watch',ep:24,epTotal:24,upd:400}]));
    localStorage.setItem('wl_net_status','approved');
    window.__sent=[];
    window.webkit={messageHandlers:{wl:{postMessage:m=>window.__sent.push(m)}}};
    window.fetch=()=>new Promise(()=>{});`});
  await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
  await wait(4500);
  return {ev,down,cmd};
}

// ── the app ─────────────────────────────────────────────────────────────────
async function native(){
  const {ev,down}=await run(NATIVE_UA,'app');
  t('the app build is in native mode', await ev('IS_NATIVE'), true);

  // Boot alone must feed it: a phone that is opened and put down again should
  // still have an honest Home Screen.
  const boot=await ev(`(()=>{const m=(window.__sent||[]).filter(x=>x.type==='widget');return m.length>0;})()`);
  t('opening the app feeds the widget once', boot, true);

  const snap=await ev(`(async()=>{window.__sent=[];_wgLast='';nativeWidget();
    await new Promise(r=>setTimeout(r,1500));
    const m=window.__sent.filter(x=>x.type==='widget').pop();
    return m?{n:m.up.length,ids:m.up.map(x=>x.id),ep:m.up.map(x=>x.ep),total:m.up.map(x=>x.total),
              air:m.air&&m.air.title,airEp:m.air&&m.air.ep,watching:m.watching,
              hex:/^#[0-9a-f]{6}$/i.test(m.theme.a)&&/^#[0-9a-f]{6}$/i.test(m.theme.bg)}:null;})()`);
  t('only what you are part-way through is sent', snap&&snap.n, 3);
  t('a finished title is not on it', snap&&snap.ids.indexOf('d1'), -1);
  // The number on the widget is the episode to WATCH, not the one already seen.
  // Off by one here reads as "you are behind by one" forever.
  t('the episode shown is the next one, not the last one', snap&&snap.ep, [4,12,7]);
  t('a title with no episode count says so with a zero', snap&&snap.total[2], 0);
  t('the soonest air time is the one carried', snap&&snap.air, 'Frieren');
  t('with the episode that is landing', snap&&snap.airEp, 12);
  t('and the count of what is on the go', snap&&snap.watching, 3);
  t('the theme travels as colours the widget can draw', snap&&snap.hex, true);

  // iOS budgets widget reloads. A burst of taps must cost one message, and a
  // list that did not change must cost none.
  const burst=await ev(`(async()=>{window.__sent=[];_wgLast='';nativeWidget();nativeWidget();nativeWidget();
    await new Promise(r=>setTimeout(r,1600));
    return window.__sent.filter(x=>x.type==='widget').length;})()`);
  t('a burst of changes costs one message', burst, 1);
  const same=await ev(`(async()=>{window.__sent=[];nativeWidget();
    await new Promise(r=>setTimeout(r,1600));
    return window.__sent.filter(x=>x.type==='widget').length;})()`);
  t('an unchanged list costs none', same, 0);

  // A real change must still get through — the dedupe must not be a mute.
  const moved=await ev(`(async()=>{window.__sent=[];
    const a=anime.find(x=>x.id==='w2');a.ep=12;save();
    await new Promise(r=>setTimeout(r,1700));
    const m=window.__sent.filter(x=>x.type==='widget').pop();
    return m?m.up.find(x=>x.id==='w2').ep:null;})()`);
  t('ticking an episode moves the widget', moved, 13);

  // A password on the app is not a password if the Home Screen shows the list.
  const locked=await ev(`(async()=>{window.__sent=[];appLocked=true;nativeWidgetClear();
    nativeWidget();await new Promise(r=>setTimeout(r,1500));
    const cleared=window.__sent.some(x=>x.type==='widgetclear');
    const leaked=window.__sent.some(x=>x.type==='widget');
    appLocked=false;return {cleared,leaked};})()`);
  t('locking the app wipes the Home Screen', locked&&locked.cleared, true);
  t('and nothing is sent while it stays locked', locked&&locked.leaked, false);

  // The tap back the other way.
  const tap=await ev(`(()=>{detailId='';window.wlOpenTitle('w1');return detailId;})()`);
  t('a widget tap opens that title', tap, 'w1');
  const gone=await ev(`(()=>{detailId='';window.wlOpenTitle('nope-deleted');return detailId;})()`);
  t('a title deleted since the widget drew does nothing', gone, '');
  const tapLocked=await ev(`(()=>{detailId='';appLocked=true;window.wlOpenTitle('w1');
    const d=detailId;appLocked=false;return d;})()`);
  t('and a tap is not a way past the lock', tapLocked, '');
  down();
}

// ── the web build ───────────────────────────────────────────────────────────
async function web(){
  const {ev,down}=await run(WEB_UA,'web');
  t('the web build is not in native mode', await ev('IS_NATIVE'), false);
  const quiet=await ev(`(async()=>{window.__sent=[];nativeWidget();nativeWidgetClear();
    await new Promise(r=>setTimeout(r,1500));return window.__sent.length;})()`);
  t('and says nothing to a bridge that is not there', quiet, 0);
  down();
}

contract();
await native();
await web();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
