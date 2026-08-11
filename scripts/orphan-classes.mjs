#!/usr/bin/env node
// Every class the markup uses, checked against every class the stylesheet defines.
//
// This exists because the same bug shipped three times: an element is moved,
// renamed or added, its rule is left behind or never written, and the result is
// not an error — it is a control with a border and no padding, or a bar at full
// width in the loudest colour on the screen. Nothing throws. It just looks wrong,
// and the only detector is someone opening the app and screenshotting it.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'index.html';
const src = readFileSync(file, 'utf8');

const style = src.slice(src.indexOf('<style'), src.lastIndexOf('</style>'));
const defined = new Set();
for (const m of style.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);

// Classes the markup asks for: static attributes, and the template-literal
// versions the app builds at runtime (class="pcard${x?' sel':''}").
const used = new Map();
const VALID = /^-?[a-zA-Z][\w-]*$/;      // anything else is a fragment of an expression
const add = (name, ctx) => {
  if (!name || !VALID.test(name)) return;
  if (!used.has(name)) used.set(name, ctx);
};
for (const m of src.matchAll(/class="([^"]*)"/g)) {
  // Strip expressions from the WHOLE attribute before splitting on whitespace:
  // `src-chip${pref()==='english'?' on':''}` splits into two halves that each
  // carry an unbalanced brace, and stripping per-piece then does nothing.
  const attr = m[1].replace(/\$\{[^}]*\}/g, ' ').replace(/'\s*\+[\s\S]*\+\s*'/g, ' ');
  for (const raw of attr.split(/\s+/)) {
    // Markup is built three ways in this file — plain, template literal, and
    // old-style concatenation — so strip the expression halves out of all of
    // them and keep only the literal class text.
    // Greedy on purpose: a lazy match stops at the first quote INSIDE the
    // expression ("'+(!cur?' on':'')+'") and leaks operands like `!cur` into the
    // results. Over-stripping only loses literals, which costs a missed warning;
    // under-stripping produces noise, which costs the whole tool's credibility.
    const literal = raw.split(/\$\{[^}]*\}/).join(' ')
                       .replace(/'\s*\+[\s\S]*\+\s*'/g, ' ')
                       .replace(/['"+?:()]/g, ' ');
    for (const piece of literal.split(/\s+/)) add(piece.trim(), m[0].slice(0, 70));
  }
}
for (const m of src.matchAll(/classList\.(?:add|remove|toggle)\((['"])([\w-]+)\1/g)) add(m[2], m[0]);
for (const m of src.matchAll(/className\s*=\s*(['"])([^'"]+)\1/g))
  for (const p of m[2].split(/\s+/)) add(p.trim(), m[0].slice(0, 70));

// Verified as containers that carry no styling of their own — a wrapper the JS
// fills, or an element styled inline. Listed rather than silently tolerated, so
// the next unstyled class is a genuine signal instead of one more line of noise.
const INTENTIONAL = new Set([
  'cf-why',      // inline-styled diagnostic line
  'dt-rich',     // wrapper the rich-detail fetch fills; children carry the styling
  'fr-list','rs-list','rc-notes','pt-picks',   // plain containers for styled rows
  'rec-next',    // behaviour hook alongside .dt-watch / .rec-cta
  'sync-mixup',  // hook on an .ai-desc paragraph
]);
const orphans = [...used].filter(([c]) => !defined.has(c) && !INTENTIONAL.has(c));
// Utility-ish names that legitimately carry no styling of their own.
// Names that are state flags or prefixes rather than styled things in their own
// right — the rule that matters is .thing.on or .b-watching, not the bare word.
const IGNORE = new Set(['on','off','hidden','sel','ico','warn','b-','is-read','glow-off','live','full','loaded','failed']);
const real = orphans.filter(([c]) => !IGNORE.has(c));

console.log(`${used.size} classes used · ${defined.size} defined · ${real.length} with no rule\n`);
for (const [c, ctx] of real.sort()) console.log(`  .${c.padEnd(22)} ${ctx.replace(/\s+/g,' ').slice(0,58)}`);
process.exit(real.length ? 1 : 0);
