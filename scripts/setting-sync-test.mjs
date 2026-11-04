import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let src=readFileSync('index.html','utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/,'const NETWORK_GATE=false;');
const list=[{id:'a',kind:'watch',status:'watching',title:'T',ep:1,epTotal:12,dur:24}];
const seed={wl_net_status:'approved',seen_release:(src.match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9'])[1],seen_msg:'1',
 animelist_v4:JSON.stringify(list),onboarded_animelist_v4:'1',tut_seen_animelist_v4:'1',
 backupoff_animelist_v4:'1',backup_nudge_animelist_v4:'1',sync_code:'TESTCODE1234567890AB'};
const inject='<script>try{'+Object.entries(seed).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')+'}catch(e){}</script>';
const suite=function(){
  const out=[];
  let pushes=0;
  window.schedulePush=function(){pushes++;};      // count intent, don't hit the network
  const n=()=>{const v=pushes;pushes=0;return v;};
  n();
  applyTheme('naruto');               out.push('picking a theme pushes: '+(n()>0));
  setAccent('#5ed47a');               out.push('changing the accent pushes: '+(n()>0));
  setDensity('large');                out.push('changing card size pushes: '+(n()>0));
  try{setGlow('theme');}catch(e){}    out.push('changing the glow pushes: '+(n()>0));
  try{setBgBright(40);}catch(e){}     out.push('changing brightness pushes: '+(n()>0));
  try{setStatusColor('watching','#ff0000');}catch(e){} out.push('changing a status colour pushes: '+(n()>0));
  try{setLooseFrame('example.com',true);}catch(e){}    out.push('allowing a site pushes: '+(n()>0));
  localStorage.setItem('some_future_setting','1');     out.push('a setting that does not exist yet pushes: '+(n()>0));
  localStorage.setItem('sync_code','X');               out.push('sync bookkeeping does NOT push: '+(n()===0));
  localStorage.setItem('animelist_v4','[]');           out.push('the list itself does NOT push here: '+(n()===0));
  applyExtra({animetheme:'naruto',bg_bright:'10'});    out.push('applying the cloud’s settings does NOT push back: '+(n()===0));
  // ── per-device facts must not travel ──────────────────────────────────
  // collectExtra() uploads every key syncSkip() does not refuse, and applyExtra()
  // writes them onto every other device. wl_adopt_seen is "the newest decision I
  // have already applied": shared, a stale device overwrote the Mac's value, the
  // Mac then found an adopt stamp it had already honoured to be newer than what
  // it now believed it had seen, and took that old list whole — on a loop. The
  // guard was meant to fire once per device.
  const PER_DEVICE=['wl_adopt_seen','wl_prepush_backup','wl_device','wl_admin_token',
                    'wl_admin_ck','wl_net_status','wl_invite','wl_errs','wl_img_bytes',
                    'wl_booted','wl_rail_folded','wl_seekok','wl_pos',
                    // where this device went, and what is half-typed on this screen
                    'ext_watch','src_draft','src_tab'];
  PER_DEVICE.forEach(k=>{ try{localStorage.setItem(k,'x');}catch(e){} });
  const carried=PER_DEVICE.filter(k=>!syncSkip(k));
  out.push('no per-device key is allowed to sync ('+(carried.join(',')||'none')+'): '+(carried.length===0));
  const bundle=collectExtra();
  const leaked=PER_DEVICE.filter(k=>k in bundle);
  out.push('and none of them is in the pushed bundle ('+(leaked.join(',')||'none')+'): '+(leaked.length===0));

  // The one that cost him the list, stated on its own so a future edit that
  // re-admits it fails with its name on the row.
  out.push('a device keeps its own record of which decision it applied: '+(syncSkip('wl_adopt_seen')===true));
  out.push('and its own identity: '+(syncSkip('wl_device')===true));

  // Arriving settings must not be able to rewrite them either.
  try{localStorage.setItem('wl_adopt_seen','111');}catch(e){}
  applyExtra({wl_adopt_seen:'1',wl_device:'someone-else',animetheme:'naruto'});
  out.push('an incoming push cannot move this device\u2019s adopt marker: '+(localStorage.getItem('wl_adopt_seen')==='111'));
  out.push('nor take over its identity: '+(localStorage.getItem('wl_device')!=='someone-else'));

  // ...without turning into a blanket refusal: real settings still travel.
  out.push('your sources still sync: '+(syncSkip('wl_sources')===false));
  out.push('your theme still syncs: '+(syncSkip('animetheme')===false));
  out.push('your archive still syncs: '+(syncSkip('wl_archive')===false));
  out.push('deletions still sync: '+(syncSkip('wl_tombs')===false));

  const pre=document.createElement('pre');pre.id='S';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
};
const i=src.lastIndexOf('</body>');
src=src.slice(0,i)+`<script>addEventListener('load',()=>setTimeout(()=>{try{(${suite.toString()})()}catch(e){const p=document.createElement('pre');p.id='S';p.textContent=JSON.stringify(['ERR '+e.message]);document.body.appendChild(p)}},1000))<\/script>`+src.slice(i);
mkdirSync('.preview',{recursive:true});writeFileSync('.preview/ss.html',src.replace('<script',inject+'<script'));
const srv=spawn('python3',['-m','http.server','8995'],{stdio:'ignore',detached:true});
await new Promise(r=>setTimeout(r,900));
let dom='';try{dom=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox','--virtual-time-budget=15000','--window-size=430,900','--dump-dom','http://127.0.0.1:8995/.preview/ss.html'],{encoding:'utf8',maxBuffer:1<<28}).stdout||''}finally{process.kill(-srv.pid)}
const m=/<pre id="S">([\s\S]*?)<\/pre>/.exec(dom);
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
const rows=JSON.parse(dec(m[1]));
let bad=0; rows.forEach(r=>{const ok=/: true$/.test(r); if(!ok)bad++; console.log((ok?'  ok   ':'  FAIL ')+r.replace(/: true$|: false$/,''));});
console.log(bad?`\n${bad} failed`:'\nevery setting reaches the cloud, and none bounce back');
process.exit(bad?1:0);
