// Every stamp an enricher leaves must be out of the push fingerprint.
//
// The app only pushes when pushFingerprint() differs from the last confirmed one, and on a plan
// whose thousand daily writes are already spent that guard is the difference between syncing
// when your list changes and syncing because a timer fired. PUSH_FP_IGNORE is what keeps the
// guard honest: the enrichers stamp bookkeeping on each item -- imgTried, detTried, airChk and
// the rest -- to remember they already looked, and those stamps ride in the payload so another
// device does not repeat the lookup. Hashed, they mean that merely LOOKING counts as a change,
// and the app spends a write to report that it found nothing.
//
// That was known and written down. It still drifted: on 2026-11-24 three stamps were being set
// on items and were not in the list -- xlTried, seqTried and epTried. seqTried is the sharpest,
// because its own comment says it is stamped "either way, or this retries forever", so a sequel
// lookup that found nothing armed a push.
//
// Nothing had gone wrong in the reasoning. The comment named six fields as examples and the
// seventh enricher was written later by someone reading the examples rather than the rule. So
// the rule is enforced instead of described: every *Tried / *Chk field assigned anywhere in
// index.html is an enricher stamp and has to be listed.
//
// If a future field matches that shape and is genuinely user data -- something a person would
// be upset to see not sync -- it does not belong under this naming. Rename it. The names are
// the contract here, and that is cheaper than a guard that quietly stops firing.
import { readFileSync } from 'node:fs';

const src = readFileSync('index.html', 'utf8');

const listed = new Set(
  (src.match(/PUSH_FP_IGNORE\s*=\s*\[([^\]]*)\]/) || [, ''])[1]
    .split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));

// Assignment, not mere reading: `if(a.epTried)return` is a check, `a.epTried=1` is a stamp.
const stamped = new Set(
  [...src.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_]*(?:Tried|Chk))\s*=(?!=)/g)].map(m => m[1]));

const missing = [...stamped].filter(f => !listed.has(f)).sort();
const stale = [...listed].filter(f => !stamped.has(f)).sort();

let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = got === want; ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${got}, wanted ${want})`}`); };

// A sweep that found nothing because it looked at nothing passes for the wrong reason.
t('there were enricher stamps to find', stamped.size >= 8, true);
t('PUSH_FP_IGNORE was read', listed.size >= 8, true);

if (missing.length) {
  console.log(`\n  ${missing.length} stamp(s) are set on items but are not in PUSH_FP_IGNORE:`);
  for (const f of missing) console.log(`     ${f}`);
  console.log('  Each one makes an enrichment pass that found NOTHING count as a change, and');
  console.log('  arms a KV write. Add it to PUSH_FP_IGNORE, or rename it if it is real user data.');
}
t('no enricher stamp is inside the push fingerprint', missing.length, 0);

if (stale.length) {
  console.log(`\n  ${stale.length} listed field(s) are stamped nowhere any more: ${stale.join(', ')}`);
  console.log('  Harmless, but drop them so the list keeps saying what is true.');
}
t('nothing in the list has stopped existing', stale.length, 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
