import Foundation

// Shared by the app and the broadcast extension. The app writes the party code /
// name here; the extension reads them when a broadcast starts.
enum AppGroup {
    // ⚠️ set this to the App Group id you added in Signing & Capabilities (both targets)
    static let id = "group.com.you.watchlistparty"

    // your existing party backend (the PartyRoom Durable Object)
    static let wsBase = "wss://watchlist-sync.muhammad-dac.workers.dev/party/"

    private static var defaults: UserDefaults { UserDefaults(suiteName: id) ?? .standard }

    static var partyCode: String {
        get { defaults.string(forKey: "partyCode") ?? "" }
        set { defaults.set(newValue, forKey: "partyCode") }
    }
    static var partyName: String {
        get { defaults.string(forKey: "partyName") ?? "Guest" }
        set { defaults.set(newValue, forKey: "partyName") }
    }
    // stable per-device id (the party worker keys members by uid)
    static var uid: String {
        if let u = defaults.string(forKey: "uid") { return u }
        let u = "ios-" + UUID().uuidString.prefix(12)
        defaults.set(String(u), forKey: "uid")
        return String(u)
    }
}
