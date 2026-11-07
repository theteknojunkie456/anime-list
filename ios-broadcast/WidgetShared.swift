import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// What the Home Screen widget shows, and the one place the app and the widget
// agree on it.
//
// The widget is a SEPARATE PROCESS. It cannot see the web view, it cannot read
// localStorage, and it runs at moments iOS picks — often while the app is not
// running at all. So it never computes anything: the web app hands the shell a
// small snapshot whenever the list changes, the shell writes it into the App
// Group container, and the widget renders whatever it finds there.
//
// App Groups are the real mechanism here, unlike the party code, which travels
// through a named pasteboard because this project once believed App Groups
// needed a paid account. They do — and this account IS paid (the team has
// TestFlight provisioning profiles). A pasteboard would have been wrong for the
// widget anyway: named pasteboards do not survive a reboot, and a widget that
// goes blank every time the phone restarts is worse than no widget.
// ─────────────────────────────────────────────────────────────────────────────
enum WidgetShare {
    static let appGroup = "group.com.humblezone.watchlist"

    static var container: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }
    static var snapshotURL: URL? { container?.appendingPathComponent("widget.json") }
    static var artDir: URL? {
        guard let c = container else { return nil }
        let d = c.appendingPathComponent("art", isDirectory: true)
        if !FileManager.default.fileExists(atPath: d.path) {
            try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        }
        return d
    }
    /// Art is keyed by the title's id, not by its URL: the URL can change when
    /// somebody re-picks a cover, and a stale file under the old name would
    /// never be collected.
    ///
    /// Two shapes per title. The small widget is a square-ish crop of the
    /// portrait cover; the medium one is twice as wide as it is tall, and a
    /// portrait cover cropped to that is a band across somebody's chin. The
    /// banner is the art that was drawn to be wide.
    static func artURL(_ id: String, wide: Bool = false) -> URL? {
        guard let d = artDir, !id.isEmpty else { return nil }
        let safe = id.replacingOccurrences(of: "/", with: "_")
        return d.appendingPathComponent(safe + (wide ? "-w.jpg" : ".jpg"))
    }
}

/// One title you are part-way through.
struct WLUpNext: Codable, Identifiable, Equatable {
    var id: String = ""
    var title: String = ""
    var ep: Int = 0          // the episode to watch next
    var total: Int = 0       // 0 when nobody knows how many there are
    var img: String = ""     // remote cover; the shell caches it into the container
    var banner: String = ""  // the wide art, when the title has any
}

/// The next episode due to land, of anything on the list.
struct WLAir: Codable, Equatable {
    var title: String = ""
    var at: Double = 0       // unix seconds
    var ep: Int = 0
}

/// The accent the app is wearing right now. The widget sits on the same Home
/// Screen as the app icon; it should wear the same theme the app does rather
/// than a colour chosen once at build time.
struct WLTheme: Codable, Equatable {
    var a: String = "#6c8cff"
    var bg: String = "#0b0b0d"
    var bg2: String = "#121215"
    var t1: String = "#edeef0"
    var t2: String = "#b4b6bd"
}

struct WLSnapshot: Codable, Equatable {
    var at: Double = 0
    var up: [WLUpNext] = []
    var air: WLAir? = nil
    var watching: Int = 0
    var theme: WLTheme = WLTheme()

    /// Never throws and never returns nil: a widget with no data to show still
    /// has to draw something, and the empty snapshot is that something.
    static func load() -> WLSnapshot {
        guard let u = WidgetShare.snapshotURL,
              let d = try? Data(contentsOf: u),
              let s = try? JSONDecoder().decode(WLSnapshot.self, from: d) else { return WLSnapshot() }
        return s
    }

    @discardableResult
    func save() -> Bool {
        guard let u = WidgetShare.snapshotURL,
              let d = try? JSONEncoder().encode(self) else { return false }
        do { try d.write(to: u, options: .atomic); return true } catch { return false }
    }

    var isEmpty: Bool { up.isEmpty && air == nil }
}
