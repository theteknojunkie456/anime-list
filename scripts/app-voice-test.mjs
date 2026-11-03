// The app informs the user. It does not explain itself, and it has no author
// inside it. Both habits came back repeatedly once the Cloud panel was cleaned
// up — the admin panel, the tour and the toasts each had their own copy of them
// — so the rule is checked rather than remembered.
//
// Scope is deliberately narrow: only the surfaces that are definitely rendered
// (toast literals and the ai-desc / hint paragraphs). Comments are where the
// reasoning belongs and are never scanned. A wider net would flag prose that is
// doing its job and teach everyone to ignore the test.
// run: node scripts/app-voice-test.mjs
import {readFileSync} from 'node:fs';
// An optional path argument so the rules can be pointed at an older revision —
// that is how this was shown to fail on the copy that actually shipped, rather
// than only on probes written after the fact.
const target=process.argv[2]?new URL(process.argv[2],`file://${process.cwd()}/`):new URL('../index.html',import.meta.url);
const src=readFileSync(target,'utf8');

const strings=[];
// toast('…') / toast("…") / toast(`…`) — first argument only.
for(const m of src.matchAll(/\btoast\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g))
  strings.push({where:'toast',text:m[2],at:m.index});
// <p class="ai-desc …">…</p> and the join-gate hints.
for(const m of src.matchAll(/class="(?:ai-desc|hint)[^"]*"[^>]*>([^<]{25,})</g))
  strings.push({where:'panel',text:m[1],at:m.index});
// The tour's own titles and bodies. Scoping to toasts and panels alone missed
// WT_STEPS entirely — which is where "not even me" sat, the worst line in the
// app and the one that prompted the rule.
const wt=src.indexOf('const WT_STEPS=[');
if(wt<0) throw new Error('WT_STEPS not found in index.html');
const wtEnd=src.indexOf('\n];',wt);
for(const m of src.slice(wt,wtEnd).matchAll(/\b[tb]:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g))
  strings.push({where:'tour',text:m[2],at:wt+m.index});

const line=i=>src.slice(0,i).split('\n').length;

// Explaining the mechanism instead of stating the outcome.
const EXPLAINS=[/\bwhich means\b/i,/\bso that\b/i,/\bin other words\b/i,/\bthe reason (is|why)\b/i,/\brather than a promise\b/i];
// An author inside the product. "not even me" shipped in the tour for months.
// Possessives and contractions of the user's own voice are fine: the test only
// looks for a first person SPEAKING, which in this app is always me.
const AUTHOR=[/\bnot even me\b/i,/\bI (can|will|have|would|think|added|made|wrote)\b/,/\bmy (code|change|fix|rewrite)\b/i,/\bme\b(?=[.,!]|$)/i];

let pass=0,fail=0;
const bad=[];
for(const s of strings){
  for(const re of EXPLAINS) if(re.test(s.text)) bad.push({...s,why:'explains the mechanism: '+re});
  for(const re of AUTHOR)   if(re.test(s.text)) bad.push({...s,why:'an author inside the app: '+re});
}
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n.padEnd(46)+JSON.stringify(g)+(ok?'':'  (want '+JSON.stringify(e)+')'));};

t('found UI copy to check',          strings.length>80, true);
t('no string explains the mechanism',bad.filter(b=>b.why.startsWith('explains')).length,0);
t('no string speaks as its author',  bad.filter(b=>b.why.startsWith('an author')).length,0);

// The test has to be able to fail, or it is decoration. These are the exact
// strings that shipped, run through the same rules.
const probe=(txt,list)=>list.some(re=>re.test(txt));
t('would catch "not even me"',       probe('nobody can recover it for you, not even me.',AUTHOR),true);
t('would catch "which means"',       probe('The cloud copy could not be read, which means the two sides cannot be compared',EXPLAINS),true);
t('leaves ordinary copy alone',      probe('Cover added. It may look soft',EXPLAINS.concat(AUTHOR)),false);
t('leaves the user’s own "my" alone',probe('Your key never leaves this device.',AUTHOR),false);

for(const b of bad) console.log('      index.html:'+line(b.at)+'  ['+b.where+'] '+b.text.slice(0,90)+'\n        '+b.why);
console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
