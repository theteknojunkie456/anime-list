# WatchList Broadcast (native iOS) — let an iPhone host a screen-share party

This is the **iPhone-host** piece that the web can't do. It's a small native app +
a **ReplayKit Broadcast Upload Extension** (the exact mechanism Zoom/Discord use)
that captures your iPhone screen and streams it, over **WebRTC**, straight to your
friends. Your friends need **nothing new** — they watch in **WatchList's existing
web screen-share viewer**, on any device. This app only replaces the *host* half.

It talks to the **same party backend** you already run — it connects to the room
over the same WebSocket and speaks the same signaling (`share` + `signal` offer/
answer) that the web host uses, so a native iOS host and web viewers just work
together.

> **Honesty up front:** I wrote this blind (I can't compile iOS here). Treat it as
> a *foundation*, not a finished app — it will need real iteration in Xcode. The
> hard part is #3 below (WebRTC inside the memory-limited broadcast extension).

---

## What you need
- A **Mac with Xcode**.
- A free Apple ID is enough to run it on **your own** iPhone (7-day re-sign). Only
  *you* (the host) install it; friends use the web. No $99 unless you want it
  stable/shareable via TestFlight.

## Project layout to create in Xcode
1. **New Xcode project** → iOS App → SwiftUI. Name it `WatchListBroadcast`.
2. **Add a Broadcast Upload Extension target**: File → New → Target → *Broadcast
   Upload Extension*. Name it `BroadcastExt`. (Uncheck "Include UI Extension".)
3. **App Group** (so the app and extension share the party code): Signing &
   Capabilities → + App Groups → add `group.com.you.watchlistparty` to **both**
   targets. Put the real id in `AppGroup.id` below.
4. **Add WebRTC** via Swift Package Manager to **both** targets:
   `https://github.com/stasel/WebRTC` (prebuilt Google libwebrtc for Swift).
5. Drop these files in:
   - App target: `WatchListBroadcastApp.swift`, `ContentView.swift`, `AppGroup.swift`
   - Extension target: `SampleHandler.swift`, `WebRTCBroadcaster.swift`, `PartySignaling.swift`, `AppGroup.swift`
   (`AppGroup.swift`, `PartySignaling.swift`, `WebRTCBroadcaster.swift` are shared —
   add them to the extension target; the app only needs `AppGroup.swift`.)

## How it works (the flow)
1. In the app: enter your **name** + a **party code** (share the code with friends,
   who join it in WatchList on their phones/computers). Tap **Start broadcast** →
   iOS shows its native "Start Broadcast" picker → pick `WatchListBroadcast`.
2. The **extension** wakes up, reads the code from the App Group, connects to the
   party WebSocket as **host**, sends `{t:'share', on:true}`, and for each friend in
   the room creates a WebRTC connection, attaches your **screen** as the video
   track, and sends an `offer`. Friends' WatchList answers and shows your screen.
3. Every screen frame ReplayKit hands the extension is pushed into the WebRTC video
   track → your friends see your live screen, perfectly synced (they're watching
   your pixels).

## The gotchas (where the real work is)
- **Extension memory (~50 MB):** the broadcast extension is a separate process with
  a hard memory cap. WebRTC video encode fits but is tight — keep the capture scale
  modest (downscale big screens), avoid retaining buffers. This is the #1 thing to
  watch; if it gets killed, downscale/framerate-limit first.
- **libwebrtc API drift:** `stasel/WebRTC`'s types (`RTCPeerConnectionFactory`,
  `RTCVideoSource`, `RTCVideoFrame`, `RTCCVPixelBuffer`) are stable but method
  signatures can shift by version — fix small compile errors against the version you
  pull.
- **Reconnect:** the WebSocket in `PartySignaling` reconnects on drop; peers rebuild
  from the next room `state`.
- **Mesh limits:** peer-to-peer, so it's your iPhone's *upload* per viewer — great
  for a few friends; a big group would need a media server (not free).

## Backend — already done
No backend work needed. `party-share` / `signal` and the room WebSocket already
exist in `cloud/sync-worker.js` (the `PartyRoom` Durable Object). This app is just
another client of that room.
