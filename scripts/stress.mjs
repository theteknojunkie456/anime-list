#!/usr/bin/env node
// Stress the REAL app, headlessly, with data designed to break it.
//
// smoke.mjs reads the source and checks that things exist. This runs the app and
// checks that things WORK: it boots with a hostile library, presses every button
// it can find on every screen, cycles every appearance setting, and reports what
// threw, what overflowed, and what rendered as "undefined".
//
// It answers the question a screenshot cannot: is anything broken that nobody
// happens to be looking at?
//
//   node scripts/stress.mjs            # full run
//   node scripts/stress.mjs --quick    # skip the appearance matrix
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const QUICK = process.argv.includes('--quick');
const PORT = 8973;
// Chrome clamps a headless window to 500px, so anything narrower is rendered
// inside an iframe of the real width — same trick as preview.mjs.
const WIDTH = +(process.argv.find(a => /^--w=/.test(a)) || '--w=430').slice(4);

// ── the hostile library ─────────────────────────────────────────────────────
// Every field the app reads, absent or wrong somewhere. Real lists look like
// this: half-imported rows, titles with quotes in them, counts that disagree.
const HOSTILE = [
  { id: 'h1', kind: 'watch', status: 'watching', title: 'No episode count at all' },
  { id: 'h2', kind: 'watch', status: 'watching', title: 'Zero of zero', ep: 0, epTotal: 0 },
  { id: 'h3', kind: 'watch', status: 'watching', title: 'Past the end', ep: 999, epTotal: 12 },
  { id: 'h4', kind: 'watch', status: 'finished', title: 'Finished, no total', ep: 5 },
  { id: 'h5', kind: 'watch', status: 'dropped', title: 'Negative', ep: -3, epTotal: 24 },
  { id: 'h6', kind: 'read', status: 'watching', title: 'A manga with chapters', ep: 140, epTotal: 400 },
  { id: 'h7', kind: 'read', status: 'finished', title: 'Finished manga', ep: 60, epTotal: 60 },
  { id: 'h8', kind: 'watch', status: 'plan', title: `Quote " apostrophe ' angle <b> & amp` },
  { id: 'h9', kind: 'watch', status: 'plan', title: '日本語のタイトル・very long '.repeat(8) },
  { id: 'h10', kind: 'watch', status: 'plan', title: 'مرحبا RTL mixed with latin' },
  { id: 'h11', kind: 'watch', status: 'watching', title: 'Broken art', img: 'https://0.0.0.0/nope.jpg', bgImage: 'https://0.0.0.0/nope.jpg' },
  { id: 'h12', kind: 'watch', status: 'watching', title: 'Nulls', ep: null, epTotal: null, genre: null, rating: null, dur: null },
  { id: 'h13', kind: 'watch', status: 'finished', title: 'Rated high', rating: 5, ep: 12, epTotal: 12, dur: 24, genre: 'Action, Drama' },
  { id: 'h14', kind: 'watch', status: 'watching', title: 'Movie', epTotal: 1, ep: 0, dur: 117 },
  { id: 'h15', kind: 'watch', status: 'weird-status', title: 'Unknown status', ep: 2, epTotal: 5 },
  { id: 'h16', kind: 'watch', status: 'watching', title: 'Airing', ep: 3, epTotal: 12, dur: 24, airAt: Math.floor(Date.now() / 1000) + 7200, airEp: 4, genre: 'Comedy' },
  { id: 'h17', kind: 'watch', status: 'watching', title: 'Way behind', ep: 1, epTotal: 1100, dur: 24, airAt: Math.floor(Date.now() / 1000) + 600, airEp: 1080 },
  { id: 'h18', kind: 'watch', status: 'plan', title: 'Favourite', fav: true, epTotal: 26, dur: 24, genre: 'Fantasy' },
];

// The in-page suite. Serialized whole, so it must be self-contained.
function suite() {
  const R = { errors: [], warnings: [], checks: [], clicked: 0 };
  const err = (where, msg) => R.errors.push(where + ': ' + String(msg).slice(0, 220));
  const warn = (where, msg) => R.warnings.push(where + ': ' + String(msg).slice(0, 220));

  window.addEventListener('error', e => err('window.onerror', (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => err('unhandledrejection', (e.reason && e.reason.message) || e.reason));
  const _ce = console.error;
  console.error = function (...a) { err('console.error', a.join(' ')); _ce.apply(console, a); };

  const run = (label, fn) => { try { fn(); R.checks.push(label); } catch (e) { err(label, e && e.message); } };

  // ── invariants that must hold on whatever is currently rendered ──
  function scanDOM(where) {
    const root = document.body;
    // Text that leaked a placeholder instead of a value.
    const txt = root.innerText || '';
    ['undefined', 'NaN', '[object Object]', 'null%'].forEach(bad => {
      if (txt.includes(bad)) warn(where, 'rendered the literal "' + bad + '"');
    });
    // Nothing may push the page sideways.
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      // Naming the widest offender is the whole value of the check; "something
      // is 3px too wide" is not actionable.
      let worst = null, wr = 0;
      document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.right > wr) { wr = r.right; worst = el; }
      });
      warn(where, 'horizontal overflow: ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth +
        (worst ? ' — widest: <' + worst.tagName.toLowerCase() + ' class="' + (worst.className || '').toString().slice(0, 50) + '"> right=' + Math.round(wr) : ''));
    }
    // Anything that claims to be interactive must be reachable and labelled.
    root.querySelectorAll('button,[role=button]').forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;               // hidden is fine
      // textContent, not innerText: innerText is layout-dependent and comes back
      // empty for anything inside a sheet that is translated off-screen, which
      // made every control in every closed sheet look unlabelled.
      const name = (b.textContent || b.getAttribute('aria-label') || b.title || '').trim();
      if (!name && !b.querySelector('svg,img')) warn(where, 'a visible button has no label or icon: <' +
        b.tagName.toLowerCase() + ' class="' + (b.className || '') + '" onclick="' + (b.getAttribute('onclick') || '').slice(0, 40) + '">');
      if (r.height < 28 && r.width < 28) warn(where, 'tap target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' (' + (name || 'icon') + ')');
    });
  }

  // ── every inline handler actually resolves ──
  run('inline handlers resolve', () => {
    const missing = new Set();
    document.querySelectorAll('*').forEach(el => {
      for (const at of el.attributes || []) {
        if (!/^on/.test(at.name)) continue;
        (at.value.match(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(raw => {
          const fn = raw.replace(/[^\w$]/g, '');
          if (['if', 'for', 'while', 'return', 'function', 'catch', 'switch', 'typeof', 'new', 'delete', 'void', 'in', 'of'].includes(fn)) return;
          if (typeof window[fn] !== 'function' && typeof globalThis[fn] !== 'function') missing.add(fn);
        });
      }
    });
    if (missing.size) err('inline handlers', [...missing].join(', ') + ' not defined');
  });

  // ── the totals must agree with the library, not with a string field ──
  run('watched totals', () => {
    const T = window.libraryTotals(anime);
    if (!(T.eps > 0)) err('totals', 'episodes came out ' + T.eps);
    if (!(T.hrs > 0)) err('totals', 'hours came out ' + T.hrs + ' with ' + T.eps + ' episodes');
    if (!(T.chaps > 0)) err('totals', 'chapters came out ' + T.chaps + ' with reading items present');
    // A finished 12x24 title is 4.8h; the movie is 117 min. Hours must never be
    // wilder than every episode being a feature film.
    if (T.mins > T.eps * 200) err('totals', 'minutes implausible: ' + T.mins + ' over ' + T.eps + ' episodes');
    // Negative progress must not subtract from anyone's totals.
    if (window.epsDone({ status: 'watching', ep: -3 }) < 0) err('totals', 'negative episodes counted');
  });

  // ── progress can never leave the bar ──
  run('progress clamped', () => {
    anime.forEach(a => {
      const p = window.prog(a);
      if (!(p >= 0 && p <= 1)) err('prog', a.title + ' -> ' + p);
    });
  });

  // ── open every screen and sheet, and look at what came out ──
  const SCREENS = [
    ['home', () => window.closeAll && window.closeAll()],
    ['stats', () => window.openStats()],
    ['settings', () => window.openSheet('settingsSheet')],
    ['sources', () => window.openSheet('sourceSheet')],
    ['theme (simple)', () => { window.openSheet('themeSheet'); window.themeMode('simple'); }],
    ['theme (full)', () => { window.openSheet('themeSheet'); window.themeMode('full'); }],
    ['notifications', () => window.openSheet('notifySheet')],
    ['detail', () => window.openDetail(anime[0].id)],
    ['detail (manga)', () => window.openDetail('h6')],
    ['detail (nulls)', () => window.openDetail('h12')],
    ['add', () => window.openSheet('addSheet')],
    ['friends & party', () => window.openHub()],
    ['schedule', () => window.openSchedule()],
    ['for you', () => window.openForYou()],
  ];
  SCREENS.forEach(([name, open]) => {
    run('open ' + name, () => { open(); scanDOM(name); });
    try { window.closeAll && window.closeAll(); } catch (e) { }
  });

  // ── the search box, including inputs meant to break it ──
  run('search', () => {
    ['a', 'zzzzzz', '"', '\\', '.*', 'アニメ', '   ', 'aot', 'movie'].forEach(q => {
      const el = document.getElementById('search') || document.querySelector('input[type=search],.search input');
      if (!el) return;
      el.value = q;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const el = document.getElementById('search') || document.querySelector('input[type=search],.search input');
    if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });

  // ── selection: the phone path and the desktop path ──
  run('selection', () => {
    const id = anime[0].id, id2 = anime[3].id;
    window.startSelect(id);
    if (!window.bulkOn()) err('selection', 'startSelect left nothing selected');
    window.bulkToggle(id2, false);
    if (bulkSel.size !== 2) err('selection', 'a second tap gave ' + bulkSel.size);
    window.bulkToggle(id2, false);
    if (bulkSel.size !== 1) err('selection', 'tapping again did not deselect');
    window.bulkClear();
    if (window.bulkOn()) err('selection', 'clear left a selection');
  });

  // ── the menu a long-press opens, on one item and on many ──
  run('long-press menu', () => {
    window.openBulkMenu(20, 20, anime[1].id);
    const m = document.getElementById('bulkMenu');
    if (!m) return err('menu', 'nothing opened');
    if (!/Select more/.test(m.innerText)) err('menu', 'no way to start a multi-selection');
    const r = m.getBoundingClientRect();
    if (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1 || r.left < -1 || r.top < -1)
      err('menu', 'opened outside the window');
    window.closeBulkMenu();
  });

  // ── press everything that is visible, and see if anything throws ──
  if (!window.__QUICK) run('press every visible control', () => {
    const seen = new Set();
    for (let pass = 0; pass < 2; pass++) {
      const btns = [...document.querySelectorAll('button,[role=button]')].filter(b => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      for (const b of btns) {
        const key = (b.getAttribute('onclick') || '') + '|' + (b.innerText || '').slice(0, 20);
        if (seen.has(key)) continue;
        seen.add(key);
        // Anything that leaves the page or wipes data is not this test's job.
        const oc = b.getAttribute('onclick') || '';
        if (/reset|wipe|clear(All|Data)|delete|signOut|logout|export|import|share|resetTheme/i.test(oc)) continue;
        try { b.click(); R.clicked++; } catch (e) { err('click ' + oc.slice(0, 40), e && e.message); }
      }
      try { window.closeAll && window.closeAll(); } catch (e) { }
    }
    scanDOM('after pressing everything');
  });

  // ── every appearance the user can choose ──
  if (!window.__QUICK) run('appearance matrix', () => {
    const themes = ['default', 'naruto', 'sasuke', 'luffy', 'sanji', 'zoro', 'chopper'];
    const views = ['grid', 'list', 'cinema'];
    const eds = ['standard', 'focus', 'tv', 'pro'];
    const dens = ['compact', 'comfy', 'large'];
    themes.forEach(t => { window.applyTheme(t); scanDOM('theme ' + t); });
    window.applyTheme('default');
    views.forEach(v => { window.setLayoutView(v); scanDOM('view ' + v); });
    window.setLayoutView('grid');
    eds.forEach(e => { window.setEdition(e); scanDOM('edition ' + e); });
    window.setEdition('standard');
    dens.forEach(d => { window.setDensity(d); scanDOM('density ' + d); });
    window.setDensity('comfy');
    ['soft', 'sharp', 'round'].forEach(u => { window.setUiStyle(u); scanDOM('ui ' + u); });
    window.setUiStyle('soft');
    ['natural', 'cinematic'].forEach(a => { window.setArtMode(a); scanDOM('art ' + a); });
    window.setArtMode('natural');
    ['adaptive', 'theme', 'off'].forEach(g => { window.setGlow(g); });
    window.setGlow('adaptive');
    window.setAccent('#3fb6c9'); window.setTint('#1f2b4a'); window.setAccent(''); window.setTint('');
  });

  // ── the keyboard has to be able to drive the list ──
  run('keyboard', () => {
    window.closeAll && window.closeAll();
    const key = (k, opts) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, opts || {})));
    ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Escape', '/', 'Enter'].forEach(k => key(k));
    key('Escape');
    // Focus must land somewhere visible, not on a hidden control in a closed sheet.
    const f = document.activeElement;
    if (f && f !== document.body) {
      const r = f.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) warn('keyboard', 'focus landed on something with no box: ' + f.className);
    }
    scanDOM('after keyboard');
  });

  // ── an empty library must not be an error state ──
  run('empty library', () => {
    const keep = anime.slice();
    anime.length = 0;
    try { window.render(); scanDOM('empty'); window.openStats(); scanDOM('empty stats'); }
    finally { anime.length = 0; keep.forEach(x => anime.push(x)); try { window.closeAll(); window.render(); } catch (e) { } }
  });

  // ── a large library must still render ──
  run('500 titles', () => {
    const keep = anime.slice();
    const big = [];
    for (let i = 0; i < 500; i++) big.push({ id: 'big' + i, kind: 'watch', status: ['watching', 'plan', 'finished', 'dropped'][i % 4], title: 'Title number ' + i, ep: i % 25, epTotal: 25, dur: 24, genre: 'Action' });
    anime.length = 0; big.forEach(x => anime.push(x));
    const t0 = performance.now();
    try { window.render(); } finally { }
    const ms = performance.now() - t0;
    R.checks.push('500 titles rendered in ' + Math.round(ms) + 'ms');
    if (ms > 3000) warn('performance', 'rendering 500 titles took ' + Math.round(ms) + 'ms');
    scanDOM('500 titles');
    anime.length = 0; keep.forEach(x => anime.push(x)); try { window.render(); } catch (e) { }
  });

  // ── settings must survive a round trip through storage ──
  run('settings persist', () => {
    window.setAccent('#5ed47a'); window.setDensity('large'); window.setLayoutView('list');
    if (window.accentOverride().toLowerCase() !== '#5ed47a') err('persist', 'accent did not stick');
    if (window.density() !== 'large') err('persist', 'density did not stick');
    if (window.layoutView() !== 'list') err('persist', 'layout did not stick');
    window.setAccent(''); window.setDensity('comfy'); window.setLayoutView('grid');
  });

  R.width = window.innerWidth;
  const pre = document.createElement('pre');
  pre.id = 'STRESS_RESULT';
  pre.textContent = JSON.stringify(R);
  try { (window.top || window).document.body.appendChild(pre); }
  catch (e) { document.body.appendChild(pre); }
}

// ── build the page ───────────────────────────────────────────────────────────
let src = readFileSync('index.html', 'utf8');
src = src.replace(/const NETWORK_GATE\s*=\s*[^;]+;/, 'const NETWORK_GATE=false;');
const seed = {
  wl_net_status: 'approved',
  seen_release: (src.match(/const RELEASE=\{\s*v:'([^']+)'/) || [, '9999'])[1],
  seen_msg: '1', animelist_v4: JSON.stringify(HOSTILE),
  onboarded_animelist_v4: '1', tut_seen_animelist_v4: '1',
  backupoff_animelist_v4: '1', backup_nudge_animelist_v4: '1',
};
const inject = '<script>try{' +
  Object.entries(seed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('') +
  `}catch(e){}window.__QUICK=${QUICK};</script>`;
// The LAST </body> — the first one lives inside a JS string.
const i = src.lastIndexOf('</body>');
src = src.slice(0, i) +
  `<script>addEventListener('load',()=>{setTimeout(()=>{try{(${suite.toString()})()}catch(e){document.title='STRESS_CRASH';const p=document.createElement('pre');p.id='STRESS_RESULT';p.textContent=JSON.stringify({errors:['suite crashed: '+(e&&e.message)],warnings:[],checks:[],clicked:0});document.body.appendChild(p);}},900)})<\/script>` +
  src.slice(i);
mkdirSync('.preview', { recursive: true });
writeFileSync('.preview/stress.html', src.replace('<script', inject + '<script'));

// Chrome will not give a headless window less than 500px, so a run asking for a
// phone width silently tested 500 instead — every narrow-layout check was a lie.
// Below the clamp, load the app in an iframe of the real width: media queries
// and layout resolve against that, and the suite reports up into this page.
const FRAMED = WIDTH < 520;
if (FRAMED) writeFileSync('.preview/stress-frame.html',
  `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">` +
  `<iframe src="./stress.html" style="border:0;width:${WIDTH}px;height:900px;display:block"></iframe></body>`);

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 900));
let dom = '';
try {
  const out = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=45000', `--window-size=${FRAMED ? WIDTH + 40 : WIDTH},940`, '--dump-dom',
    `http://127.0.0.1:${PORT}/.preview/${FRAMED ? 'stress-frame.html' : 'stress.html'}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  dom = out.stdout || '';
} finally { process.kill(-server.pid); }

const m = /<pre id="STRESS_RESULT">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) {
  console.error('the suite never reported back — the app probably threw before it could run');
  process.exit(2);
}
const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const R = JSON.parse(dec(m[1]));

const uniq = a => [...new Set(a)];
const errors = uniq(R.errors), warnings = uniq(R.warnings);
console.log(`\n  ${R.checks.length} checks ran · ${R.clicked} controls pressed · viewport ${R.width}px\n`);
R.checks.forEach(c => console.log('  ok   ' + c));
if (warnings.length) { console.log('\n  WARNINGS'); warnings.forEach(w => console.log('  •    ' + w)); }
if (errors.length) { console.log('\n  ERRORS'); errors.forEach(e => console.log('  X    ' + e)); }
console.log(errors.length ? `\n${errors.length} error(s)\n` : `\nno errors · ${warnings.length} warning(s)\n`);
process.exit(errors.length ? 1 : 0);
