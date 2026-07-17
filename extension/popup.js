// Popup = just the control panel. It writes the party config to chrome.storage;
// the content script (running inside AniNeko) watches storage and does the syncing.
const $ = id => document.getElementById(id);
const CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const mint = () => Array.from({ length: 6 }, () => CH[Math.floor(Math.random() * CH.length)]).join('');

async function render() {
  const { partyCode, partyName, partyOn } = await chrome.storage.local.get(['partyCode', 'partyName', 'partyOn']);
  $('name').value = partyName || '';
  if (partyOn && partyCode) {
    $('setup').style.display = 'none';
    $('live').classList.add('on');
    $('liveCode').textContent = partyCode;
  } else {
    $('setup').style.display = '';
    $('live').classList.remove('on');
  }
}

async function go(code) {
  const name = ($('name').value || '').trim();
  if (!name) { $('name').focus(); return; }
  await chrome.storage.local.set({ partyName: name, partyCode: code, partyOn: true });
  render();
}

$('start').onclick = () => go(mint());
$('join').onclick = () => {
  const c = ($('code').value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5,8}$/.test(c)) { $('code').focus(); return; }
  go(c);
};
$('leave').onclick = async () => { await chrome.storage.local.set({ partyOn: false }); render(); };
$('code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });

render();
