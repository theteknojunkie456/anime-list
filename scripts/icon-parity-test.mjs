// The app's mark lives in icons/icon.svg, and every other copy of it is a
// render of that one file. Tonight they were not: icons/ had the mark the user
// asked for, while the iPhone app's asset catalogue still held the version
// before it and the Safari extension's still held the version before THAT — the
// orange one from July. Nothing was broken, so nothing said so; the only report
// was the user looking at his home screen and saying he could not see the new
// logo, which is the worst way to find out.
//
// A picture cannot be diffed without a decoder, so this does not try. It asks
// two decodable questions instead, and between them they catch exactly the
// drift above:
//   1. every 1024x1024 app icon in the repo is byte-for-byte the master, since
//      that is the size every catalogue carries at full resolution;
//   2. no derived icon was last changed in a commit OLDER than the master —
//      which is the literal shape of "the mark was updated and this copy was
//      left behind".
// run: node scripts/icon-parity-test.mjs
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

let pass=0, fail=0;
const t=(name, got, want)=>{
  const ok = JSON.stringify(got)===JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok?'  ok  ':'  FAIL') + '  ' + name);
  if(!ok) console.log('        expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got));
};

const MASTER = 'icons/icon-1024.png';

// Where a copy of the mark is allowed to live. A new app target with its own
// asset catalogue gets added here, and is then held to the same rule.
const ROOTS = ['icons', 'ios-broadcast/Assets.xcassets',
               'ios-safari-ext/WatchList Party Sync/Shared (App)/Assets.xcassets'];

const walk = d => { let out=[];
  let names=[]; try{ names=readdirSync(d); }catch(e){ return out; }
  for(const n of names){ const p=join(d,n);
    if(statSync(p).isDirectory()) out=out.concat(walk(p));
    else if(/\.png$/i.test(n)) out.push(p); }
  return out; };

const icons = ROOTS.flatMap(walk).sort();
t('the repo still has icon files to check', icons.length>0, true);

// PNG dimensions come straight out of IHDR: width and height are the two
// big-endian 32-bit words at byte 16. No decoder needed to ask how big it is.
const dims = p => { const b=readFileSync(p);
  return {w:b.readUInt32BE(16), h:b.readUInt32BE(20), buf:b}; };

const master = dims(MASTER);
t('the master is 1024x1024', [master.w, master.h], [1024, 1024]);

// ── 1. every full-resolution copy IS the master ─────────────────────────────
const fullSize = icons.filter(p => p!==MASTER && dims(p).w===1024 && dims(p).h===1024);
t('there is at least one other 1024 copy to compare', fullSize.length>0, true);
for(const p of fullSize)
  t('1024 copy matches the master: ' + p.split('/').pop() + ' (' + p.split('/')[0] + ')',
    dims(p).buf.equals(master.buf), true);

// ── 2. nothing was left behind when the master moved ────────────────────────
// A file with uncommitted changes is being updated right now, so it is not
// stale; judging it by its last COMMIT would fail the very commit that fixes it.
const dirty = new Set(
  execFileSync('git', ['status', '--porcelain', '--', ...ROOTS], {encoding:'utf8'})
    .split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"|"$/g, '')));

const committedAt = p => {
  const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', p], {encoding:'utf8'}).trim();
  return out ? Number(out) : null;
};

const masterAt = committedAt(MASTER);
t('the master is committed', typeof masterAt==='number' && masterAt>0, true);

const stale = icons.filter(p => {
  if(p===MASTER || dirty.has(p)) return false;
  const at = committedAt(p);
  return at!==null && at < masterAt;          // never committed yet ⇒ not stale
});
t('no icon was last changed before the master was', stale, []);

// ── 3. the mark itself still wears the palette ──────────────────────────────
// Byte-identical copies of the WRONG picture would pass everything above. The
// source is text, so read it: ink ground, jade accent, and the play shape the
// original mark was drawn with.
const svg = readFileSync('icons/icon.svg', 'utf8');
t('the mark is on the ink ground', /#1b1f24/.test(svg) && /#0c0e11/.test(svg), true);
t('the mark keeps the jade accent', /#56d6bd/.test(svg), true);
t('the mark keeps the original play geometry', /M150 150l52 30-52 30z/.test(svg), true);
t('the mark is not on the old orange-to-magenta ground', /#ff9a5a|#d23b6e/.test(svg), false);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
