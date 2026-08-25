import Foundation
#if canImport(UIKit)
import UIKit
#endif

// Shared between the app and the broadcast extension WITHOUT App Groups — those
// need a PAID Apple Developer account. Instead we use a private *named* pasteboard
// as the cross-process channel (works on a free Apple ID): the app writes the party
// code / name / uid just before you start broadcasting, and the extension reads them
// when the broadcast starts. Everything is also mirrored to local UserDefaults so the
// app's own UI remembers your last code between launches.
enum AppGroup {
    // your existing party backend (the PartyRoom Durable Object)
    static let wsBase = "wss://watchlist-sync.muhammad-dac.workers.dev/party/"

    private static let pbName = "com.watchlist.party.share"
    private static let local = UserDefaults.standard

    // ── the shared blob ──────────────────────────────────────────────────────
    private static func read() -> [String: String] {
        var json: String?
        #if canImport(UIKit)
        json = UIPasteboard(name: UIPasteboard.Name(pbName), create: true)?.string
        #endif
        if json == nil || json?.isEmpty == true { json = local.string(forKey: "wl_share") }
        guard let j = json, let d = j.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: String] else { return [:] }
        return obj
    }
    private static func write(_ dict: [String: String]) {
        guard let d = try? JSONSerialization.data(withJSONObject: dict),
              let json = String(data: d, encoding: .utf8) else { return }
        #if canImport(UIKit)
        UIPasteboard(name: UIPasteboard.Name(pbName), create: true)?.string = json
        #endif
        local.set(json, forKey: "wl_share")
    }
    private static func set(_ key: String, _ value: String) {
        var s = read(); s[key] = value; write(s)
    }

    // ── the fields the app + extension use ───────────────────────────────────
    static var partyCode: String {
        get { read()["code"] ?? "" }
        set { set("code", newValue) }
    }
    static var partyName: String {
        get { let n = read()["name"] ?? ""; return n.isEmpty ? "Guest" : n }
        set { set("name", newValue) }
    }
    // The id the party keys members by — and it has to be the SAME id the web
    // page uses, or the broadcast extension joins the room as a second person.
    // It did: the page minted "u…" in localStorage, this minted "ios-…", and so
    // `sharing` came back as an id the host's own page did not recognise. The
    // host saw somebody else broadcasting and never themselves.
    static var uid: String {
        if let u = read()["uid"], !u.isEmpty { return u }
        let u = "ios-" + UUID().uuidString.prefix(12)
        set("uid", String(u))
        return String(u)
    }
    /// Adopt the page's party identity. Called when the page asks to broadcast,
    /// so the extension appears as the person who pressed the button.
    static func adoptIdentity(uid: String, name: String) {
        if !uid.isEmpty { set("uid", uid) }
        if !name.isEmpty { set("name", name) }
    }
    static var displayName: String {
        let n = read()["name"] ?? ""
        return n.isEmpty ? "Host" : n
    }
    static func partyOn(_ on: Bool) { set("on", on ? "1" : "0") }
}
