import SwiftUI
import WebKit
import ReplayKit
import UserNotifications
import Security

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
        wv.allowsBackForwardNavigationGestures = true
        wv.navigationDelegate = context.coordinator
        context.coordinator.web = wv

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

        // page loaded → if we saved the password, Face ID → auto-unlock the web lock
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard PWStore.hasSaved() else { return }
            PWStore.load { pw in
                guard let pw, let web = self.web,
                      let d = try? JSONSerialization.data(withJSONObject: [pw]),
                      let arr = String(data: d, encoding: .utf8) else { return }
                let jsPw = String(arr.dropFirst().dropLast())   // ["pw"] → "pw" (escaped JS literal)
                web.evaluateJavaScript("window.wlNativeUnlock && window.wlNativeUnlock(\(jsPw))", completionHandler: nil)
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
                if let pw = body["pw"] as? String, !pw.isEmpty { PWStore.save(pw) }
            case "openurl":   // legal streaming sites can't be framed — open in Safari
                if let s = body["url"] as? String, let url = URL(string: s) {
                    DispatchQueue.main.async { UIApplication.shared.open(url) }
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
    static func save(_ pw: String) {
        guard let data = pw.data(using: .utf8) else { return }
        SecItemDelete(base() as CFDictionary)
        var q = base()
        q[kSecValueData as String] = data
        if let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .biometryCurrentSet, nil) {
            q[kSecAttrAccessControl as String] = ac
        }
        SecItemAdd(q as CFDictionary, nil)
    }
    static func hasSaved() -> Bool {
        var q = base()
        q[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUISkip   // don't prompt just to check existence
        let s = SecItemCopyMatching(q as CFDictionary, nil)
        return s == errSecSuccess || s == errSecInteractionNotAllowed
    }
    static func load(completion: @escaping (String?) -> Void) {
        var q = base()
        q[kSecReturnData as String] = true
        q[kSecUseOperationPrompt as String] = "Unlock WatchList"
        DispatchQueue.global(qos: .userInitiated).async {
            var out: CFTypeRef?
            let status = SecItemCopyMatching(q as CFDictionary, &out)
            let pw = status == errSecSuccess ? (out as? Data).flatMap { String(data: $0, encoding: .utf8) } : nil
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
