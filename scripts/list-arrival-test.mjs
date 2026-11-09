// WHAT HAS TO HAPPEN WHEN THE LIST ARRIVES FROM SOMEWHERE ELSE.
//
// Three separate bugs in one week shared a shape. Something derived from the
// list — the Home Screen widget, the phone's episode alarms, the set of ids the
// push server polls — was refreshed from save(), which is only the path where
// YOU changed something. A cloud sync merging another device's list, a restore
// from a code or a backup, and the IndexedDB mirror stepping in at boot all
// replace the list and call writeLocal() without ever going through save().
//
// So each of them went stale in exactly the same circumstance: the minutes
// after a device joins another device's library, which is the one moment the
// list changes the most and the one moment the owner is watching.
//
// writeLocal() is the single function that means "the list on this device
// changed". Anything derived from the list hangs off it, and this file is what
// stops the next one being hung off save() instead.
//
// run: node scripts/list-arrival-test.mjs
import {readFileSync} from 'node:fs';
let pass=0,fail=0;
const t=(n,g,e)=>{const ok=JSON.stringify(g)===JSON.stringify(e);ok?pass++:fail++;
  console.log((ok?'ok  ':'FAIL')+'  '+n+'  -> '+JSON.stringify(g)+(ok?'':' (want '+JSON.stringify(e)+')'));};

const html=readFileSync('index.html','utf8');
const body=(fn)=>{const i=html.indexOf('function '+fn+'(');return i<0?'':html.slice(i,i+2600);};
const writeLocal=body('writeLocal');
const save=html.slice(html.indexOf('\nfunction save('),html.indexOf('\nfunction save(')+900);

// ── everything derived from the list hangs off the one place ────────────────
for(const [what,call] of [['the Home Screen widget','nativeWidget()'],
                          ["the phone's episode alarms",'nativeScheduleNotifs()'],
                          ['the ids the push server polls','scheduleNotifyUpdate()']])
  t(what+' follows the list', writeLocal.includes(call), true);

// Two call sites meaning the same thing is how the first one got missed: save()
// calls writeLocal() first thing, so a copy there is both redundant and a place
// for the next person to add the fourth one.
for(const call of ['nativeWidget()','nativeScheduleNotifs()','scheduleNotifyUpdate()'])
  t('and is not duplicated in save() — '+call, save.includes(call), false);

// A locked app is an empty placeholder standing in for the real list. writeLocal
// already refuses to persist it; everything hanging off writeLocal inherits that
// refusal, which is exactly the rule the widget wanted anyway.
t('nothing derived runs while the app is locked',
  writeLocal.indexOf('if(appLocked)return;') < writeLocal.indexOf('nativeWidget()'), true);

// ── the costs that come with sharing one trigger ────────────────────────────
// writeLocal() runs on every episode tick. Each of these is expensive at the far
// end — sixty rescheduled alarms, a widget reload off a budgeted allowance, a
// write against a quota already exhausted — so each has to be able to say "this
// did not change" and do nothing.
t('an unchanged widget snapshot sends nothing', /sig===_wgLast\)return/.test(html), true);
t('an unchanged alarm set sends nothing', /sig===_nfLast\)return/.test(html), true);
t('an unchanged poll set costs no server write', /sig===_nuLast\)return/.test(html), true);

// And the de-duplication must not become a mute. Each of these three has a path
// that posts straight past the signature check; whichever does has to clear it.
t('turning alerts off clears the remembered set', /_nfLast='';window\.webkit/.test(html), true);
t('locking the app clears the remembered snapshot', /_wgLast='';clearTimeout/.test(html), true);
t('a poll set is only remembered once the send lands',
  html.indexOf('_nuLast=sig;') > html.indexOf("await fetch(NOTIFY_URL+'/update'"), true);

// ── the fourth path, which writes nothing at all ────────────────────────────
// Unlocking a protected list is an arrival like any other, but it is the one
// that cannot hang off writeLocal(): the ciphertext on disk is already correct,
// so unlocking deliberately writes nothing. On a device with a password that
// makes finishUnlock() the ONLY place the widget and the alarms are ever fed on
// a cold start — the list appears, the app looks right, and the Home Screen
// keeps drawing the list from before the password until some unrelated edit.
// Bounded to the function itself: the generous window body() uses would reach
// into tryUnlock() and beyond, and a call found there would pass for one here.
const fin=(()=>{const w=body('finishUnlock');
  const e=w.search(/\n(async )?function /);return e<0?w:w.slice(0,e);})();
t('unlocking feeds the widget', fin.includes('nativeWidget()'), true);
t('unlocking arms the episode alarms', fin.includes('nativeScheduleNotifs()'), true);
t('unlocking refreshes the poll set', fin.includes('notifyUpdate'), true);
// hideLock() is what clears appLocked, and everything above inherits writeLocal's
// refusal to act while locked. Feeding the widget before it would post the empty
// placeholder that stands in for the real list.
t('and only after the lock is actually down',
  fin.indexOf('hideLock()') < fin.indexOf('nativeWidget()'), true);

// Nothing on the alarm path ever asked whether alerts were WANTED. Before this
// was shared with writeLocal() that was rare; after, it would have re-armed
// alerts the owner switched off on every single edit.
t('alerts that were switched off are not re-armed',
  /_nativeNotifsNow[\s\S]{0,400}?notifyOn\(\)/.test(html), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
