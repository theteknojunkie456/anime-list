import SwiftUI
import WebKit
import ReplayKit

// The native app IS WatchList: it loads the full web app in a web view, and adds
// the one thing the web can't do on a phone — hosting a screen broadcast. When the
// web party's "Broadcast your screen" button is tapped, the page posts to us over
// the JS bridge with the current party code; we stash it for the extension and fire
// the ReplayKit picker. So there's one app, one party, one code — no manual copying.
struct ContentView: View {
    @StateObject private var broadcaster = BroadcastController()
    var body: some View {
        WatchListShell(broadcaster: broadcaster)
            .ignoresSafeArea()
            .preferredColorScheme(.dark)
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
        // marker the web app reads (navigator.userAgent) to switch on native mode
        cfg.applicationNameForUserAgent = "WatchListNative"
        let ucc = WKUserContentController()
        ucc.add(context.coordinator, name: "wl")
        cfg.userContentController = ucc

        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.isOpaque = false
        wv.backgroundColor = UIColor(red: 0x0a/255.0, green: 0x0a/255.0, blue: 0x0c/255.0, alpha: 1)
        wv.scrollView.backgroundColor = wv.backgroundColor
        wv.allowsBackForwardNavigationGestures = true

        // the broadcast picker must live in the hierarchy to fire; keep it invisible
        broadcaster.picker.frame = CGRect(x: -20, y: -20, width: 1, height: 1)
        broadcaster.picker.alpha = 0.01
        wv.addSubview(broadcaster.picker)

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
