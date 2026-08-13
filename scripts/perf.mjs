#!/usr/bin/env node
// Where the time actually goes.
//
// "Laggy" has three different causes in a single-file app like this and they
// need different fixes, so guessing is expensive: a slow render (JS building
// markup), a slow paint (effects the compositor re-does every frame), or a slow
// scroll (layout thrash and continuous animation). This measures all three
// against a library the size of a real one.
//
//   node scripts/perf.mjs [titles]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const N = +(process.argv[2] || 200);
const PORT = 8981;

const suite = function () {
  const R = { render: [], notes: [], counts: {}, frames: {} };
  // Wall-clock is a lie in here: --virtual-time-budget advances the clock in
  // jumps, so performance.now() deltas come back as 0ms or 1000ms with no
  // relation to real work. Count the work instead — how many nodes an
  // interaction actually replaces. That is exactly what was making taps
  // expensive, and it is measurable no matter what the clock says.
  function churn(label, fn) {
    let n = 0;
    const ob = new MutationObserver(ms => ms.forEach(m => { n += m.addedNodes.length + m.removedNodes.length; }));
    ob.observe(document.getElementById('pageEl') || document.body, { childList: true, subtree: true });
    try { fn(); } catch (e) { }
    ob.takeRecords().forEach(m => { n += m.addedNodes.length + m.removedNodes.length; });
    ob.disconnect();
    R.taps[label] = n;
  }
  R.taps = {};
  churn('fullRender', () => window.render());
  if (window.setDensity) churn('cardSize', () => { window.setDensity('large'); window.setDensity('comfy'); });
  if (window.setAccent) churn('accent', () => { window.setAccent('#5ed47a'); window.setAccent(''); });
  const first = document.querySelector('#pageEl .pcard');
  const fid = first && /pcTap\('([^']+)'/.exec(first.getAttribute('onclick') || '');
  if (fid && window.startSelect) churn('select', () => { window.startSelect(fid[1]); window.bulkClear(); });

  R.counts.nodes = document.querySelectorAll('*').length;
  R.counts.cards = document.querySelectorAll('#pageEl .pcard').length;
  R.counts.images = document.querySelectorAll('img').length;
  R.counts.imgNoLazy = [...document.querySelectorAll('img')].filter(i => i.loading !== 'lazy').length;
  R.counts.imgNoDims = [...document.querySelectorAll('img')].filter(i => !i.width && !i.getAttribute('width') && !/width/.test(i.style.cssText || '')).length;

  // ── effects the compositor pays for on every single frame ──
  const all = [...document.querySelectorAll('body *')];
  const vis = all.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const styled = (sel, test) => vis.filter(e => test(getComputedStyle(e)));
  R.counts.backdrop = styled('', s => s.backdropFilter && s.backdropFilter !== 'none').length;
  R.counts.filter = styled('', s => s.filter && s.filter !== 'none').length;
  R.counts.willChange = styled('', s => s.willChange && s.willChange !== 'auto').length;
  R.counts.animating = styled('', s => s.animationName && s.animationName !== 'none' && s.animationIterationCount === 'infinite').length;
  R.counts.bigShadow = styled('', s => /(\d{2,})px/.test(s.boxShadow || '')).length;

  // name the worst offenders, not just the count
  R.notes = vis.filter(e => {
    const s = getComputedStyle(e);
    return (s.backdropFilter && s.backdropFilter !== 'none') ||
      (s.animationIterationCount === 'infinite' && s.animationName !== 'none');
  }).slice(0, 12).map(e => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)}` +
      (s.backdropFilter !== 'none' ? ' backdrop:' + s.backdropFilter : '') +
      (s.animationIterationCount === 'infinite' ? ' anim:' + s.animationName : '');
  });

  // ── frame timing under a scroll, which is where "not snappy" lives ──
  const pg = document.getElementById('pageEl') || document.scrollingElement;
  let last = performance.now(), worst = 0, n = 0, over16 = 0;
  const tick = () => {
    const now = performance.now(), d = now - last; last = now;
    if (n++) { if (d > worst) worst = d; if (d > 16.7) over16++; }
    if (n < 90) { pg.scrollTop += 40; requestAnimationFrame(tick); }
    else {
      R.frames = { sampled: n, worstMs: +worst.toFixed(1), overBudget: over16 };
      const pre = document.createElement('pre'); pre.id = 'P';
      pre.textContent = JSON.stringify(R);
      document.body.appendChild(pre);
    }
  };
  requestAnimationFrame(tick);
};

let src = readFileSync('index.html', 'utf8').replace(/const NETWORK_GATE\s*=\s*[^;]+;/, 'const NETWORK_GATE=false;');
const list = [];
for (let i = 0; i < N; i++) list.push({
  id: 'p' + i, kind: i % 7 === 0 ? 'read' : 'watch',
  status: ['watching', 'plan', 'finished', 'dropped'][i % 4],
  title: 'A Title Of Reasonable Length ' + i, ep: i % 25, epTotal: 25, dur: 24,
  genre: ['Action', 'Drama', 'Comedy'][i % 3], fav: i % 9 === 0, upd: 9999 - i,
  aniColor: '#7a3b2e',
});
const seed = {
  wl_net_status: 'approved', seen_release: (src.match(/const RELEASE=\{\s*v:'([^']+)'/) || [, '9'])[1],
  seen_msg: '1', animelist_v4: JSON.stringify(list),
  onboarded_animelist_v4: '1', tut_seen_animelist_v4: '1',
  backupoff_animelist_v4: '1', backup_nudge_animelist_v4: '1',
};
const inject = '<script>try{' + Object.entries(seed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('') + '}catch(e){}</script>';
const i = src.lastIndexOf('</body>');
src = src.slice(0, i) + `<script>addEventListener('load',()=>setTimeout(()=>{try{(${suite.toString()})()}catch(e){const p=document.createElement('pre');p.id='P';p.textContent=JSON.stringify({err:e.message});document.body.appendChild(p)}},1200))<\/script>` + src.slice(i);
mkdirSync('.preview', { recursive: true });
writeFileSync('.preview/perf.html', src.replace('<script', inject + '<script'));

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 900));
let dom = '';
try {
  dom = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=30000', '--window-size=430,900', '--dump-dom',
    `http://127.0.0.1:${PORT}/.preview/perf.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout || '';
} finally { process.kill(-srv.pid); }
const m = /<pre id="P">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) { console.log('no result'); process.exit(2); }
const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const R = JSON.parse(dec(m[1]));
if (R.err) { console.log('crashed: ' + R.err); process.exit(2); }
console.log(`\n  ${N} titles\n`);
console.log('  nodes replaced by a full render()   ' + R.taps.fullRender);
console.log('  ...by changing card size            ' + R.taps.cardSize);
console.log('  ...by changing the accent           ' + R.taps.accent);
console.log('  ...by selecting one card            ' + R.taps.select);
console.log('  DOM nodes         ' + R.counts.nodes + '   cards ' + R.counts.cards);
console.log('  images            ' + R.counts.images + '   not lazy ' + R.counts.imgNoLazy + '   no dimensions ' + R.counts.imgNoDims);
console.log('  backdrop-filter   ' + R.counts.backdrop + ' visible');
console.log('  css filter        ' + R.counts.filter + ' visible');
console.log('  will-change       ' + R.counts.willChange + ' visible');
console.log('  infinite anims    ' + R.counts.animating + ' visible');
console.log('  huge box-shadows  ' + R.counts.bigShadow + ' visible');
console.log('  scroll frames     worst ' + R.frames.worstMs + 'ms, ' + R.frames.overBudget + '/' + R.frames.sampled + ' over 16.7ms');
if (R.notes.length) { console.log('\n  per-frame cost sits on:'); R.notes.forEach(n => console.log('   • ' + n)); }
console.log('');
