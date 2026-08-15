import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let src=readFileSync('index.html','utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/,'const NETWORK_GATE=false;');
const seed={wl_net_status:'approved',seen_release:(src.match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9'])[1],seen_msg:'1',
  animelist_v4:JSON.stringify([{id:'a',kind:'watch',status:'watching',title:'Test',ep:3,epTotal:12,dur:24,genre:'Action'}]),
  onboarded_animelist_v4:'1',tut_seen_animelist_v4:'1',backupoff_animelist_v4:'1',backup_nudge_animelist_v4:'1'};
const inject='<script>try{'+Object.entries(seed).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')+'}catch(e){}</script>';
const suite=function(){
  const R=[];
  const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return .2126*r+.7152*g+.0722*b};
  const parse=s=>{const m=/rgba?\(([^)]+)\)/.exec(s);if(!m)return null;const p=m[1].split(',').map(parseFloat);return {c:[p[0],p[1],p[2]],a:p.length>3?p[3]:1}};
  const over=(fg,bg)=>fg.a>=1?fg.c:fg.c.map((v,i)=>v*fg.a+bg[i]*(1-fg.a));
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return ((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05))};
  // A gradient reports backgroundColor as transparent, so walking up found the
  // dark page behind an accent-filled button and called near-black-on-orange
  // invisible. Read the gradient's own stops instead.
  function gradStops(bi){
    if(!bi||bi==='none'||!/gradient/.test(bi))return null;
    const stops=[...bi.matchAll(/rgba?\(([^)]+)\)/g)].map(m=>m[1].split(',').map(parseFloat));
    return stops.length?stops:null;
  }
  function bgOf(el){
    let n=el;
    while(n&&n!==document.documentElement){
      const cs=getComputedStyle(n);
      const g=gradStops(cs.backgroundImage);
      if(g){ // the worst stop is the one that has to pass
        return g.map(p=>[p[0],p[1],p[2]]);
      }
      const b=parse(cs.backgroundColor); if(b&&b.a>0.55)return [b.c];
      n=n.parentElement;
    }
    return [[10,10,12]];
  };
  // Only what is on screen can be measured, and most of the app lives in sheets.
  const SCREENS=[['home',()=>window.closeAll&&window.closeAll()],
    ['stats',()=>window.openStats()],['settings',()=>window.openSheet('settingsSheet')],
    ['sources',()=>window.openSheet('sourceSheet')],['paint',()=>window.startPaint()],
    ['detail',()=>window.openDetail(anime[0].id)],['add',()=>window.openSheet('addSheet')],
    ['friends',()=>window.openHub()],['schedule',()=>window.openSchedule()],['for you',()=>window.openForYou()]];
  // 'retro' was in this list as a theme and is not one any more — it was being
  // applied as a value nothing matches, so that pass measured the default palette
  // twice and told us nothing. It is a MODE now, which multiplies the surface
  // rather than adding to it: the treatment recolours borders, captions and
  // cursors from whichever theme it is sitting on, so every theme has to be
  // checked with it off AND on.
  const THEMES=['default','naruto','sasuke','luffy','sanji','zoro','chopper'];
  const MODES=[false,true];
  R.themes=THEMES.length*MODES.length;
  THEMES.forEach(t=>{
   MODES.forEach(rm=>{
    window.applyTheme(t);
    try{window.setRetroMode(rm);}catch(e){}
    // A swallowed failure here would mean every theme is measured twice with the
    // mode OFF and the run still reports success — the worst kind of green.
    if(rm&&document.documentElement.hasAttribute('data-retro'))R.modeOn=(R.modeOn||0)+1;
    const tag=t+(rm?'+retro':'');
    SCREENS.forEach(([nm,open])=>{
    try{open()}catch(e){}
    document.querySelectorAll('body *').forEach(el=>{
      const r=el.getBoundingClientRect(); if(r.width<4||r.height<4)return;
      const txt=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim().length>1);
      if(!txt.length)return;
      const cs=getComputedStyle(el); const f=parse(cs.color); if(!f)return;
      const bgs=bgOf(el);
      let cr=Infinity,bg=bgs[0];
      bgs.forEach(b=>{const c=ratio(over(f,b),b); if(c<cr){cr=c;bg=b;}});
      const size=parseFloat(cs.fontSize), bold=(parseInt(cs.fontWeight)||400)>=700;
      const need=(size>=24||(size>=18.66&&bold))?3:4.5;
      if(cr<need) R.push(tag+' @'+nm+' | '+cr.toFixed(2)+'/'+need+' | '+Math.round(size)+'px | .'+(el.className||'').toString().split(' ')[0]+' | "'+txt[0].textContent.trim().slice(0,26)+'"');
    });
    });
   });
  });
  try{window.setRetroMode(false);}catch(e){}
  window.applyTheme('default');
  const pre=document.createElement('pre');pre.id='C';pre.textContent=JSON.stringify({rows:[...new Set(R)],themes:THEMES.length*MODES.length,modeOn:R.modeOn||0});document.body.appendChild(pre);
};
const i=src.lastIndexOf('</body>');
src=src.slice(0,i)+`<script>addEventListener('load',()=>setTimeout(()=>{try{(${suite.toString()})()}catch(e){const p=document.createElement('pre');p.id='C';p.textContent=JSON.stringify(['CRASH '+e.message]);document.body.appendChild(p)}},800))<\/script>`+src.slice(i);
mkdirSync('.preview',{recursive:true});writeFileSync('.preview/contrast.html',src.replace('<script',inject+'<script'));
const srv=spawn('python3',['-m','http.server','8975'],{stdio:'ignore',detached:true});
await new Promise(r=>setTimeout(r,900));
let dom='';try{dom=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--virtual-time-budget=25000','--window-size=430,900','--dump-dom','http://127.0.0.1:8975/.preview/contrast.html'],{encoding:'utf8',maxBuffer:1<<28}).stdout||''}finally{process.kill(-srv.pid)}
const m=/<pre id="C">([\s\S]*?)<\/pre>/.exec(dom);
if(!m){console.log('no result');process.exit(2)}
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
const parsed=JSON.parse(dec(m[1]));
const rows=Array.isArray(parsed)?parsed:parsed.rows;
const nThemes=Array.isArray(parsed)?'?':parsed.themes;
const modeOn=Array.isArray(parsed)?0:(parsed.modeOn||0);
if(!modeOn)console.log('WARNING: retro mode never engaged — those passes measured nothing new');
else console.log(`retro mode engaged in ${modeOn} passes`);
console.log(rows.length?rows.join('\n'):`every text/background pair clears WCAG AA across ${nThemes} theme/mode combinations`);
console.log('\n'+rows.length+' failing pair(s)');
