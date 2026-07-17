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
| `WebRTCBroadcaster.swift` | BroadcastExt | The video engine: turns your screen into one video track and opens a connection to each viewer. |
| `SampleHandler.swift` | BroadcastExt | The extension itself — iOS hands it every screen frame; it pushes them into WebRTC. Wires everything together. |
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
- BroadcastExt only: `PartySignaling`, `WebRTCBroadcaster`, `SampleHandler`
