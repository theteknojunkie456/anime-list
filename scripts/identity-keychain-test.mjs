// DOES A RETURNING MEMBER STILL HAVE TO ASK TO JOIN?
//
// The device id and the cloud key live in localStorage, and iOS throws a
// home-screen app's localStorage away. The app then looks like a stranger:
// new id, no cloud key, so /join cannot recognise it and files another request
// for somebody who has been a member for weeks. The Keychain survives what
// localStorage does not, so the identity goes there and is seeded back before
// the page's first line runs.
//
// The dangerous part is not the storing, it is WHERE it is put back. The native
// app hands the same WKWebViewConfiguration to presentInApp, so a document-start
// script runs on whatever streaming site was opened too. Writing the cloud key
// into miruro's localStorage would hand it to a third party. These checks exist
// mostly to keep that from ever becoming true.
import { readFileSync } from 'node:fs';
const swift = readFileSync('ios-broadcast/ContentView.swift', 'utf8');
const html = readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = got === want; ok ? pass++ : fail++;
  console.log((ok ? 'ok  ' : 'FAIL') + '  ' + name + '  -> ' + JSON.stringify(got) + (ok ? '' : ' (want ' + JSON.stringify(want) + ')')); };

const seed = swift.slice(swift.indexOf('static func seedScript'), swift.indexOf('enum PWStore'));

// ── the seeded script must never leave this app's origin ──────────────────
check('the restore script checks the origin it is running on',
  /location\.hostname/.test(seed), true);
check('and names the app’s own host explicitly',
  /theteknojunkie456\.github\.io/.test(seed), true);
check('it returns early on any other host',
  /if\(!\(h===[^)]*\)\)return;/.test(seed.replace(/\s+/g, '')), true);
check('it is injected main-frame only',
  /seedScript\(\)[\s\S]{0,400}forMainFrameOnly: true/.test(swift), true);
check('and at document start, before the page reads the id',
  /seedScript\(\)[\s\S]{0,400}injectionTime: \.atDocumentStart/.test(swift), true);

// ── it restores, it does not overwrite ────────────────────────────────────
check('the cloud key is only set when none is present',
  /if\(s&&!localStorage\.getItem\('sync_animelist_v4'\)\)/.test(seed.replace(/\s+/g, '')), true);
check('and the device id likewise',
  /if\(d&&!localStorage\.getItem\('wl_device'\)\)/.test(seed.replace(/\s+/g, '')), true);

// ── the stored copy must not be destroyed by a half-booted page ───────────
const store = swift.slice(swift.indexOf('enum IDStore'), swift.indexOf('enum PWStore'));
check('saving nothing is refused rather than wiping what is there',
  /guard !sync\.isEmpty \|\| !device\.isEmpty else \{ return \}/.test(store), true);
check('a partial save merges instead of replacing',
  /var merged = read\(\) \?\? \[:\]/.test(store), true);
check('it is readable at launch, with no Face ID prompt in the way',
  /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/.test(store), true);
check('and never leaves the device in a backup',
  /ThisDeviceOnly/.test(store), true);

// ── signing out has to reach the Keychain too ─────────────────────────────
check('an explicit clear deletes the stored identity',
  /clear.*\{[\s\S]{0,200}SecItemDelete/.test(store), true);
check('clearing the cloud key tells the native side to clear it',
  /saveIdentityNative\(c\?null:\{clear:true\}\)/.test(html), true);

// ── the web build must not try any of this ────────────────────────────────
const helper = html.slice(html.indexOf('function saveIdentityNative'), html.indexOf('function syncCode()'));
check('nothing is attempted on the web build',
  /if\(typeof IS_NATIVE==='undefined'\|\|!IS_NATIVE\)return;/.test(helper), true);
check('and an empty identity is never sent',
  /if\(!msg\.sync&&!msg\.device\)return;/.test(helper), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
