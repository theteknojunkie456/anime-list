#!/usr/bin/env node
// WatchList is a SINGLE-FILE app: the whole product is index.html (inline
// <script>). One JS syntax error blanks the entire app. Aider runs this after
// every edit (see .aider.conf.yml `lint-cmd`); a non-zero exit makes Aider fix
// the error before it commits — the safeguard the other tools kept skipping.
import fs from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] || 'index.html';
let src;
try {
  src = fs.readFileSync(file, 'utf8');
} catch {
  console.error(`check-syntax: cannot read ${file}`);
  process.exit(1);
}

// Concatenate every inline <script> block (skip external src=) and compile it.
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, buf = '';
while ((m = re.exec(src))) buf += '\n;{\n' + m[1] + '\n}\n';

try {
  new vm.Script(buf, { filename: file }); // throws SyntaxError like `node --check`
  console.log(`✓ ${file} — inline JS parses clean`);
} catch (e) {
  console.error(`✗ SYNTAX ERROR in ${file}\n${e.message}\nDo NOT commit until this is fixed.`);
  process.exit(1);
}

// Two top-level functions with the same name is legal JavaScript and silently
// destructive: the last declaration wins for every caller, including the ones
// written above it. It parses clean, throws nothing, and the losing function
// simply never runs — a card button that quietly did nothing at all is what
// sent us looking. Nothing here can be a warning; a shadowed function is always
// a bug, either a collision or a leftover.
const declRe = /^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm;
const seen = new Map();
let d;
while ((d = declRe.exec(buf))) {
  const name = d[1];
  const line = src.split('\n').findIndex((l, i) =>
    new RegExp(`^(?:async )?function ${name.replace(/[$]/g, '\\$&')}\\s*\\(`).test(l) &&
    !(seen.get(name) || []).includes(i + 1)) + 1;
  seen.set(name, (seen.get(name) || []).concat(line > 0 ? line : []));
}
const clashes = [...seen].filter(([, lines]) => lines.length > 1);
if (clashes.length) {
  console.error(`✗ DUPLICATE FUNCTION NAMES in ${file}`);
  for (const [name, lines] of clashes) {
    console.error(`  ${name}() declared ${lines.length}× at line${lines.length > 1 ? 's' : ''} ${lines.join(', ')} — only the last one runs`);
  }
  console.error('Do NOT commit until this is fixed.');
  process.exit(1);
}
