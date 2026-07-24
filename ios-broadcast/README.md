# WatchList Broadcast (native iOS) — let an iPhone host a screen-share party

This is the **iPhone-host** piece that the web can't do. It's a small native app +
a **ReplayKit Broadcast Upload Extension** (the exact mechanism Zoom/Discord use)
that captures your iPhone screen **and its audio** and streams both, over **WebRTC**,
straight to your friends. Your friends need **nothing new** — they watch in
**WatchList's existing web screen-share viewer**, on any device. This app only
replaces the *host* half.

It talks to the **same party backend** you already run — it connects to the room
over the same WebSocket and speaks the same signaling (`share` + `signal` offer/
answer) that the web host uses, so a native iOS host and web viewers just work
together.

---

## What you need
- A **Mac with Xcode** (installed).
- A **free Apple ID** is enough to run it on **your own** iPhone. Only *you* (the
  host) install it; friends use the web. No $99 account needed.
- **No App Groups** — those need a paid account, so the app and the extension share
  the party code through a private named pasteboard instead (`AppGroup.swift`).

## Build it (the project is generated for you)
The Xcode project is produced from `project.yml` by **XcodeGen**, so you don't wire
up targets by hand. It's committed as `WatchListParty.xcodeproj` — just open it. (If
you ever change the file list, regenerate with `xcodegen generate`.)

1. **Open** `ios-broadcast/WatchListParty.xcodeproj` in Xcode.
2. **Signing** — do this for **both** targets (they're in the left sidebar:
   `WatchListParty` and `BroadcastExt`):
   - Select the target → **Signing & Capabilities** tab.
   - **Team** → pick your Apple ID (add it under Xcode → Settings → Accounts if it
     isn't there — a free Apple ID is fine).
   - If Xcode complains the bundle id is taken, change `com.watchlist.party` (and the
     extension's `com.watchlist.party.BroadcastExt`) to something unique like
     `com.<yourname>.watchlist` — keep the extension id as `<app id>.BroadcastExt`.
3. **Plug your iPhone in** (unlock it, tap **Trust**). Pick it as the run
   destination at the top of Xcode.
4. Press **▶ Run**. First run: on the iPhone, go **Settings → General → VPN & Device
   Management → Developer App → Trust**, then run again.

## How to host a party
1. In the app: enter your **name**, tap **Start a party** (you get a code) — or type
   a friend's code and **Join**. Share the code; friends open it in WatchList on
   their phones/computers.
2. Tap **Start Broadcast** → in iOS's picker choose **WatchListBroadcast** → **Start
   Broadcast**. Open your anime and play.
3. The extension connects to the party as **host** and streams your screen **and its
   sound** over WebRTC to everyone in the room. Your play/pause/seek is what they see —
   they're watching your actual pixels, with the show's audio, perfectly synced.
   (On the viewer, iOS blocks autoplay-with-sound until the first tap — the viewer
   already prompts "Black screen? Tap once," and that same tap unmutes the audio.)

## The gotchas (where the real work is)
- **Extension memory (~50 MB):** the broadcast extension is a separate process with
  a hard memory cap. WebRTC video encode fits but is tight — keep the capture scale
  modest (downscale big screens), avoid retaining buffers. This is the #1 thing to
  watch; if it gets killed at runtime, downscale / framerate-limit first.
- **Audio is app-audio, not the mic:** the usual reason "iOS broadcast can't do audio"
  is that WebRTC's stock audio path opens the mic via `AVAudioSession(.playAndRecord)`,
  which fights ReplayKit for the session and busts the memory cap inside the extension.
  We dodge that with `BroadcastAudioDevice` — a custom `RTCAudioDevice` (injected via
  `RTCPeerConnectionFactory(...audioDevice:)`) that **never touches AVAudioSession or
  the mic**; it just resamples ReplayKit's `.audioApp` buffers to 48 kHz mono and feeds
  them into WebRTC's ADM. So viewers hear the *show*, not your room. It's send-only
  (playout is a deliberate no-op — the extension must not play anything back).
- **7-day expiry (free account):** apps signed with a free Apple ID stop launching
  after 7 days — just press ▶ Run again from Xcode to renew.
- **libwebrtc API drift:** `stasel/WebRTC`'s types are stable but method signatures
  can shift by version — fix small compile errors against the version pulled
  (pinned to `150.0.0` in `project.yml`).
- **Mesh limits:** peer-to-peer, so it's your iPhone's *upload* per viewer — great
  for a few friends; a big group would need a media server (not free). Cellular
  viewers may need a TURN relay (STUN-only today).

## Backend — already done
No backend work needed. The `share` / `signal` messages and the room WebSocket
already exist in `cloud/sync-worker.js` (the `PartyRoom` Durable Object). This app is
just another client of that room.
