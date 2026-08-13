#!/usr/bin/env node
// Render the REAL app headlessly, at any width, with a list in it.
//
// Every visual check until now has been done on a harness page that borrows the
// stylesheet — good enough for one component, useless for anything about the
// whole screen, which is where the last few faults actually were. The app itself
// would not boot headlessly because the invite gate holds the screen before
// render() ever runs.
//
// So: serve a COPY with the gate constant flipped off and a list seeded into
// storage. Nothing here touches index.html; the copy lives in .preview/ and is
// git-ignored. Everything else — every style, every code path — is the real
// thing, which is the whole point.
//
// A third argument runs after boot, so a screen behind a tap — a sheet, a
// detail view — can be photographed too.
//
//   node scripts/preview.mjs 1400x880 out.png "openSheet('themeSheet')"

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

const [size = '1400x880', out = 'preview.png', after = ''] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SHOWS = [
  ['Attack on Titan', 'watching', 18, 25, 'Action, Drama'],
  ['ONE PIECE', 'watching', 214, 1100, 'Adventure'],
  ['Hunter x Hunter', 'watching', 96, 148, 'Adventure'],
  ['Demon Slayer', 'plan', 0, 26, 'Action'],
  ['Monster', 'plan', 0, 74, 'Drama, Thriller'],
  ['Jujutsu Kaisen', 'finished', 24, 24, 'Action'],
  ['Mob Psycho 100', 'finished', 37, 37, 'Comedy'],
  ['Chainsaw Man', 'watching', 6, 12, 'Action, Horror'],
  ['Vinland Saga', 'plan', 0, 24, 'Drama'],
  ['Berserk', 'dropped', 3, 25, 'Fantasy'],
];
const list = SHOWS.map(([title, status, ep, epTotal, genre], i) => ({
  id: 'p' + i, kind: 'watch', status, title, titleEn: title, titleRo: title,
  ep, epTotal, genre, eps: epTotal + ' eps', dur: 24, adultChk: true,
  aniColor: ['#7a3b2e','#c9762b','#d4a017','#3f6fa8','#4b6e6e','#5b4b8a','#2f7a6a','#a8442f','#3b6e4b','#6e3b4b'][i],
  fav: i % 3 === 0, upd: 1000 - i,
  airAt: status === 'watching' ? Math.floor(Date.now()/1000) + 3600 * (i + 2) : 0,
  airEp: status === 'watching' ? ep + 3 : 0,
}));

const seed = {
  // Match the current RELEASE version exactly, or the notes sheet opens over
  // whatever screen this shot was meant to photograph.
  wl_net_status: 'approved',
  seen_release: (readFileSync('index.html','utf8').match(/const RELEASE=\{\s*v:'([^']+)'/)||[,'9999'])[1],
  seen_msg: '1',
  animelist_v4: JSON.stringify(list),
  onboarded_animelist_v4: '1', tut_seen_animelist_v4: '1',
  backupoff_animelist_v4: '1', backup_nudge_animelist_v4: '1',
};

let src = readFileSync('index.html', 'utf8');
const before = src;
src = src.replace(/const NETWORK_GATE\s*=\s*[^;]+;/, 'const NETWORK_GATE=false;');
if (src === before) console.warn('! NETWORK_GATE not found — the gate may still hold the screen');
const inject = '<script>try{' +
  Object.entries(seed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('') +
  '}catch(e){}</script>';
mkdirSync('.preview', { recursive: true });
// index.html contains two `</body>` — the first is inside a JS string. Splice at
// the LAST one, or the injected tag lands mid-string and kills the whole app.
if (after) {
  const i = src.lastIndexOf('</body>');
  src = src.slice(0, i) +
    `<script>addEventListener('load',()=>{setTimeout(()=>{try{${after}}catch(e){console.error(e)}},400)})<\/script>` +
    src.slice(i);
}
writeFileSync('.preview/index.html', src.replace('<script', inject + '<script'));

// Chrome clamps a headless window to 500px wide. Ask for 390 and you get a
// 500px viewport cropped to 390 in the image — which looks exactly like the app
// overflowing, and cost one wrong diagnosis already. Below the clamp, render
// inside an iframe of the real width instead: media queries and layout then
// resolve against that viewport, which is the thing being tested.
const framed = w < 520;
if (framed) {
  writeFileSync('.preview/frame.html',
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">` +
    `<iframe src="./index.html" style="border:0;width:${w}px;height:${h}px;display:block"></iframe></body>`);
}
const target = framed ? 'frame.html' : 'index.html';
const win = framed ? `${w + 40},${h + 40}` : `${w},${h}`;

const server = spawn('python3', ['-m', 'http.server', '8971'], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 900));
try {
  spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=9000', `--window-size=${win}`, `--screenshot=${out}`,
    `http://127.0.0.1:8971/.preview/${target}`], { stdio: 'ignore' });
} finally { process.kill(-server.pid); }
console.log(`rendered ${size} -> ${out}`);
