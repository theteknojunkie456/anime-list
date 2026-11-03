// The Updates feed is the one screen that shows people raw commit subjects, so
// every classifier slip is visible to a reader who has never seen a build. This
// pulls the real rules out of index.html and runs them — no browser, no server.
// run: node scripts/updates-feed-test.mjs
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../index.html',import.meta.url),'utf8');

// Lift the block verbatim rather than restating the regexes here. A test that
// keeps its own copy of the rules passes while the app is wrong.
const grab=(from,to)=>{const a=src.indexOf(from),b=src.indexOf(to,a);
  if(a<0||b<0)throw new Error('could not find '+from+' in index.html');return src.slice(a,b+to.length);};
const block=grab('const UPD_KINDS=[','const UPD_SKIP=/\\[(skip ci|ci skip)\\]/i;');
const {updKind,UPD_SKIP}=(new Function(block+';return{updKind,UPD_SKIP};'))();

let pass=0,fail=0;
const t=(n,g,e)=>{const ok=g===e;ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(52)+String(g)+(ok?'':'  (want '+e+')'));};

// The two that were wrong on his screen.
t('keyboard work is not Security',
  updKind('More keyboard: ⌘Y, ⌘A, filters, panels, statuses — and none of it past the lock'),'Feature');
t('a real lock-screen change still is Security',
  updKind('Lock screen: stop reporting a locked list as an empty one'),'Security');
t('password work is Security',  updKind('Pairing: ask for the password instead of refusing'),'Security');

// Repo plumbing announced as a Feature is how "Delete index.html" ended up
// reading like something the app had gained.
t('.nojekyll is Build',         updKind('Add .nojekyll to skip Jekyll processing on GitHub Pages'),'Build');
t('"Delete index.html" is Build',updKind('Delete index.html'),'Build');
t('"Add files via upload" is Build',updKind('Add files via upload'),'Build');
t('repo tidying is Build',      updKind('Organize repo: move icons into icons/, add README'),'Build');

// ...without swallowing real work that merely starts with a verb.
t('a real feature is not Build',updKind('Add official cover art to every entry'),'Feature');
t('a fix is a Fix',             updKind('Fix unclickable delete button on custom theme tiles'),'Fix');
t('voice pass is not a Fix',    updKind('The app informs you; it stops explaining itself'),'Feature');
t('iOS work is iOS',            updKind('iPhone build: install from Xcode'),'iOS');
t('party work is Party',        updKind('Watch together: rejoin after a dropped connection'),'Party');

// Scheduled jobs are not changes, and their marker is not for reading.
t('[skip ci] is skipped',       UPD_SKIP.test('Chapter counts: refresh [skip ci]'),true);
t('[ci skip] too',              UPD_SKIP.test('Covers: refresh [ci skip]'),true);
t('an ordinary commit is kept', UPD_SKIP.test('Sources takes the tab, Cloud takes the Settings tile'),false);

// The feed renders the subject line as-is, so nothing in it may be build
// notation. If a marker ever survives the filter, it must not reach the screen.
t('no marker can reach a row',  UPD_SKIP.test('Chapter counts: refresh'),false);

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
