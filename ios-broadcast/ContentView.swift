import SwiftUI
import WebKit
import ReplayKit
import LocalAuthentication
import UserNotifications

// The native app IS WatchList: it loads the full web app in a web view, adds a
// native Face ID lock (embedded web views can't use the web Face ID), and adds the
// one thing the web can't do on a phone — hosting a screen broadcast. The party
// screen-share button posts the current code over the JS bridge; we stash it for
// the extension and fire the ReplayKit picker. One app, one party, one code.
struct ContentView: View {
    @StateObject private var broadcaster = BroadcastController()
    @State private var unlocked = false
    @State private var authing = false

    var body: some View {
        ZStack {
            Color(hex: 0x0a0a0c).ignoresSafeArea()
            if unlocked {
                WatchListShell(broadcaster: broadcaster).ignoresSafeArea()
            } else {
                LockView(authenticate: authenticate)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear { authenticate() }
    }

    private func authenticate() {
        if unlocked || authing { return }
        let ctx = LAContext()
        ctx.localizedFallbackTitle = "Use Passcode"
        var err: NSError?
        // no biometrics AND no passcode set → don't trap the user, just open
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { unlocked = true; return }
        let policy: LAPolicy = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
            ? .deviceOwnerAuthenticationWithBiometrics : .deviceOwnerAuthentication
        authing = true
        ctx.evaluatePolicy(policy, localizedReason: "Unlock WatchList") { ok, _ in
            DispatchQueue.main.async {
                authing = false
                if ok { unlocked = true; Notifier.requestAuth() }
            }
        }
    }
}

// Free, no-server episode alerts. The web app knows every upcoming episode's air
// time (AniList); it hands us that list over the bridge and we schedule on-device
// local notifications — which iOS fires on the lock screen even when we're closed.
// No push server, no paid account. Rescheduled every time the web app sends a fresh
// list (on launch / when airing data updates).
enum Notifier {
    static func requestAuth() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }
    static func schedule(_ items: [[String: Any]]) {
        let c = UNUserNotificationCenter.current()
        c.removeAllPendingNotificationRequests()
        let now = Date().timeIntervalSince1970
        var scheduled = 0
        for it in items {
            guard let title = it["title"] as? String else { continue }
            let at = (it["at"] as? Double) ?? (it["at"] as? NSNumber)?.doubleValue ?? 0
            if at <= now + 60 || scheduled >= 60 { continue }   // future only; iOS caps ~64 pending
            let ep = (it["ep"] as? Int) ?? (it["ep"] as? NSNumber)?.intValue ?? 0
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = ep > 0 ? "Episode \(ep) is out now" : "A new episode is out now"
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: at - now, repeats: false)
            c.add(UNNotificationRequest(identifier: "wl-\(title)-\(ep)", content: content, trigger: trigger))
            scheduled += 1
        }
    }
}

struct LockView: View {
    let authenticate: () -> Void
    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "faceid")
                .font(.system(size: 54))
                .foregroundStyle(Color(hex: 0xda374f))
            Text("WatchList")
                .font(.system(size: 30, weight: .heavy))
                .foregroundStyle(Color(hex: 0xf0ecea))
            Button(action: authenticate) {
                Text("Unlock").font(.headline.weight(.bold)).foregroundStyle(.white)
                    .padding(.horizontal, 30).padding(.vertical, 13)
                    .background(Color(hex: 0xda374f)).clipShape(Capsule())
            }
            .padding(.top, 6)
        }
    }
}

extension Color {
    init(hex: UInt) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255, opacity: 1)
    }
}

struct WatchListShell: UIViewRepresentable {
    let broadcaster: BroadcastController
    private let siteURL = URL(string: "https://theteknojunkie456.github.io/anime-list/")!

    func makeCoordinator() -> Coordinator { Coordinator(broadcaster: broadcaster) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "WatchListNative"   // web app reads this to enable native broadcast
        cfg.websiteDataStore = .default()                      // persist login/list across launches
        let ucc = WKUserContentController()
        ucc.add(context.coordinator, name: "wl")
        cfg.userContentController = ucc

        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.isOpaque = false
        wv.backgroundColor = UIColor(red: 0x0a/255.0, green: 0x0a/255.0, blue: 0x0c/255.0, alpha: 1)
        wv.scrollView.backgroundColor = wv.backgroundColor
        wv.allowsBackForwardNavigationGestures = true

        broadcaster.picker.frame = CGRect(x: -20, y: -20, width: 1, height: 1)
        broadcaster.picker.alpha = 0.01
        wv.addSubview(broadcaster.picker)   // must be in the hierarchy to fire

        wv.load(URLRequest(url: siteURL))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let broadcaster: BroadcastController
        init(broadcaster: BroadcastController) { self.broadcaster = broadcaster }
        func userContentController(_ ucc: WKUserContentController, didReceive msg: WKScriptMessage) {
            guard let body = msg.body as? [String: Any] else { return }
            let type = body["type"] as? String ?? ""
            let code = (body["code"] as? String ?? "").uppercased()
            switch type {
            case "code":
                if !code.isEmpty { AppGroup.partyCode = code }
            case "broadcast":
                if !code.isEmpty { AppGroup.partyCode = code }
                AppGroup.partyOn(true)
                DispatchQueue.main.async { self.broadcaster.start() }
            case "notify":
                if let items = body["items"] as? [[String: Any]] { Notifier.schedule(items) }
            default: break
            }
        }
    }
}

// Owns the system broadcast picker and fires it on demand (its own button is a tiny
// ~44pt target that's easy to miss). We keep it in the hierarchy and trigger its
// internal UIButton programmatically.
final class BroadcastController: ObservableObject {
    let picker: RPSystemBroadcastPickerView = {
        let v = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        v.showsMicrophoneButton = false
        v.preferredExtension = "com.watchlist.party.BroadcastExt"
        return v
    }()
    func start() {
        func button(in v: UIView) -> UIButton? {
            if let b = v as? UIButton { return b }
            for s in v.subviews { if let b = button(in: s) { return b } }
            return nil
        }
        button(in: picker)?.sendActions(for: .touchUpInside)
    }
}
