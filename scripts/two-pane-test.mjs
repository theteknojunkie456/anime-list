import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let src=readFileSync('index.html','utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/,'const NETWORK_GATE=false;');
const list=[];for(let i=0;i<8;i++)list.push({id:'p'+i,kind:'watch',status:['watching','plan'][i%2],title:'T'+i,ep:3,epTotal:12,dur:24});
const seed={wl_net_status:'approved',seen_release:(src.match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9'])[1],seen_msg:'1',
 animelist_v4:JSON.stringify(list),onboarded_animelist_v4:'1',tut_seen_animelist_v4:'1',backupoff_animelist_v4:'1',backup_nudge_animelist_v4:'1'};
const inject='<script>try{'+Object.entries(seed).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')+'}catch(e){}</script>';
const suite=function(){
  const out=[];
  const app=()=>document.getElementById('app');
  openDetail(anime[0].id);
  out.push('two-pane active: '+document.documentElement.classList.contains('two-pane'));
  out.push('list still clickable (not inert): '+!app().hasAttribute('inert'));
  const card=document.querySelector('#pageEl .pcard');
  let opened=false;
  if(card){ try{ card.click(); opened=true; }catch(e){} }
  out.push('clicking another title works while the panel is open: '+opened);
  closeAll();
  openSheet('settingsSheet');
  out.push('a real modal still blocks the page: '+app().hasAttribute('inert'));
  closeAll();
  out.push('page is usable again after closing: '+!app().hasAttribute('inert'));
  const pre=document.createElement('pre');pre.id='M';pre.textContent=JSON.stringify(out);document.body.appendChild(pre);
};
const i=src.lastIndexOf('</body>');
src=src.slice(0,i)+`<script>addEventListener('load',()=>setTimeout(()=>{try{(${suite.toString()})()}catch(e){const p=document.createElement('pre');p.id='M';p.textContent=JSON.stringify(['ERR '+e.message]);document.body.appendChild(p)}},900))<\/script>`+src.slice(i);
mkdirSync('.preview',{recursive:true});writeFileSync('.preview/mid.html',src.replace('<script',inject+'<script'));
const srv=spawn('python3',['-m','http.server','8993'],{stdio:'ignore',detached:true});
await new Promise(r=>setTimeout(r,900));
let dom='';try{dom=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox','--virtual-time-budget=15000','--window-size=1440,900','--dump-dom','http://127.0.0.1:8993/.preview/mid.html'],{encoding:'utf8',maxBuffer:1<<28}).stdout||''}finally{process.kill(-srv.pid)}
const m=/<pre id="M">([\s\S]*?)<\/pre>/.exec(dom);
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
JSON.parse(dec(m[1])).forEach(l=>console.log('  '+l));
