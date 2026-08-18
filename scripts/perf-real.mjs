#!/usr/bin/env node
// REAL frame timing, in a real browser, on a real clock.
//
// scripts/perf.mjs deliberately counts work instead of timing it: it runs under
// --virtual-time-budget, where the clock advances in jumps and any duration it
// produces is fiction. That is the right trade there — the counts are stable and
// comparable. It just cannot answer "does this feel slow", which is the only
// question a person ever actually asks.
//
// This one runs Playwright's WebKit, the engine this app is used on, with no
// virtual clock, and measures the gap between animation frames while scrolling.
// It reports the distribution rather than a single worst frame: one 200ms hitch
// while images decode says much less than a p95 that never drops under 30ms.
//
// WHAT IT CAN AND CANNOT ANSWER. With the network stubbed the gross signal is
// solid and repeatable — retro-off holds p95 under ~200ms while retro-on spikes
// past a second, every run. But the tail itself swings ±25% between identical
// runs (1126ms and 1392ms on the same unmodified file), so it can settle "is
// this mode slow" and cannot settle "is batch 6 better than batch 40". Do not
// tune small constants against it; two runs that differ by a fifth are the same
// run. p50 is far steadier than p95 — read both.
//
//   PW=<path>/playwright/index.js node scripts/perf-real.mjs [retro|plain|both]
import { spawn } from 'node:child_process';
const _pw = await import(process.env.PW || 'playwright');
const { webkit, devices } = _pw.default ?? _pw;

const mode = (process.argv[2] || 'both').toLowerCase();
const SEED = Number(process.env.TITLES || 200);

// preview.mjs knows how to build a bootable copy (gate off, list seeded).
await new Promise((res, rej) => {
  const b = spawn('node', ['scripts/preview.mjs', '430x900', '/tmp/.perfreal.png'], { stdio: 'ignore' });
  b.on('exit', c => (c === 0 ? res() : rej(new Error('preview.mjs build failed'))));
});

const server = spawn('python3', ['-m', 'http.server', '8994'], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 900));

async function run(retro) {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'] });
  const page = await ctx.newPage();
  // Serve every cover locally. Otherwise this measures the CDN: identical code
  // came back at p50 33ms and then 339ms depending on the network, which is
  // exactly the kind of number that makes a tool worse than no tool. A fixed
  // 2x3 PNG keeps decode cost constant so what is left is the app's own work.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAAlXFJPAAAAFklEQVQIW2NkYGD4z8DAwMgABXAGNgEAJhIBQZ2mFtYAAAAASUVORK5CYII=','base64');
  await page.route('**/*', route => {
    const r = route.request();
    if (r.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
    if (/anilist|graphql|fonts\.g/.test(r.url())) return route.abort();   // no lookups, no webfonts
    return route.continue();
  });
  await page.goto('http://127.0.0.1:8994/.preview/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  // Grow the list to a realistic size, then set the mode under test.
  // NB: `let anime` at the top level of a classic script lives in the global
  // LEXICAL scope, not on window — so window.anime is undefined while a bare
  // `anime` resolves fine. Reading it the wrong way is why this first reported
  // "0 titles" while happily measuring an empty list.
  await page.evaluate(n => {
    try {
      const base = (typeof anime !== 'undefined' && anime) || [];
      if (base.length && base.length < n) {
        const out = [];
        for (let i = 0; out.length < n; i++) {
          const a = base[i % base.length];
          out.push(Object.assign({}, a, { id: 'perf' + i, title: a.title + ' #' + i }));
        }
        anime.length = 0; out.forEach(x => anime.push(x));
      }
    } catch (e) {}
  }, SEED);
  await page.evaluate(on => { try { setRetroMode(on); } catch (e) {} try { render(); } catch (e) {} }, retro);
  await page.waitForTimeout(2500);   // let covers settle so we time scrolling, not loading

  const stats = await page.evaluate(async () => {
    const pg = document.getElementById('pageEl') || document.scrollingElement;
    pg.scrollTop = 0;
    const gaps = [];
    await new Promise(done => {
      let last = performance.now(), n = 0;
      const tick = () => {
        const now = performance.now();
        if (n++ > 3) gaps.push(now - last);          // skip start-up frames
        last = now;
        const atEnd = pg.scrollTop + pg.clientHeight >= pg.scrollHeight - 4;
        if (n < 150 && !atEnd) { pg.scrollTop += 60; requestAnimationFrame(tick); }
        else done();
      };
      requestAnimationFrame(tick);
    });
    gaps.sort((a, b) => a - b);
    const at = q => gaps.length ? +gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))].toFixed(1) : 0;
    return {
      frames: gaps.length,
      p50: at(0.5), p95: at(0.95), worst: +(gaps[gaps.length - 1] || 0).toFixed(1),
      over16: gaps.filter(g => g > 16.7).length,
      canvases: document.querySelectorAll('canvas.pxc').length,
      titles: (typeof anime !== 'undefined' ? anime.length : 0),
    };
  });
  await browser.close();
  return stats;
}

try {
  const rows = [];
  if (mode === 'plain' || mode === 'both') rows.push(['retro off', await run(false)]);
  if (mode === 'retro' || mode === 'both') rows.push(['retro on ', await run(true)]);
  console.log(`\n  real-clock scroll, WebKit @ iPhone 14 Pro, ${rows[0][1].titles} titles\n`);
  for (const [label, s] of rows)
    console.log(`  ${label}  p50 ${String(s.p50).padStart(5)}ms  p95 ${String(s.p95).padStart(6)}ms  worst ${String(s.worst).padStart(6)}ms  over-16.7ms ${s.over16}/${s.frames}${s.canvases ? '  canvases ' + s.canvases : ''}`);
  console.log('');
} finally { process.kill(-server.pid); }
