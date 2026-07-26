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
