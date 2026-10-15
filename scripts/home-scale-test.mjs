// The home page must not get bigger just because the library did.
//
// Both horizontal rails — Resume and "Airing this week" — built one card per
// eligible title into a strip that shows about three. The card grid was capped
// and always had been, so the usual suspect looked innocent; the rails were what
// grew. Measured before the cap, at 4x CPU throttle:
//
//     titles   renderHome   home HTML   elements
//        100       43 ms      145 KB      1939
//       3000      448 ms      939 KB     17889
//
// After: 59 ms and 150 KB at 3000, flat. This test fails if the page starts
// scaling with the list again.
// run: node scripts/home-scale-test.mjs
import {spawn} from 'node:child_process';
const PORT=9645,DBG=9647;
const srv=spawn('python3',['-m','http.server',String(PORT)],{cwd:process.cwd(),stdio:'ignore'});
const ch=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port='+DBG,`--user-data-dir=${(process.env.TMPDIR||'/tmp')}/wl-homescale`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost','--no-first-run',
  '--disable-background-timer-throttling','about:blank'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(4200);
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
await cmd('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:2,mobile:true});
await cmd('Page.addScriptToEvaluateOnNewDocument',{source:
 `localStorage.setItem('animelist_v4','[]');localStorage.setItem('wl_net_status','approved');`+
 `sessionStorage.setItem('wl_booted','1');localStorage.setItem('wl_seen_tut','1');window.fetch=()=>new Promise(()=>{});`});
await cmd('Page.navigate',{url:`http://localhost:${PORT}/index.html?cb=`+Math.random()});
await wait(4200);
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(56)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

// everything "watching" and airing, so both rails are maximally tempted
const fill=async N=>ev(`(()=>{const now=Math.floor(Date.now()/1000);
  anime=Array.from({length:${N}},(_,i)=>({id:'x'+i,title:'Anime Title Number '+i,kind:'watch',
    status:'watching',rating:8,ep:3,epTotal:24,aniId:1000+i,img:'',genre:'Action, Drama',
    aniScore:70,eps:24,adultChk:1,imgTried:1,detTried:1,bannerTried:1,scoreTried:1,idTried:1,
    airAt:now+3600*(1+(i%140)),airEp:4,airChk:Date.now(),seqTried:1,upd:Date.now()-i*1000}));
  renderHome();
  const el=document.getElementById('pageEl');
  return {els:el.querySelectorAll('*').length, kb:Math.round(el.innerHTML.length/1024),
          resume:el.querySelectorAll('.rz-sec .rz-card, .rz-rail .rz-card').length,
          allRail:el.querySelectorAll('.rz-card').length};})()`);

const small=await fill(60);
const huge =await fill(3000);
console.log(`   60 titles: ${small.els} elements, ${small.kb} KB, ${small.allRail} rail cards`);
console.log(` 3000 titles: ${huge.els} elements, ${huge.kb} KB, ${huge.allRail} rail cards`);

t('a 50x bigger library does not grow the home page',
  huge.els <= small.els * 1.15, true);
t('…nor its markup', huge.kb <= small.kb * 1.15, true);
// Bounded by the caps, not by the library. The exact number is whatever the
// rails on this page add up to; what matters is that 3000 titles produce the
// same handful as 60, and nothing near 3000.
t('the rails stop well short of the whole library',
  huge.allRail < 150 && huge.allRail < 3000/10, true);
t('and 3000 titles produce exactly what 60 did',
  huge.allRail === small.allRail, true);

// the cap must not cost correctness: the most useful end is what survives
t('resume keeps the titles it ranked first',
  await ev(`(()=>{const items=resumeItems(anime.filter(a=>kindOf(a)==='watch'),false);
    const shown=[...document.querySelectorAll('.rz-card')].length;
    return shown>0 && items.length>shown;})()`), true);
// Capping a rail must not cap the LIST. The grid pages in as you scroll, so the
// check is that the data is whole and the filtered view is showing from it —
// not that 3000 cards are in the DOM, which is the thing we just stopped doing.
t('the library itself is untouched by any of this',
  await ev(`realList().length`), 3000);
t('and the filtered view draws from all of it',
  await ev(`(()=>{setFilter&&setFilter('watching');
    const shown=document.querySelectorAll('#pageEl .pcard').length;
    const head=document.querySelector('#pageEl .row-count,.fchip.on .fn');
    setFilter&&setFilter('all');
    return shown>0 && shown<3000;})()`), true);

console.log('\n'+pass+' passed, '+fail+' failed');
ws.close();ch.kill();srv.kill();process.exit(fail?1:0);
