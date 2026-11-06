import SwiftUI
import Combine

// Carries a party code from a tapped invite link into the web view, which joins the
// party. A tiny shared bus so .onOpenURL (the App scene) and the web view's
// coordinator (ContentView) can meet without threading references through SwiftUI.
//
// Links look like  watchlist://party/BUHZZ6  (the custom scheme registered in
// Info.plist). The web app's Share button hands out an https link that bridges to
// this scheme when a friend opens it in a browser.
final class LinkRouter: ObservableObject {
    static let shared = LinkRouter()
    @Published var pendingParty: String?
    /// A title tapped on the Home Screen widget — watchlist://title/<id>.
    @Published var pendingTitle: String?

    func open(_ url: URL) {
        var code: String?
        if url.scheme == "watchlist" {
            let tail = url.pathComponents.last(where: { $0 != "/" }) ?? ""
            // Branch on the host FIRST. Without this, watchlist://title/k3f9xq
            // fell through the party path below, where a 5-to-8-character
            // alphanumeric tail is exactly what a party code looks like — so
            // tapping a widget would have tried to join a party named after a
            // row in your own list.
            switch url.host {
            case "title":
                let id = tail.filter { $0.isLetter || $0.isNumber }
                if !id.isEmpty { pendingTitle = id }
                return
            case "home":
                return                      // opening the app is the whole action
            default:
                code = tail.isEmpty ? url.host : tail
            }
        }
        if code == nil,
           let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?
               .queryItems?.first(where: { $0.name == "party" })?.value {
            code = q   // …?party=CODE
        }
        let clean = (code ?? "").uppercased().filter { $0.isLetter || $0.isNumber }
        if clean.count >= 5 && clean.count <= 8 { pendingParty = clean }
    }
}

@main
struct WatchListBroadcastApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { LinkRouter.shared.open($0) }
        }
    }
}
