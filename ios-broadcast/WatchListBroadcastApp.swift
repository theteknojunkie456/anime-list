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

    func open(_ url: URL) {
        var code: String?
        if url.scheme == "watchlist" {
            // watchlist://party/CODE → host "party", the code is the last path piece
            code = url.pathComponents.last(where: { $0 != "/" }) ?? url.host
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
