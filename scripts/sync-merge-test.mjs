// Three devices, one cloud, no server: exercise the real merge functions.
import { readFileSync } from 'node:fs';
const h = readFileSync('index.html', 'utf8');
const src = /const TOMB_KEY[\s\S]*?\nasync function syncPull/.exec(h)[0].replace(/\nasync function syncPull$/, '');

function device(name, list) {
  const store = {};
  const g = { localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v) } };
  const fn = new Function('localStorage', src + '; return {tombs,setTombs,tombstone,mergeTombs,mergeLists};')(g.localStorage);
  return { name, list: list.map(x => ({ ...x })), ...fn, store };
}
const T = 1000000;
const base = [
  { id: 'a', title: 'AoT', ep: 1, upd: T },
  { id: 'b', title: 'One Piece', ep: 10, upd: T },
  { id: 'c', title: 'Bleach', ep: 5, upd: T },
];
const phone = device('phone', base), desk = device('desk', base), pad = device('pad', base);

// phone watches AoT ep 5; desktop watches One Piece ep 11 — concurrently
phone.list.find(x => x.id === 'a').ep = 5; phone.list.find(x => x.id === 'a').upd = T + 100;
desk.list.find(x => x.id === 'b').ep = 11; desk.list.find(x => x.id === 'b').upd = T + 200;
// the iPad deletes Bleach
pad.tombstone('c'); pad.list = pad.list.filter(x => x.id !== 'c');
// and the phone adds a new show
phone.list.push({ id: 'd', title: 'Frieren', ep: 2, upd: T + 300 });

// each pulls the others' state, in a hostile order (pad last, holding a stale list)
let cloud = phone.list, cloudT = phone.tombs();
function sync(d) {
  d.mergeTombs(cloudT);
  d.list = d.mergeLists(d.list, cloud);
  cloud = d.list; cloudT = d.tombs();
}
sync(desk); sync(pad); sync(phone); sync(desk);

const byId = Object.fromEntries(cloud.map(x => [x.id, x]));
const checks = [
  ['AoT progress from the phone survived', byId.a && byId.a.ep === 5],
  ['One Piece progress from the desktop survived', byId.b && byId.b.ep === 11],
  ['Bleach stayed deleted, not resurrected', !byId.c],
  ['the show added on the phone reached everything', byId.d && byId.d.title === 'Frieren'],
  ['nothing else vanished', cloud.length === 3],
];
let bad = 0;
checks.forEach(([n, ok]) => { if (!ok) bad++; console.log((ok ? '  ok   ' : '  FAIL ') + n); });

// a re-add after a delete must win, since it is the newer fact
const late = device('late', []);
late.mergeTombs(cloudT);
late.list = late.mergeLists([{ id: 'c', title: 'Bleach', ep: 1, upd: Date.now() + 5000 }], cloud);
const readded = !!late.list.find(x => x.id === 'c');
if (!readded) bad++;
console.log((readded ? '  ok   ' : '  FAIL ') + 're-adding a deleted show beats the tombstone');
console.log(bad ? `\n${bad} failure(s)` : '\nthree devices converge with no lost work');
process.exit(bad ? 1 : 0);
