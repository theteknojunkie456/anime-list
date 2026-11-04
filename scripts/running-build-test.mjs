// "App version here" answers one question: is this device running current code?
// It reads the service worker's cache names back out of the browser. The filter
// used to be /^animelist-/ sorted, last one wins — which also matched the font
// cache, 'animelist-fonts-v1'. "fonts-v1" sorts after any hex string, so the row
// reported that frozen constant on every device that had ever loaded a font,
// i.e. all of them. A row that is always wrong is worse than no row, because it
// looks like an answer.
// run: node scripts/running-build-test.mjs
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const src=readFileSync(new URL('index.html',root),'utf8');
const sw=readFileSync(new URL('sw.js',root),'utf8');

const m=src.match(/keys\.filter\(k=>(\/\^animelist[^/]*\/)\.test\(k\)\)/);
if(!m)throw new Error('could not find the cache filter in index.html');
const FILTER=new RegExp(m[1].slice(1,-1));
const pick=keys=>{const mine=keys.filter(k=>FILTER.test(k)).sort();
  return mine.length?mine[mine.length-1].replace(/^animelist-/,''):'(not installed)';};

// The real names, read from sw.js rather than retyped.
const CACHE=(sw.match(/const CACHE = '([^']+)'/)||[])[1];
const FONTS=(sw.match(/const FONT_CACHE = '([^']+)'/)||[])[1];

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(48)+String(g)+(ok?'':'  (want '+e+')'));};

t('sw.js still names both caches', !!CACHE&&!!FONTS, true);
t('the build stamp is hex',        /^animelist-[0-9a-f]{6,}$/.test(CACHE), true);

// The exact shape his phone was in: both caches present.
t('the font cache never wins',     pick([CACHE,FONTS]), CACHE.replace(/^animelist-/,''));
t('order does not matter',         pick([FONTS,CACHE]), CACHE.replace(/^animelist-/,''));
t('fonts alone is not a build',    pick([FONTS]), '(not installed)');
t('nothing cached says so',        pick([]), '(not installed)');

// An older stamp alongside the current one: newest install wins by sort, which
// is only sound because the stamp is hex of a fixed width.
t('all stamps are the same width', new Set([CACHE,'animelist-0000000000'].map(k=>k.length)).size, 1);
t('a stray cache is ignored',      pick([CACHE,'animelist-fonts-v2','animelist-images']), CACHE.replace(/^animelist-/,''));

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
