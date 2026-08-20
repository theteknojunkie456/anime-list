// Pull the real dedupe functions out of index.html and export them, so the
// merge can be tested without a browser. Extracting beats copying: a copy goes
// stale the first time someone edits the original, which is exactly when a test
// like this needs to be right.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');

function grab(name) {
  const m = new RegExp(`^(?:async )?function ${name}\\s*\\([^)]*\\)\\s*\\{`, 'm').exec(src);
  if (!m) throw new Error(`extract-dedupe: ${name}() not found in index.html`);
  let depth = 0, i = m.index, j = i;
  for (;;) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { j++; break; } }
    j++;
  }
  return src.slice(i, j);
}

const rank = /const _statusRank=\{[^}]*\};/.exec(src)[0];
const body = [rank, ...['normTitle','kindOf','titleAliases','rememberNames','dupeKeys','dedupeList'].map(grab)].join('\n');
const mod = new Function(body + '\nreturn {dedupeList, dupeKeys, normTitle};')();

export const dedupeList = mod.dedupeList;
export const dupeKeys = mod.dupeKeys;
export const normTitle = mod.normTitle;
