#!/usr/bin/env node
// Render the real app in WEBKIT at an iPhone viewport.
//
// preview.mjs drives headless Chrome, which is Blink — the same engine as the
// desktop browser and a different one from every device this app is actually
// used on. Chrome's device emulation does not help: it changes the viewport, not
// the engine, so an entire class of fault (unsupported filters, -webkit- quirks,
// anything WebKit resolves differently) renders perfectly in it and disappears
// on the phone. This uses Playwright's WebKit build so those faults show up here
// instead of in a screenshot from someone's hand.
//
//   node scripts/preview-webkit.mjs 393x852 out.png "applyTheme('naruto')"
import { spawn } from 'node:child_process';
// Resolved at run time so this works whether Playwright is installed in the
// project or, as here, kept outside it — the repo has no node_modules and this
// script is not worth giving it one. PW may point at a playwright/index.js.
const _pw = await import(process.env.PW || 'playwright');
const { webkit, devices } = _pw.default ?? _pw;   // the package is CJS; named exports land on .default

const [size = '393x852', out = 'webkit.png', after = ''] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);

// preview.mjs already knows how to build a bootable copy — which constant turns
// the invite gate off, which keys to seed, where the `after` hook has to be
// spliced. Duplicating that here would mean two copies drifting apart, and the
// one in this file would be the one nobody remembers to update. So it builds the
// copy and this script only points a different ENGINE at it.
await new Promise((res, rej) => {
  const b = spawn('node', ['scripts/preview.mjs', size, '/tmp/.wk-throwaway.png', after], { stdio: 'ignore' });
  b.on('exit', c => c === 0 ? res() : rej(new Error('preview.mjs build failed')));
});

const server = spawn('python3', ['-m', 'http.server', '8990'], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 900));
try {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'], viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto('http://127.0.0.1:8990/.preview/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  if (after) { try { await page.evaluate(after); } catch (e) { errs.push('after: ' + e.message); } }
  await page.waitForTimeout(1200);

  // The fault that started this: a cover that occupies space but paints nothing.
  const blanks = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.pcard-img, .rz-img, .resume-art, .dt-cover, .hero-bg-img').forEach(i => {
      const r = i.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const cs = getComputedStyle(i);
      out.push({ cls: i.className, w: Math.round(r.width), filter: cs.filter,
                 loaded: i.complete === undefined ? null : (i.complete && i.naturalWidth > 0), opacity: cs.opacity });
    });
    return out.slice(0, 6);
  });
  await page.screenshot({ path: out });
  await browser.close();
  console.log(JSON.stringify({ errs, blanks }, null, 1));
} finally { process.kill(-server.pid); }
console.log(`webkit ${size} -> ${out}`);
