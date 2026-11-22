// Every CSS declaration in index.html, put to the browser that has to read it.
//
// A declaration the browser rejects is not an error anywhere: no warning, no failed build, no visual that
// obviously breaks. It simply never applies, and the element quietly falls back. Three controls shipped that way
// for months -- `font:800 12px/1 inherit` is invalid, because `inherit` cannot be a component inside the font
// shorthand, so the +1 bump on a card, the retro tab and the recommendation reply all rendered at Chrome's
// default form-control font (13.333px, weight 400) while their rules said 12px/800. The visual audit caught the
// SYMPTOM, a text size nobody would choose; nothing caught the cause.
//
// So: pull every declaration out of the inline <style> blocks, set each one on a real element, and see whether
// the browser kept it. style.length === 0 means it was thrown away.
//
// Two things are skipped, and both are deliberate rather than convenient. Vendor-prefixed properties
// (-webkit-, -moz-) are written FOR other engines and Chrome is expected to drop them. @property blocks hold
// descriptors (syntax, inherits, initial-value) which are not element declarations at all, so testing them on an
// element says nothing. Checked both ways on the commit that still had the bug: with these filters it reported
// those three and nothing else.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8977;

const src = readFileSync('index.html', 'utf8');
const decls = [];
let m, re = /<style[^>]*>([\s\S]*?)<\/style>/g;
while ((m = re.exec(src))) {
  const start = m.index + m[0].indexOf(m[1]);
  const css = m[1].replace(/\/\*[\s\S]*?\*\//g, s => ' '.repeat(s.length));   // blanked, so offsets still line up
  let depth = 0, paren = 0, buf = '', bufStart = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '(') paren++; else if (c === ')') paren--;
    if (paren === 0 && (c === '{' || c === '}' || c === ';')) {
      if (c === '{') { depth++; buf = ''; bufStart = i + 1; continue; }
      if (c === '}') { depth--; buf = ''; bufStart = i + 1; continue; }
      const text = buf.trim();
      if (depth > 0 && text.includes(':')) {
        const prop = text.slice(0, text.indexOf(':')).trim();
        if (!/^(syntax|inherits|initial-value)$/.test(prop) && !/^-(webkit|moz|ms|o)-/.test(prop)) {
          decls.push({ text, line: src.slice(0, start + bufStart).split('\n').length });
        }
      }
      buf = ''; bufStart = i + 1; continue;
    }
    buf += c;
  }
}

const page = `<!doctype html><meta charset=utf-8><pre id=M></pre><script>
const D=${JSON.stringify(decls)};const d=document.createElement('div');const bad=[];
for(const x of D){ d.style.cssText=''; try{ d.style.cssText=x.text; }catch(e){} if(d.style.length===0) bad.push(x); }
document.getElementById('M').textContent=JSON.stringify(bad);
<\/script>`;
mkdirSync('.preview', { recursive: true });
writeFileSync('.preview/cssvalid.html', page);
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore', detached: true });
await new Promise(r => setTimeout(r, 900));
let dom = '';
try {
  dom = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=20000',
    '--dump-dom', `http://127.0.0.1:${PORT}/.preview/cssvalid.html`], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout || '';
} finally { try { process.kill(-srv.pid); } catch (e) {} }

const got = dom.match(/<pre id="M">([\s\S]*?)<\/pre>/);
let pass = 0, fail = 0;
const t = (name, got_, want) => { const ok = got_ === want; ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got_)}, wanted ${JSON.stringify(want)})`}`); };

if (!got) { console.log('  FAIL no result from the browser'); console.log('\n0 passed, 1 failed'); process.exit(1); }
const bad = JSON.parse(got[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

// A sweep that found nothing because it looked at nothing passes for the wrong reason.
t('there were declarations there to check', decls.length > 5000, true);
for (const b of bad) console.log(`       line ${b.line}: ${b.text.slice(0, 80)}`);
t('every declaration the file makes is one the browser keeps', bad.length, 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
