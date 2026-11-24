// Nothing you are waiting for may take longer than .34s.
//
// The app had six durations for one gesture. A panel sliding in took .44s as a sheet, .42s as
// the stats view, .45s as the carousel track, .38s as the player, share and yt views, and .34s
// as the slide drawer. #detailSheet was the one that gave it away: .46s in one-pane and .34s in
// two-pane, so the SAME sheet changed speed when the window got wide enough to show two columns.
// Nobody chose that. Each panel was written on its own day and timed by feel, and feel drifts.
//
// They are all .34s now, and this keeps them there.
//
// The rule is about waiting, not about tidiness, so it is written in those terms: a duration
// above .34s is only allowed on something that runs AFTER the tap rather than in front of it.
// A progress bar filling, a stat growing out of the axis, the waterline rising up a poster, the
// ambient glow drifting -- those are the app telling you something it already did, and a slow
// one reads as considered. A panel you are waiting to appear is the opposite: every extra frame
// is a frame where you have asked and not yet been answered.
//
// Adding to DECORATIVE is a real decision and not a way past a failure. Ask the one question
// that separates the two kinds: if this were instant, would the user have got their answer
// sooner? If yes, it is not decorative, and it belongs at .34s or below.
import { readFileSync } from 'node:fs';

const CEILING = 340;   // ms. The panel-slide duration; see DESIGN.md "Motion".

// Selectors whose motion runs after the tap, not in front of it.
const DECORATIVE = [
  /^\.ambient$/,            // the drifting key light
  /^\.sv-/,                 // stats view: rings, bars, fills growing out of the axis
  /^\.pfill$/,              // progress fill on a card
  /^\.sh-fit-hint$/,        // a hint fading in beside the share frame
  /^\.dt-level$/,           // the waterline rising up the detail hero
  /^#brightVeil$/,          // ambient brightness wash
];

const src = readFileSync('index.html', 'utf8');
// Blank comments rather than drop them: a rule written under one keeps its selector intact.
const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, ' ');

const offenders = [];
let measured = 0;
for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = rule[1].trim().replace(/\s+/g, ' ');
  for (const decl of rule[2].matchAll(/transition(?:-duration)?\s*:([^;]+)/g)) {
    for (const d of decl[1].matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
      const ms = +d[1] * (d[2] === 'ms' ? 1 : 1000);
      measured++;
      if (ms <= CEILING) continue;
      const parts = sel.split(',').map(s => s.trim());
      if (parts.some(p => DECORATIVE.some(r => p.split(/\s+/).some(w => r.test(w))))) continue;
      offenders.push([ms, sel.slice(0, 64), decl[1].trim().slice(0, 48)]);
    }
  }
}

let pass = 0, fail = 0;
const t = (name, got, want) => { const ok = got === want; ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${got}, wanted ${want})`}`); };

// A sweep that found nothing because it looked at nothing passes for the wrong reason.
t('there were transitions there to measure', measured > 200, true);

if (offenders.length) {
  console.log(`\n  ${offenders.length} transition(s) run longer than ${CEILING}ms on something that is not decorative:`);
  for (const [ms, sel, val] of offenders.sort((a, b) => b[0] - a[0]))
    console.log(`     ${String(ms).padStart(5)}ms  ${sel}   ||  ${val}`);
  console.log(`\n  If it is a panel, a sheet or a control, bring it to ${CEILING}ms.`);
  console.log('  If it genuinely runs after the tap, add its selector to DECORATIVE and say why.');
}
t('nothing you are waiting for is slower than the panel slide', offenders.length, 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
