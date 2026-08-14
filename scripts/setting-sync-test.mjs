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
  applyTheme('retro');                out.push('picking a theme pushes: '+(n()>0));
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
