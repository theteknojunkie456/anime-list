import SwiftUI
import WebKit
import ReplayKit
import UserNotifications
import Security
import Combine
import LocalAuthentication

// The native app IS WatchList: it loads the full web app in a web view and adds the
// things a web view can't do itself —
//  • Face ID unlock: your list is AES-encrypted behind a password, and web Face ID
//    (WebAuthn) can't run in a web view. So we save the password in the iPhone
//    Keychain behind Face ID and auto-fill it into the web lock after a glance.
//  • Broadcast: the party's "Broadcast your screen" posts the code over the bridge;
//    we stash it for the extension and fire the ReplayKit picker.
//  • Notifications: no web push in a web view, so we schedule free on-device local
//    notifications from the air times the web app hands us.
struct ContentView: View {
    @StateObject private var broadcaster = BroadcastController()
    var body: some View {
        WatchListShell(broadcaster: broadcaster)
            .ignoresSafeArea()
            .preferredColorScheme(.dark)
            .onAppear { Notifier.requestAuth() }
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
        cfg.applicationNameForUserAgent = "WatchListNative"   // web app switches on native mode
        cfg.websiteDataStore = .default()                      // persist login/list across launches
        let ucc = WKUserContentController()
        ucc.add(context.coordinator, name: "wl")
        cfg.userContentController = ucc

        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.isOpaque = false
        wv.backgroundColor = UIColor(red: 0x0a/255.0, green: 0x0a/255.0, blue: 0x0c/255.0, alpha: 1)
        wv.scrollView.backgroundColor = wv.backgroundColor
        // WKWebView ignores the page's user-scalable=no and still pinch-zooms, which
        // swallows the web app's two-finger "summon AI" gesture. Disable webview zoom
        // so two fingers reach the page.
        wv.scrollView.pinchGestureRecognizer?.isEnabled = false
        wv.scrollView.minimumZoomScale = 1; wv.scrollView.maximumZoomScale = 1
        wv.scrollView.bouncesZoom = false
        wv.allowsBackForwardNavigationGestures = true
        wv.navigationDelegate = context.coordinator
        context.coordinator.web = wv
        context.coordinator.observeLinks()

        broadcaster.picker.frame = CGRect(x: -20, y: -20, width: 1, height: 1)
        broadcaster.picker.alpha = 0.01
        wv.addSubview(broadcaster.picker)   // must be in the hierarchy to fire

        wv.load(URLRequest(url: siteURL))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let broadcaster: BroadcastController
        weak var web: WKWebView?
        init(broadcaster: BroadcastController) { self.broadcaster = broadcaster }

        // Deep-link → join-party plumbing. A tapped invite link (watchlist://party/CODE)
        // sets LinkRouter.pendingParty; we forward it to the web app's window.wlJoinParty
        // once the page has finished loading.
        var pageLoaded = false
        var pendingParty: String?
        private var linkSub: AnyCancellable?
        func observeLinks() {
            linkSub = LinkRouter.shared.$pendingParty.sink { [weak self] code in
                guard let self, let code, !code.isEmpty else { return }
                self.pendingParty = code
                self.flushParty()
            }
        }
        func flushParty() {
            guard pageLoaded, let code = pendingParty, let web = web else { return }
            let safe = code.filter { $0.isLetter || $0.isNumber }   // never inject anything but A–Z/0–9
            guard safe.count >= 5 else { pendingParty = nil; return }
            web.evaluateJavaScript("window.wlJoinParty && window.wlJoinParty('\(safe)')", completionHandler: nil)
            pendingParty = nil
        }

        // page loaded → if we saved the password, Face ID → auto-unlock the web lock
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let saved = PWStore.hasSaved()
            NSLog("WatchList: page loaded — password in Keychain? %@", saved ? "yes" : "no (unlock once in the app to save it)")
            pageLoaded = true
            flushParty()   // a pending invite link → join now that the web app is up
            guard saved else { return }
            PWStore.load { pw in
                NSLog("WatchList: Face ID unlock → %@", pw != nil ? "got password, filling" : "no password (denied/failed)")
                if let pw { self.fillPassword(pw) }
            }
        }

        // Fill the web lock's password field and submit it.
        private func fillPassword(_ pw: String) {
            guard let web = self.web,
                  let d = try? JSONSerialization.data(withJSONObject: [pw]),
                  let arr = String(data: d, encoding: .utf8) else { return }
            let jsPw = String(arr.dropFirst().dropLast())   // ["pw"] → "pw" (escaped JS literal)
            web.evaluateJavaScript("window.wlNativeUnlock && window.wlNativeUnlock(\(jsPw))", completionHandler: nil)
        }

        // The web lock's "Unlock with Face ID" button (native build) posts {type:"faceid"}.
        func triggerFaceID() {
            guard PWStore.hasSaved() else {
                NSLog("WatchList: Face ID tapped but no saved password — need one password unlock first")
                web?.evaluateJavaScript("window.wlFaceMsg && window.wlFaceMsg('Unlock with your password once to turn on Face ID.')", completionHandler: nil)
                return
            }
            PWStore.load { pw in
                NSLog("WatchList: Face ID (manual) → %@", pw != nil ? "got password, filling" : "no password (denied/failed)")
                if let pw { self.fillPassword(pw) }
            }
        }

        func userContentController(_ ucc: WKUserContentController, didReceive msg: WKScriptMessage) {
            guard let body = msg.body as? [String: Any] else { return }
            switch body["type"] as? String ?? "" {
            case "code":
                let c = (body["code"] as? String ?? "").uppercased(); if !c.isEmpty { AppGroup.partyCode = c }
            case "broadcast":
                let c = (body["code"] as? String ?? "").uppercased(); if !c.isEmpty { AppGroup.partyCode = c }
                AppGroup.partyOn(true)
                DispatchQueue.main.async { self.broadcaster.start() }
            case "notify":
                if let items = body["items"] as? [[String: Any]] { Notifier.schedule(items) }
            case "savepw":
                if let pw = body["pw"] as? String, !pw.isEmpty { PWStore.save(pw); NSLog("WatchList: password saved to Keychain (Face ID armed for next launch)") }
            case "faceid":
                DispatchQueue.main.async { self.triggerFaceID() }
            case "openurl":   // legal streaming sites can't be framed — open in Safari
                if let s = body["url"] as? String {
                    // fall back to percent-encoding if the raw string won't parse
                    let url = URL(string: s)
                        ?? s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed).flatMap { URL(string: $0) }
                    if let url = url {
                        NSLog("WatchList: openurl → %@", url.absoluteString)
                        DispatchQueue.main.async { UIApplication.shared.open(url, options: [:], completionHandler: nil) }
                    } else {
                        NSLog("WatchList: openurl FAILED to parse %@", s)
                    }
                }
            default: break
            }
        }
    }
}

// Stores the WatchList password in the Keychain, guarded by Face ID (biometryCurrentSet,
// this-device-only). Saving is silent; reading prompts Face ID.
enum PWStore {
    private static let service = "com.watchlist.party.pw"
    private static let account = "watchlist"
    private static func base() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
    // Store the password in a PLAIN, device-only Keychain item — no biometric access
    // control on the item itself. Face ID is enforced separately at read time via
    // LAContext (below). This is far more reliable than a biometryCurrentSet item,
    // which can fail to add/read silently — and LAContext returns real error codes.
    static func save(_ pw: String) {
        guard let data = pw.data(using: .utf8) else { return }
        SecItemDelete(base() as CFDictionary)   // clears any old biometry-gated item too
        var q = base()
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let st = SecItemAdd(q as CFDictionary, nil)
        NSLog("WatchList: PWStore.save SecItemAdd status=%d (%@)", Int(st), st == errSecSuccess ? "ok" : "FAILED")
    }
    static func hasSaved() -> Bool {
        var q = base()
        q[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUISkip
        let s = SecItemCopyMatching(q as CFDictionary, nil)
        return s == errSecSuccess
    }
    // Read the stored password (no prompt — item isn't biometry-gated).
    private static func read() -> String? {
        var q = base()
        q[kSecReturnData as String] = true
        var out: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st != errSecSuccess { NSLog("WatchList: PWStore.read status=%d", Int(st)); return nil }
        return (out as? Data).flatMap { String(data: $0, encoding: .utf8) }
    }
    // Prompt Face ID via LAContext; on success, hand back the stored password.
    static func load(completion: @escaping (String?) -> Void) {
        let ctx = LAContext()
        ctx.localizedFallbackTitle = ""   // no "Enter Password" — the app has its own lock
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else {
            NSLog("WatchList: Face ID unavailable — %@", err?.localizedDescription ?? "unknown")
            DispatchQueue.main.async { completion(nil) }
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Unlock WatchList") { ok, e in
            NSLog("WatchList: Face ID evaluate → %@ %@", ok ? "success" : "fail", e?.localizedDescription ?? "")
            let pw = ok ? read() : nil
            DispatchQueue.main.async { completion(pw) }
        }
    }
}

// Free, no-server episode alerts scheduled on-device from the air times the web app
// sends over the bridge.
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

// Owns the system broadcast picker and fires it on demand (its own button is a tiny
// ~44pt target that's easy to miss). We keep it in the hierarchy and trigger its
// internal UIButton programmatically.
final class BroadcastController: ObservableObject {
    let picker: RPSystemBroadcastPickerView = {
        let v = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        v.showsMicrophoneButton = false
        v.preferredExtension = "com.humblezone.watchlist.BroadcastExt"
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
