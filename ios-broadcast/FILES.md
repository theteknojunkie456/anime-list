# What each file is (so Xcode makes sense)

You'll have **two targets** in Xcode: the **app** (what you tap to open) and the
**BroadcastExt** (the invisible screen-capture piece iOS runs while broadcasting).
Each file below is tagged with the target(s) it belongs to.

| File | Target | What it does |
|------|--------|--------------|
| `WatchListBroadcastApp.swift` | App | The app's entry point (`@main`) — just launches the one screen. |
| `ContentView.swift` | App | The single screen: type your name, **Start a party** (get a code) or **Join** one, and the system **Start Broadcast** button. |
| `AppGroup.swift` | **Both** | The shared cubbyhole — the party code/name the app saves and the extension reads. Also holds your worker URL. **Set `id` to your App Group string.** |
| `PartySignaling.swift` | BroadcastExt | Talks to your party backend over a WebSocket — learns who's watching, trades the WebRTC "handshake" (offer/answer). Same protocol the web uses. |
| `WebRTCBroadcaster.swift` | BroadcastExt | The A/V engine: turns your screen into one video track and the app-audio into one audio track, and opens a connection to each viewer. |
| `BroadcastAudioDevice.swift` | BroadcastExt | A custom WebRTC audio device that forwards the app-audio ReplayKit captures into WebRTC — *without* opening the mic or an AVAudioSession (which the extension can't afford). This is what makes host audio possible. |
| `SampleHandler.swift` | BroadcastExt | The extension itself — iOS hands it every screen frame **and audio buffer**; it pushes them into WebRTC. Wires everything together. |
| `README.md` | — | The step-by-step Xcode setup. |
| `FILES.md` | — | This file. |

## The mental model
1. You tap **Start a party** in the app → it saves a code to `AppGroup`.
2. You tap **Start Broadcast** → iOS launches **BroadcastExt** (a separate process).
3. `SampleHandler` reads the code, `PartySignaling` joins the room, `WebRTCBroadcaster`
   sends your screen to each friend. They watch in WatchList — no app needed on their end.

## Target membership cheat-sheet (the thing beginners miss)
When you drag a file into Xcode, click it and check the right box under
**File Inspector → Target Membership**:
- App only: `WatchListBroadcastApp`, `ContentView`
- Both: `AppGroup`
- BroadcastExt only: `PartySignaling`, `WebRTCBroadcaster`, `BroadcastAudioDevice`, `SampleHandler`

## This app does not update itself

The web app does: it is served from GitHub Pages, the service worker is
network-first, and a change is on every device within a reload. **The native
shell is a compiled binary.** Nothing in `ios-broadcast/` reaches a phone until
the project is rebuilt in Xcode and reinstalled.

That distinction is easy to lose, because most changes are web changes and they
appear by themselves. It has already cost one wrong diagnosis: a site opening in
Safari instead of an in-app view looked like a bug in the routing, and was
actually `presentInApp` — added 10 Aug 2026 — not being on the device.

**Native-only work is in the shell, so it needs a rebuild:**

| what | landed |
|---|---|
| Real playback position from every frame (progress becomes a measurement) | 8 Aug |
| Resume at the minute, and sessions that end by being swiped away | 8 Aug |
| Subframe message gate (`isMainFrame`) | 8 Aug |
| Sites that can't be framed open **in the app**, not Safari (`presentInApp`) | 10 Aug |
| Frame URL reported up, so the app learns what each site calls a show | 10 Aug |
| Episode alerts wait for the simulcast lag instead of the broadcast | 10 Aug |
| Watch-party live seek on real streaming sites (`seekto`) | 11 Aug |

Verified building clean against the iOS simulator SDK as of 12 Aug 2026:
`xcodebuild -project WatchListParty.xcodeproj -scheme WatchListParty -sdk iphonesimulator build` → BUILD SUCCEEDED.
