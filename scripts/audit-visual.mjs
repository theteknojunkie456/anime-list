import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let src=readFileSync('index.html','utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/,'const NETWORK_GATE=false;');
const list=[];for(let i=0;i<24;i++)list.push({id:'p'+i,kind:'watch',status:['watching','plan','finished','dropped'][i%4],title:'Title '+i,ep:i%25,epTotal:25,dur:24,genre:'Action',upd:999-i});
const seed={wl_net_status:'approved',seen_release:(src.match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9'])[1],seen_msg:'1',
  animelist_v4:JSON.stringify(list),onboarded_animelist_v4:'1',tut_seen_animelist_v4:'1',backupoff_animelist_v4:'1',backup_nudge_animelist_v4:'1'};
const inject='<script>try{'+Object.entries(seed).map(([k,v])=>`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')+'}catch(e){}</script>';
const suite=function(){
  const tally=(arr)=>{const m={};arr.forEach(v=>m[v]=(m[v]||0)+1);return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
  const vis=[...document.querySelectorAll('#app *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>8&&r.height>8;});
  const R={};
  R.radius=tally(vis.map(e=>getComputedStyle(e).borderRadius).filter(v=>v&&v!=='0px'));
  const textEls=vis.filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
  R.size=tally(textEls.map(e=>getComputedStyle(e).fontSize));
  // which class owns each size, so a ramp can be applied without guessing
  R.sizeOwners={};
  textEls.forEach(e=>{const z=getComputedStyle(e).fontSize;const c=(e.className||'').toString().split(' ')[0]||e.tagName.toLowerCase();
    (R.sizeOwners[z]=R.sizeOwners[z]||new Set()).add(c);});
  Object.keys(R.sizeOwners).forEach(k=>R.sizeOwners[k]=[...R.sizeOwners[k]].slice(0,7));
  R.weightOwners={};
  textEls.forEach(e=>{const w=getComputedStyle(e).fontWeight;const c=(e.className||'').toString().split(' ')[0]||e.tagName.toLowerCase();
    (R.weightOwners[w]=R.weightOwners[w]||new Set()).add(c);});
  Object.keys(R.weightOwners).forEach(k=>R.weightOwners[k]=[...R.weightOwners[k]].slice(0,10));
  R.weight=tally(vis.filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>getComputedStyle(e).fontWeight));
  R.shadow=tally(vis.map(e=>getComputedStyle(e).boxShadow).filter(v=>v&&v!=='none').map(v=>v.slice(0,46)));
  R.borders=tally(vis.map(e=>{const s=getComputedStyle(e);return s.borderTopWidth+' '+s.borderTopColor;}).filter(v=>!/^0px/.test(v)));
  // elements wearing background + border + shadow all at once
  R.triple=vis.filter(e=>{const s=getComputedStyle(e);
    return s.backgroundColor!=='rgba(0, 0, 0, 0)'&&s.borderTopWidth!=='0px'&&s.boxShadow!=='none';})
    .map(e=>(e.className||'').toString().split(' ')[0]).filter(Boolean);
  R.triple=tally(R.triple);
  const pre=document.createElement('pre');pre.id='A';pre.textContent=JSON.stringify(R);document.body.appendChild(pre);
};
const i=src.lastIndexOf('</body>');
src=src.slice(0,i)+`<script>addEventListener('load',()=>setTimeout(()=>{try{(${suite.toString()})()}catch(e){const p=document.createElement('pre');p.id='A';p.textContent=JSON.stringify({err:e.message});document.body.appendChild(p)}},1000))<\/script>`+src.slice(i);
mkdirSync('.preview',{recursive:true});writeFileSync('.preview/audit.html',src.replace('<script',inject+'<script'));
const srv=spawn('python3',['-m','http.server','8985'],{stdio:'ignore',detached:true});
await new Promise(r=>setTimeout(r,900));
let dom='';try{dom=spawnSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--virtual-time-budget=20000','--window-size=430,900','--dump-dom','http://127.0.0.1:8985/.preview/audit.html'],{encoding:'utf8',maxBuffer:1<<28}).stdout||''}finally{process.kill(-srv.pid)}
const m=/<pre id="A">([\s\S]*?)<\/pre>/.exec(dom);
if(!m){console.log('no result');process.exit(2)}
const dec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
const R=JSON.parse(dec(m[1]));
const show=(t,rows,n=10)=>{console.log('\n  '+t+'  ('+rows.length+' distinct)');rows.slice(0,n).forEach(([v,c])=>console.log('   '+String(c).padStart(4)+'  '+v));};
console.log('\n  text sizes, and who uses them');
Object.entries(R.sizeOwners).sort((a,b)=>parseFloat(b[0])-parseFloat(a[0])).forEach(([z,cs])=>console.log('   '+z.padStart(7)+'  '+cs.join(', ')));
console.log('\n  weights, and who uses them');
Object.entries(R.weightOwners).sort((a,b)=>+b[0]-+a[0]).forEach(([w,cs])=>console.log('   '+w.padStart(7)+'  '+cs.join(', ')));
show('corner radii',R.radius);
show('text sizes',R.size);
show('font weights',R.weight);
show('shadows',R.shadow,6);
show('border widths+colours',R.borders,6);
show('background + border + shadow all at once',R.triple,8);
