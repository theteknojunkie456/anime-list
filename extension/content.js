// WatchList Party — content script.
// Runs inside every AniNeko / player frame. The frame that actually contains the
// <video> becomes the controller: because this code runs *in the page*, it's
// same-origin with the video and can read/drive it (the thing a website embedding
// AniNeko can't do). The host's play/pause/seek is broadcast through the WatchList
// party room (a WebSocket); everyone else applies it to their own copy — so it's
// perfectly synced with no video streamed between people.
(function () {
  const WS_BASE = 'wss://watchlist-sync.muhammad-dac.workers.dev/party/';
  const DRIFT = 0.7;            // seconds out-of-sync before we hard-correct a viewer
  let video = null, ws = null, applying = false, isHost = false;
  let code = '', name = 'Guest', uid = '';

  function findVideo() {
    const v = document.querySelector('video');
    if (v && v !== video) { video = v; hookVideo(); }
    return !!video;
  }
  function hookVideo() {
    ['play', 'pause', 'seeked', 'ratechange'].forEach(ev =>
      video.addEventListener(ev, () => { if (!applying && isHost) sendPb(); }));
  }
  function sendPb() {
    if (ws && ws.readyState === 1 && video)
      ws.send(JSON.stringify({ t: 'pb', playing: !video.paused, time: video.currentTime }));
  }
  function applyPb(pb) {
    if (!video) return;
    applying = true;
    // account for the network hop so we land where the host *is now*, not where they were
    const target = (+pb.time || 0) + (pb.playing ? (Date.now() - (pb.ts || Date.now())) / 1000 : 0);
    if (Math.abs(video.currentTime - target) > DRIFT) { try { video.currentTime = target; } catch {} }
    if (pb.playing && video.paused) video.play().catch(() => {});
    else if (!pb.playing && !video.paused) video.pause();
    setTimeout(() => { applying = false; }, 250);
  }

  async function getUid() {
    const r = await chrome.storage.local.get('pu');
    if (r.pu) return r.pu;
    const n = 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    await chrome.storage.local.set({ pu: n });
    return n;
  }
  async function connect() {
    disconnect();
    uid = await getUid();
    try { ws = new WebSocket(`${WS_BASE}${code}?uid=${encodeURIComponent(uid)}&name=${encodeURIComponent(name)}&create=1`); }
    catch { badge('Couldn’t connect'); return; }
    ws.onopen = () => badge('Connecting…');
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'state') {
        isHost = (m.room.host === uid);
        badge(isHost ? 'You’re the host · you control playback' : 'In sync with the host');
        if (isHost) sendPb();                 // push current state to anyone new
      } else if (m.t === 'pb' && !isHost) {
        applyPb(m);
      } else if (m.t === 'error') {
        badge(m.msg || 'Party error'); code = ''; disconnect();
      }
    };
    ws.onclose = () => { if (code) setTimeout(() => { if (code) connect(); }, 1500); };   // resilient reconnect
    ws.onerror = () => {};
  }
  function disconnect() { if (ws) { try { ws.close(); } catch {} ws = null; } }

  async function refresh() {
    const r = await chrome.storage.local.get(['partyCode', 'partyName', 'partyOn']);
    name = r.partyName || 'Guest';
    if (r.partyOn && r.partyCode && video) {
      if (code !== r.partyCode || !ws) { code = r.partyCode; connect(); }
    } else { code = ''; disconnect(); badge(''); }
  }
  chrome.storage.onChanged.addListener(refresh);

  // little status pill so you know it's live (only in the frame that has the video)
  let pill = null;
  function badge(txt) {
    if (!video) return;
    if (!txt) { if (pill) pill.remove(); pill = null; return; }
    if (!pill) {
      pill = document.createElement('div');
      pill.style.cssText = 'position:fixed;bottom:14px;left:14px;z-index:2147483647;background:#e0325b;color:#fff;font:700 12px/1 system-ui,sans-serif;padding:8px 13px;border-radius:99px;box-shadow:0 6px 18px rgba(0,0,0,.45);pointer-events:none';
      (document.body || document.documentElement).appendChild(pill);
    }
    pill.textContent = '🎉 WatchList Party · ' + txt;
  }

  // AniNeko builds its player after load, so poll until the <video> shows up
  setInterval(() => { if (findVideo()) refresh(); }, 1000);
  findVideo();
})();
