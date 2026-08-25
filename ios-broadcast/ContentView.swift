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
    // Static so the nested Coordinator can reach it too (a nested type may use the
    // enclosing type's private members in the same file, but an INSTANCE property
    // needs an instance, and the coordinator has none).
    fileprivate static let siteURL = URL(string: "https://theteknojunkie456.github.io/anime-list/")!

    func makeCoordinator() -> Coordinator { Coordinator(broadcaster: broadcaster) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "WatchListNative"   // web app switches on native mode
        cfg.websiteDataStore = .default()                      // persist login/list across launches
        let ucc = WKUserContentController()
        ucc.add(context.coordinator, name: "wl")
        // Injected into EVERY frame, cross-origin ones included. That is the whole
        // point: a page cannot read another origin's <video>, but the app hosting
        // the web view can put a script inside that origin, and from in there the
        // element is just a local DOM node. This is what turns progress from a
        // guess into a measurement — the web build has no equivalent and cannot.
        //
        // It reports position only, only while something is actually playing, and
        // only from frames that have media, so the main frame stays silent.
        ucc.addUserScript(WKUserScript(source: Self.probeSource(resumeAt: 0),
                                       injectionTime: .atDocumentEnd,
                                       forMainFrameOnly: false))
        context.coordinator.ucc = ucc
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
        wv.uiDelegate = context.coordinator   // grants mic access to the web app (voice/Jitsi)
        context.coordinator.web = wv
        context.coordinator.observeLinks()
        // iOS warns before it suspends; the web layer often doesn't hear it in
        // time, and a session that ends by being swiped away or killed fires
        // nothing at all. Poke the page on both so the last position is banked
        // while there's still a runloop to bank it on.
        context.coordinator.observeLifecycle()

        broadcaster.picker.frame = CGRect(x: -20, y: -20, width: 1, height: 1)
        broadcaster.picker.alpha = 0.01
        wv.addSubview(broadcaster.picker)   // must be in the hierarchy to fire

        wv.load(URLRequest(url: Self.siteURL))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    /// Runs inside every frame. Finds the largest playing media element, and
    /// reports where it is every few seconds. Nothing else is read and nothing is
    /// written — this sits inside other people's sites and should behave like it.
    /// Built per navigation so the resume point can be baked in — WKUserScript
    /// has no channel of its own, and there is no public way to evaluate JS in a
    /// named subframe, so the value travels with the script instead.
    static func probeSource(resumeAt: Double) -> String {
        return "window.__wlResume=\(Int(max(0, resumeAt)));\n" + playbackProbe
    }
    static let playbackProbe = #"""
    (function () {
      if (window.__wlProbe) return; window.__wlProbe = 1;
      var seeked = false;
      function tryResume(v) {
        // Once per frame, only forward, and never into the last stretch — landing
        // on the credits would be worse than starting from the top.
        if (seeked || !window.__wlResume) return;
        var to = +window.__wlResume;
        if (!(to > 30) || !isFinite(v.duration) || to > v.duration * 0.9) { seeked = true; return; }
        if (v.currentTime > to - 5) { seeked = true; return; }
        seeked = true;
        try { v.currentTime = to; } catch (e) {}
        // Setting currentTime is a request, not a guarantee: plenty of players
        // wrap the element, refuse a seek before their own buffering is ready, or
        // snap straight back. Check whether it actually took, and say so — an app
        // that promises "resume at 12:04" and silently starts from zero is worse
        // than one that admits it can't.
        setTimeout(function () {
          var ok = Math.abs(v.currentTime - to) < 15;
          try { window.webkit.messageHandlers.wl.postMessage({ type: 'seek', ok: ok, to: to }); } catch (e) {}
        }, 1200);
      }
      function pick() {
        var best = null, area = 0;
        var els = document.querySelectorAll('video');
        for (var i = 0; i < els.length; i++) {
          var v = els[i];
          if (v.paused || v.ended || !isFinite(v.duration) || v.duration <= 60) continue;
          var a = (v.clientWidth || 0) * (v.clientHeight || 0);
          if (a >= area) { area = a; best = v; }
        }
        return best;
      }
      function tick() {
        try {
          var v = pick(); if (!v) return;
          tryResume(v);
          window.webkit.messageHandlers.wl.postMessage({
            type: 'play', t: v.currentTime, d: v.duration, paused: !!v.paused
          });
        } catch (e) {}
      }
      // Metadata is what makes duration known, and duration is what makes a seek
      // safe — so try again the moment it arrives, not only on the slow tick.
      document.addEventListener('loadedmetadata', function (e) {
        var v = e.target; if (v && v.tagName === 'VIDEO') { try { tryResume(v); } catch (err) {} }
      }, true);
      setInterval(tick, 5000);
      document.addEventListener('play', tick, true);
      document.addEventListener('pause', tick, true);
    })();
    """#

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        // Let the web app use the mic (voice chat + the embedded Jitsi call). Without a
        // WKUIDelegate granting this, iOS 15+ denies getUserMedia inside the web view and
        // voice silently fails. The mic prompt itself is gated by NSMicrophoneUsageDescription.
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(.grant)
        }
        let broadcaster: BroadcastController
        weak var web: WKWebView?
        weak var ucc: WKUserContentController?
        var pendingResume: Double = 0
        var playingFrame: WKFrameInfo?

        /// A full-screen web view inside the app, sharing the main view's
        /// configuration so injected scripts and cookies come with it.
        func presentInApp(_ url: URL) {
            guard let cfg = web?.configuration,
                  let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let root = scene.keyWindow?.rootViewController else {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)   // last resort
                return
            }
            var top = root
            while let p = top.presentedViewController { top = p }
            let vc = InAppWebController(url: url, configuration: cfg)
            vc.modalPresentationStyle = .fullScreen
            top.present(vc, animated: true)
        }

        func observeLifecycle() {
            let nc = NotificationCenter.default
            for n in [UIApplication.willResignActiveNotification,
                      UIApplication.didEnterBackgroundNotification,
                      UIApplication.willTerminateNotification] {
                nc.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in
                    self?.web?.evaluateJavaScript("try{window.flushPos&&window.flushPos()}catch(e){}",
                                                  in: nil, in: .page, completionHandler: nil)
                }
            }
        }
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
        // "It crashes when I join voice chat." The app is not crashing — iOS is
        // killing the web view's content process, which is a separate process
        // under its own memory limit. Joining a call loads a whole second web app
        // plus WebRTC encoders into that process, and on an older phone it goes
        // over. Nothing is reported: the view simply goes blank and stays blank,
        // which from the outside is indistinguishable from a crash.
        //
        // Unhandled, a terminated content process leaves a dead white view
        // forever. Reloading brings the app straight back, and because the list
        // lives in local storage rather than in the page, nothing is lost.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            NSLog("WatchList: web content process was terminated (likely memory) — reloading")
            pageLoaded = false
            if webView.url != nil {
                webView.reload()
            } else {
                webView.load(URLRequest(url: WatchListShell.siteURL))
            }
        }
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
            let kind = body["type"] as? String ?? ""

            // A message handler is reachable from EVERY frame, and this app frames
            // third-party streaming sites by design. Without this check any of them
            // could have called savepw, broadcast or openurl — writing the Keychain,
            // starting a screen broadcast, or opening a URL of their choosing. Only
            // 'play' is expected from a subframe; everything else must come from the
            // app's own page.
            if kind != "play" && !msg.frameInfo.isMainFrame {
                NSLog("WatchList: REFUSED '%@' from a subframe (%@)", kind,
                      msg.frameInfo.securityOrigin.host)
                return
            }
            if kind == "seek" {
                let ok = (body["ok"] as? Bool) ?? false
                let js = "try{window.wlNativeSeek&&window.wlNativeSeek(\(ok ? "true" : "false"))}catch(e){}"
                DispatchQueue.main.async { [weak self] in
                    self?.web?.evaluateJavaScript(js, in: nil, in: .page, completionHandler: nil)
                }
                return
            }
            if kind == "play" {
                guard let t = body["t"] as? Double, let d = body["d"] as? Double,
                      t.isFinite, d.isFinite, d > 60, t >= 0, t <= d + 1 else { return }
                // A resume point is single-use. Once a player has reported, the
                // frame carrying it has already seeked or already declined to, and
                // leaving it armed means the NEXT thing to load — the next episode
                // via the site's own link, or the site reloading itself — would be
                // sent to a timestamp that belonged to something else.
                if pendingResume > 0 {
                    pendingResume = 0
                    DispatchQueue.main.async { [weak self] in
                        guard let ucc = self?.ucc else { return }
                        ucc.removeAllUserScripts()
                        ucc.addUserScript(WKUserScript(source: WatchListShell.probeSource(resumeAt: 0),
                                                       injectionTime: .atDocumentEnd,
                                                       forMainFrameOnly: false))
                    }
                }
                let paused = (body["paused"] as? Bool) ?? false
                // The address of the frame that is actually playing video is the
                // single most reliable thing a site ever tells us about what it
                // calls a show — and it costs the viewer nothing to say it. Taken
                // from frameInfo, never from the page: a script in an ad frame can
                // post any body it likes, but it cannot forge where it is running.
                // The frame that reports playback is the one holding the <video>.
                // Keep it: a resume point can only be delivered to a NEW frame (the
                // injected script carries it at load), so live seeking — which is
                // what watching together needs — has to talk to this one directly.
                playingFrame = msg.frameInfo
                var frameJS = "''"
                if let u = msg.frameInfo.request.url?.absoluteString, !u.isEmpty,
                   let enc = try? JSONSerialization.data(withJSONObject: [u]),
                   let arr = String(data: enc, encoding: .utf8) {
                    frameJS = "\(arr)[0]"
                }
                // Hand it to the app's own page, which is where progress lives.
                let js = String(format: "window.wlNativePlayback&&window.wlNativePlayback({t:%f,d:%f,paused:%@,frame:%@})",
                                t, d, paused ? "true" : "false", frameJS)
                DispatchQueue.main.async { [weak self] in
                    self?.web?.evaluateJavaScript(js, in: nil,
                                                  in: .page, completionHandler: nil)
                }
                return
            }
            // Live seek, for watching together. Everything else about resuming
            // works by injecting a position into the next page load; a party has
            // to move a video that is already running, in a frame we do not own
            // and cannot reach across origins from JS. We can reach it from here,
            // because WKWebView will evaluate script in a specific frame.
            if kind == "seekto" {
                let t = (body["t"] as? Double) ?? -1
                guard t >= 0, let f = playingFrame else { return }
                let js = "(function(){try{var b=null,a=0,v=document.querySelectorAll('video');"
                       + "for(var i=0;i<v.length;i++){var e=v[i];if(!isFinite(e.duration)||e.duration<=60)continue;"
                       + "var s=(e.clientWidth||0)*(e.clientHeight||0);if(s>=a){a=s;b=e;}}"
                       + "if(b&&Math.abs(b.currentTime-\(t))>2.5)b.currentTime=\(t);}catch(e){}})();"
                DispatchQueue.main.async { [weak self] in
                    self?.web?.evaluateJavaScript(js, in: f, in: .page, completionHandler: nil)
                }
                return
            }
            if kind == "resume" {
                let t = (body["t"] as? Double) ?? 0
                pendingResume = t
                // Replace the injected script so the NEXT navigation carries the
                // new point. Existing frames keep the old one, which is correct:
                // they've already resumed, or already declined to.
                DispatchQueue.main.async { [weak self] in
                    guard let ucc = self?.ucc else { return }
                    ucc.removeAllUserScripts()
                    ucc.addUserScript(WKUserScript(source: WatchListShell.probeSource(resumeAt: t),
                                                   injectionTime: .atDocumentEnd,
                                                   forMainFrameOnly: false))
                }
                return
            }
            switch kind {
            case "code":
                let c = (body["code"] as? String ?? "").uppercased(); if !c.isEmpty { AppGroup.partyCode = c }
            case "broadcast":
                let c = (body["code"] as? String ?? "").uppercased(); if !c.isEmpty { AppGroup.partyCode = c }
                // Join as the person who pressed the button, not as a new member.
                AppGroup.adoptIdentity(uid: body["uid"] as? String ?? "",
                                       name: body["name"] as? String ?? "")
                AppGroup.partyOn(true)
                DispatchQueue.main.async { self.broadcaster.start() }
            case "notify":
                if let items = body["items"] as? [[String: Any]] { Notifier.schedule(items) }
            case "savepw":
                if let pw = body["pw"] as? String, !pw.isEmpty { PWStore.save(pw); NSLog("WatchList: password saved to Keychain (Face ID armed for next launch)") }
            case "faceid":
                DispatchQueue.main.async { self.triggerFaceID() }
            case "openurl":
                // These sites refuse to be FRAMED — that's all X-Frame-Options and
                // frame-ancestors say. Neither restricts a top-level load, so a site
                // that can't be an iframe opens perfectly well as the main document
                // of a second web view. Handing it to Safari was throwing the app
                // away for a restriction that never applied to this case.
                //
                // It's built from the same configuration as the main view, so the
                // playback probe is injected there too and progress keeps tracking on
                // sites that can't be framed — which is most of the ones worth
                // opening this way.
                if let s = body["url"] as? String {
                    // fall back to percent-encoding if the raw string won't parse
                    let url = URL(string: s)
                        ?? s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed).flatMap { URL(string: $0) }
                    // Independent trust boundary: only ever hand http(s) links onward.
                    // The web app's openExternal already blocks other schemes, but this
                    // handler must enforce the same policy itself — a custom/tel/mailto
                    // scheme could otherwise trigger unintended actions.
                    let scheme = url?.scheme?.lowercased()
                    if let url = url, scheme == "http" || scheme == "https" {
                        NSLog("WatchList: openurl (in-app) → %@", url.absoluteString)
                        DispatchQueue.main.async { [weak self] in self?.presentInApp(url) }
                    } else {
                        NSLog("WatchList: openurl REFUSED (non-http scheme or unparseable): %@", s)
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
    // `at` is the Japanese broadcast slot. Firing on it buzzes the phone before
    // anything subtitled exists — the notification pulls you into the app for an
    // episode no source has yet, which is worse than arriving late. Each item
    // carries `lag`, what the web side has learned about that title's own source;
    // the hour is only the fallback for a source with no track record yet.
    static let subLagDefault: TimeInterval = 3600
    static let subLagMax: TimeInterval = 6 * 3600
    static func schedule(_ items: [[String: Any]]) {
        let c = UNUserNotificationCenter.current()
        c.removeAllPendingNotificationRequests()
        let now = Date().timeIntervalSince1970
        var scheduled = 0
        for it in items {
            guard let title = it["title"] as? String else { continue }
            let raw = (it["at"] as? Double) ?? (it["at"] as? NSNumber)?.doubleValue ?? 0
            let sent = (it["lag"] as? Double) ?? (it["lag"] as? NSNumber)?.doubleValue ?? 0
            let lag = sent > 0 ? min(sent, subLagMax) : subLagDefault
            let at = raw > 0 ? raw + lag : 0
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

/// The in-app browser used for sites that refuse to be framed. Deliberately a
/// WKWebView rather than SFSafariViewController: Safari's controller runs in
/// another process, so the playback probe can't be injected and progress would
/// stop being tracked the moment a site couldn't be framed.
final class InAppWebController: UIViewController {
    private let url: URL
    private let configuration: WKWebViewConfiguration
    private var web: WKWebView!

    init(url: URL, configuration: WKWebViewConfiguration) {
        self.url = url
        self.configuration = configuration
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x0a/255.0, green: 0x0a/255.0, blue: 0x0c/255.0, alpha: 1)

        web = WKWebView(frame: .zero, configuration: configuration)
        web.allowsBackForwardNavigationGestures = true
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)

        let close = UIButton(type: .system)
        close.setTitle("Done", for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        close.tintColor = .white
        close.backgroundColor = UIColor(white: 0, alpha: 0.55)
        close.layer.cornerRadius = 16
        close.contentEdgeInsets = UIEdgeInsets(top: 6, left: 14, bottom: 6, right: 14)
        close.addTarget(self, action: #selector(done), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)

        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
        ])
        web.load(URLRequest(url: url))
    }

    @objc private func done() { dismiss(animated: true) }
}
