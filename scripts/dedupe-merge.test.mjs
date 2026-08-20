import assert from 'node:assert';
// The functions under test are inline in index.html, so this extracts them.
// Run: node scripts/dedupe-merge.test.mjs
import {dedupeList} from './extract-dedupe.mjs';

// A title marked "this genuinely isn't in the database", plus a duplicate of it
// that was never marked. Collapsing them must not lose the decision.
{
  const kept=dedupeList([
    {id:'a',title:'Some Indie Thing',kind:'watch',status:'plan'},
    {id:'b',title:'some indie thing',kind:'watch',status:'plan',noLink:1},
  ]).kept;
  assert.equal(kept.length,1);
  assert.equal(kept[0].noLink,1,'noLink survived the merge');
  console.log('ok  a "not in the database" mark survives dedupe');
}
// The reverse order, too.
{
  const kept=dedupeList([
    {id:'a',title:'Some Indie Thing',kind:'watch',status:'plan',noLink:1},
    {id:'b',title:'some indie thing',kind:'watch',status:'plan'},
  ]).kept;
  assert.equal(kept[0].noLink,1);
  console.log('ok  and in the other order');
}
// A copy that DID link wins, and the stale mark is dropped rather than kept.
{
  const kept=dedupeList([
    {id:'a',title:'Frieren',kind:'watch',status:'plan',noLink:1},
    {id:'b',title:'Frieren',kind:'watch',status:'plan',aniId:154587},
  ]).kept;
  assert.equal(kept[0].aniId,154587);
  assert.equal(kept[0].noLink,undefined,'a linked item is not also "unlinkable"');
  console.log('ok  an id beats the mark, and clears it');
}
// Fields added since the merge was written come along for the ride.
{
  const kept=dedupeList([
    {id:'a',title:'Dandadan',kind:'watch',status:'plan'},
    {id:'b',title:'dandadan',kind:'watch',status:'plan',
     recFrom:[{code:'x',name:'Yasso'}],srcUrl:'https://x/y',recSaid:{added:1}},
  ]).kept;
  assert.equal(kept.length,1);
  assert.equal(kept[0].recFrom[0].name,'Yasso');
  assert.equal(kept[0].srcUrl,'https://x/y');
  assert.deepEqual(kept[0].recSaid,{added:1});
  console.log('ok  who recommended it, its pinned link and what was reported all survive');
}
console.log('\nAll dedupe-merge tests passed.');
