// Which AniList entry a list item is bound to. Getting this wrong does not look
// like a bad match — it looks like the app being confidently wrong about your
// progress: "12/2 watched", the real series marked "not on your list", and a
// seasons drawer pointing at the wrong row.
// run: node scripts/title-match-test.mjs
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=n=>{const i=src.indexOf('function '+n+'(');const j=src.indexOf('\n}',i);return src.slice(i,j+2);};
// The old titleLooksRight never mentioned _SIBLING_MARK, so this still runs
// against a build from before it existed — which is how the before/after is read.
const mark=src.match(/const _SIBLING_MARK=[^;]+;/);
const code=(mark?mark[0]:'const _SIBLING_MARK=/^$/;')
  +'\nfunction _flatT(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");}\n'
  +grab('titleLooksRight')+'\nglobalThis.T=titleLooksRight;';
(0,eval)(code);
const T=globalThis.T;
let pass=0,fail=0;
const t=(cand,typed,want,why)=>{const got=T(cand,typed);const ok=got===want;ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+why.padEnd(46)+String(got)+(ok?'':'  (want '+want+')'));};

// a franchise sibling is NOT the thing you have
t('The Quintessential Quintuplets Specials','The Quintessential Quintuplets',false,'its specials');
t('The Quintessential Quintuplets Movie','The Quintessential Quintuplets',false,'its movie');
t('The Quintessential Quintuplets 2','The Quintessential Quintuplets',false,'its second season');
t('Vinland Saga Season 2','Vinland Saga',false,'a numbered season');
t('Mob Psycho 100 II','Mob Psycho 100',false,'a roman-numeral season');
t('Attack on Titan Final','Attack on Titan',false,'a final season');
t('Gintama OVA','Gintama',false,'an OVA');

// the same show, spelled differently, still is
t('The Quintessential Quintuplets','The Quintessential Quintuplets',true,'itself');
t("Frieren: Beyond Journey's End",'Frieren Beyond Journeys End',true,'punctuation only');
t("Frieren: Beyond Journey's End",'Frieren',true,'a short name expanding to its full title');
t("Extra's Academy Survival Guide",'Extras Academy Survival Guide',true,'a one-letter slip');
t('Bocchi the Rock!','bocchi the rock',true,'case and punctuation');

// and something else entirely never is
t('Monster','Vinland Saga',false,'unrelated');
t('Hunter x Hunter','Monster',false,'also unrelated');
console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
