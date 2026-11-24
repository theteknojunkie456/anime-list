// A ratchet on flat sleeps, because writing the rule down did not hold.
//
// CONVENTIONS.md has banned asserting after a fixed sleep for a long time, and records
// party-live carrying that rule in its own header while 42 of its 46 assertions still slept.
// Two more tests were caught violating it this week -- full-copy-test waited 4.5s for boot and
// rec-card-test waited 900ms for an image's error event. Both passed alone and failed in the
// suite, where thirty browsers make every timer optimistic. Neither was found by reading the
// code; each surfaced only when it failed in a way the change under test could not explain.
//
// So this does not try to fix 283 sleeps. It stops there being 284. The count may fall freely
// -- when it does, lower BUDGET in the same commit and the floor moves with you.
//
// It cannot tell a legitimate sleep from a bad one, and does not pretend to: a NEGATIVE
// assertion ("a guest cannot kick the host") is supposed to sleep, because there is nothing to
// wait for and waiting would only give the forbidden thing more time to happen. Those are in
// the 283. What this catches is the number going UP, which is the only moment anyone is in a
// position to ask which kind they just wrote.
import { readFileSync, readdirSync } from 'node:fs';

const BUDGET = 281;   // measured 2026-11-23 BY THIS SCANNER; lower it whenever you remove some.
                      // A shell one-liner first said 283 because it required setTimeout(r,900) with no
                      // space. A budget has to be measured by the thing that enforces it, or the first
                      // run fails for a reason that has nothing to do with the code.

const SELF = 'sleep-budget-test.mjs';   // this file quotes the pattern it looks for, so it must skip itself
const files = [
  ...readdirSync('scripts').filter(f => /-test\.mjs$|\.test\.mjs$/.test(f) && f !== SELF).map(f => 'scripts/' + f),
  ...readdirSync('cloud').filter(f => /\.test\.mjs$/.test(f)).map(f => 'cloud/' + f),
];

const per = [];
let total = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const hits = (src.match(/wait\(\s*\d{3,}\s*\)|setTimeout\(\s*r\s*,\s*\d{3,}\s*\)/g) || [])
    .map(m => +(m.match(/\d{3,}/) || [0])[0])
    .filter(ms => ms >= 500);
  if (hits.length) { per.push([f, hits.length]); total += hits.length; }
}

let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = got === want; ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${got}, wanted ${want})`}`); };

// A sweep that found nothing because it looked at nothing passes for the wrong reason.
t('there were test files to scan', files.length > 50, true);

if (total > BUDGET) {
  console.log(`\n  flat sleeps of 500ms or more: ${total}, which is ${total - BUDGET} over budget.`);
  console.log('  The worst offenders:');
  for (const [f, n] of per.sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`     ${n}  ${f}`);
  console.log('  If the new one is a POSITIVE assertion -- "this must have arrived" -- poll for it');
  console.log('  with a deadline instead. If it guards a NEGATIVE one, raise BUDGET and say why.');
}
t('no new flat sleeps', total <= BUDGET, true);

if (total < BUDGET) {
  console.log(`\n  ${BUDGET - total} fewer than the budget — lower BUDGET to ${total} in this commit so it cannot creep back.`);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
