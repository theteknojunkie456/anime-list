#!/usr/bin/env node
// Boot the real app and check it actually works.
//
// Written after shipping a feature whose every code path threw ReferenceError on
// the first line. The logic had been tested in isolation and was correct; what
// was never tested was whether the code runs inside the app at all. Nothing in
// this file is clever — it is the check that was missing.
//
// The centrepiece is the handler audit: this app wires its UI through inline
// onclick="fn(...)" attributes, so a function that is out of scope fails at the
// moment of the click, silently, with no build step to catch it. Every handler
// name in the document is collected and asked whether it exists.
//
//   node scripts/smoke.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8973;

const list = [
  ['Attack on Titan', 'watching', 18, 25], ['ONE PIECE', 'watching', 214, 1100],
  ['Hunter x Hunter', 'watching', 96, 148], ['Demon Slayer', 'plan', 0, 26],
  ['Monster', 'plan', 0, 74], ['Jujutsu Kaisen', 'finished', 24, 24],
].map(([title, status, ep, epTotal], i) => ({
  id: 's' + i, kind: 'watch', status, title, titleEn: title,
  titleRo: title === 'Attack on Titan' ? 'Shingeki no Kyojin' : title,
  ep, epTotal, eps: epTotal + ' eps', dur: 24, adultChk: true, upd: 100 - i,
}));
const seed = {
  wl_net_status: 'approved', seen_release: '9999', seen_msg: '1',
  animelist_v4: JSON.stringify(list), onboarded_animelist_v4: '1',
  tut_seen_animelist_v4: '1', backupoff_animelist_v4: '1', backup_nudge_animelist_v4: '1',
};

const CHECKS = String.raw`
var R=[];
function ok(n,c,d){R.push({n:n,ok:!!c,d:d||''});}

ok('boots without errors', !window.__errs.length, window.__errs.join(' | '));
ok('home renders cards', document.querySelectorAll('#pageEl .pcard').length>0,
   document.querySelectorAll('#pageEl .pcard').length+' cards');

// Every inline handler name must resolve. This is the one that matters: an
// out-of-scope function here is invisible until someone clicks it.
var names={}, html=document.documentElement.innerHTML;
var re=/\bon(?:click|change|input|contextmenu|touchstart|touchend|touchmove|submit|keydown)="\s*([A-Za-z_$][\w$]*)\s*\(/g, m;
while((m=re.exec(html))) names[m[1]]=1;
// onkeydown="if(...)" makes 'if' look like a handler name. Keywords are not
// functions and never will be.
var KW={'if':1,'for':1,'while':1,'switch':1,'return':1,'try':1,'do':1,'new':1,
        'typeof':1,'void':1,'delete':1,'function':1,'this':1,'catch':1};
var missing=Object.keys(names).filter(function(f){ return !KW[f] && typeof window[f]!=='function'; });
ok('every inline handler exists', !missing.length, missing.length?('missing: '+missing.join(', ')):(Object.keys(names).length+' handlers'));

// Functions the app calls internally that are easy to leave out of scope.
var GLOBALS=['statusLabel','openBulkMenu','bulkToggle','bulkSetStatus','bulkBarHTML','searchScore',
             'airStage','subLagMins','artFallback','slugFromURL','siteSlugStyle','statusTag'];
var absent=GLOBALS.filter(function(f){return typeof window[f]!=='function';});
ok('core helpers in scope', !absent.length, absent.join(', '));

// Search has to find the things people actually type.
try{
  var find=function(q){var b=null,bs=0;(anime||[]).forEach(function(a){var s=searchScore(a,q);if(s>bs){bs=s;b=a;}});return b&&b.title;};
  ok('search: aot', find('aot')==='Attack on Titan', find('aot'));
  ok('search: shingeki', find('shingeki')==='Attack on Titan', find('shingeki'));
  ok('search: one pece (typo)', find('one pece')==='ONE PIECE', find('one pece'));
}catch(e){ ok('search runs', false, e.message); }

// The selection menu, end to end.
try{
  var c=document.querySelectorAll('#pageEl .pcard')[0];
  c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:200}));
  var menu=document.getElementById('bulkMenu');
  ok('right-click opens the menu', !!menu, menu?menu.querySelectorAll('.bulk-mi').length+' actions':'not open');
  ok('  on one card only', !(bulkSel&&bulkSel.size), bulkSel?bulkSel.size+' selected':'none');
  if(menu)menu.remove();
  closeBulkMenu();
}catch(e){ ok('right-click opens the menu', false, e.message); }

// Range selection.
try{
  // Home shows most titles in rails and a billboard, so the grid can be short.
  // Take whatever is there and expect the run between the two ends.
  var cs=document.querySelectorAll('#pageEl .pcard');
  var a=0, b=Math.min(cs.length-1,3), want=b-a+1;
  if(cs.length<2){ ok('shift-click selects a range', false, 'only '+cs.length+' cards to test with'); }
  else{
    cs[a].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,shiftKey:true}));
    cs[b].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,shiftKey:true}));
    ok('shift-click selects a range', bulkSel&&bulkSel.size===want, (bulkSel?bulkSel.size:0)+' of '+want+' expected');
  }
  ok('  selection bar appears', !!document.querySelector('.bulk-bar'));
  bulkClear();
}catch(e){ ok('shift-click selects a range', false, e.message); }

// The detail sheet opens and carries what it should.
try{
  openDetail((anime[0]||{}).id);
  var body=document.getElementById('detailBody')||document.body;
  ok('detail sheet opens', !!document.querySelector('#detailSheet.on'));
  ok('  deck present', !!body.querySelector('.dt-deck'));
  ok('  facts present', !!body.querySelector('.dt-facts'));
  closeAll();
}catch(e){ ok('detail sheet opens', false, e.message); }

ok('no errors after exercising', !window.__errs.length, window.__errs.join(' | '));
return R;
`;

let src = readFileSync('index.html', 'utf8');
src = src.replace(/const NETWORK_GATE\s*=\s*[^;]+;/, 'const NETWORK_GATE=false;');
const trap = '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push((e.message||"")+" @"+(e.lineno||"?"));});' +
  'window.addEventListener("unhandledrejection",function(e){window.__errs.push("promise: "+((e.reason&&e.reason.message)||e.reason));});' +
  'try{' + Object.entries(seed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('') + '}catch(e){}</script>';
const runner = `<script>setTimeout(function(){
  var out;try{out=(function(){${CHECKS}})();}catch(e){out=[{n:'checks ran',ok:false,d:e.message}];}
  var p=document.createElement('pre');p.id='__smoke';p.textContent=JSON.stringify(out);document.body.appendChild(p);
},3200);</script>`;

src = src.replace('<script', trap + '<script');
const tail = src.lastIndexOf('</body>');      // NOT the first: one appears inside a JS string
src = src.slice(0, tail) + runner + src.slice(tail);
mkdirSync('.preview', { recursive: true });
writeFileSync('.preview/smoke.html', src);

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 900));
let dom = '';
try {
  dom = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=12000',
    '--window-size=1200,900', '--dump-dom', `http://127.0.0.1:${PORT}/.preview/smoke.html`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '';
} finally { process.kill(-server.pid); rmSync('.preview', { recursive: true, force: true }); }

const m = /<pre id="__smoke">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) { console.error('smoke: the app did not report — it may not have booted'); process.exit(1); }
const results = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
// A file-system check, so it lives out here rather than in the page. The manifest
// promised a 512px icon that was not in the repo — the one icon Chrome requires
// before it offers to install a PWA — and nothing noticed, because nothing reads
// the manifest until an install prompt quietly fails to appear.
try {
  const mf = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const gone = (mf.icons || []).filter(i => !existsSync(i.src.replace(/^\.?\//, '')));
  results.push({ n: 'every manifest icon exists', ok: gone.length === 0, d: gone.map(g => g.src).join(', ') || (mf.icons || []).length + ' icons' });
} catch (e) {
  results.push({ n: 'manifest.json parses', ok: false, d: e.message });
}

// A source-level check, because the bug it catches never reaches the DOM in a
// test: it only fires for a title that happens to contain an apostrophe.
//
//   onclick="addPopular(1,'JoJo's Bizarre Adventure')"
//
// The HTML parser is happy — the attribute is double-quoted — and then the JS
// parser hits the apostrophe and throws "Unexpected identifier". It shipped
// twice from the discover list before an error log surfaced it. Any value going
// into a single-quoted argument must pass through a helper that escapes for
// BOTH parsers.
{
  const SAFE = /jsq\(|safeId\(|safeUrl\(|encodeURIComponent\(|replace\(\/'/;
  // Allowed because the value cannot contain a quote by construction: ids the
  // app mints itself (uid()), friend codes (alphanumeric), a hostname, and a
  // single character that has already had quotes stripped. Anything a person can
  // type is NOT on this list.
  const IDS = /^(escH\()?((\w+\.)?(id|code|key)|ch|h|forId|aniId|st|k|x|i|f|s|t|m|q|e)\)?$/;
  const bad2 = [];
  const raw = readFileSync('index.html', 'utf8');
  for (const mm of raw.matchAll(/on[a-z]+="[^"]*?'\$\{([^}]*)\}'/g)) {
    const expr = mm[1].trim();
    if (SAFE.test(expr)) continue;
    if (IDS.test(expr)) continue;
    // Values that come from hardcoded arrays in this file, not from anybody's
    // typing: the accent/tint swatch hexes and the onboarding sheet ids.
    if (expr === 'c' || expr === 'c.cta.sheet') continue;
    bad2.push(expr);
  }
  results.push({
    n: 'no user text lands raw in a JS argument',
    ok: bad2.length === 0,
    d: bad2.length ? [...new Set(bad2)].join(' · ') : 'all interpolations escaped or generated',
  });
}

// The type ramp and the radius scale, enforced. Fifteen text sizes crammed
// between 8.5px and 15px is what "cleaner" actually meant: sizes half a pixel
// apart cannot read as hierarchy, they read as misalignment. Six steps do the
// same job, and this fails the moment a seventh appears.
{
  const src2 = readFileSync('index.html', 'utf8');
  const SIZES = new Set(['10', '12', '13', '15', '17', '21', '24', '26', '27', '30', '34', '40', '46', '52', '120']);
  const RADII = new Set(['2', '6', '10', '14', '18', '26', '99']);
  const offSize = [...new Set([...src2.matchAll(/font-size:([0-9.]+)px/g)].map(m => m[1]).filter(v => !SIZES.has(v)))];
  const offRad = [...new Set([...src2.matchAll(/border-radius:([0-9]+)px/g)].map(m => m[1]).filter(v => !RADII.has(v)))];
  results.push({ n: 'text sizes stay on the ramp', ok: offSize.length === 0, d: offSize.length ? 'off-ramp: ' + offSize.join(', ') : SIZES.size + ' steps' });
  results.push({ n: 'corners stay on the scale', ok: offRad.length === 0, d: offRad.length ? 'off-scale: ' + offRad.join(', ') : RADII.size + ' steps' });
}

// The em dash. "Statement — explanation" is the most recognisable machine-written
// sentence shape in English right now, and this app had it in one string out of
// every seven. A person writing a toast writes two short sentences.
{
  const raw3 = readFileSync('index.html', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const strings = [...raw3.matchAll(/toast\(\s*[`'"]([^`'"]{6,})/g)].map(m => m[1])
    .concat([...raw3.matchAll(/>([A-Z][^<>{}]{8,90})</g)].map(m => m[1]));
  const dashed = strings.filter(t => t.includes('\u2014'));
  results.push({
    n: 'no em dashes in what the user reads',
    ok: dashed.length === 0,
    d: dashed.length ? dashed.slice(0, 4).map(t => t.trim().slice(0, 44)).join(' · ') : strings.length + ' strings clean',
  });
}

let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.n}${r.d ? '  —  ' + r.d : ''}`);
}
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
