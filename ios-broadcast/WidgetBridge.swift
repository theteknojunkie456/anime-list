import Foundation
import WidgetKit
#if canImport(UIKit)
import UIKit
#endif

// The app half of the Home Screen widget: take the snapshot the web app posts
// over the `wl` bridge, put it where the widget can read it, and ask iOS to
// redraw.
//
// Two things this deliberately does NOT do:
//  • It does not reload the widget on every message. The web app posts a
//    snapshot whenever the list changes, which during a binge is every few
//    seconds; iOS budgets widget reloads (tens per day, not hundreds) and spends
//    them silently, so a chatty app ends up with a widget that stops updating in
//    the afternoon. Unchanged snapshot → no reload.
//  • It does not hand the widget a URL to fetch. A widget's network access is
//    brief and unreliable, and cover art over cellular at 7am is not what the
//    data plan is for. The shell downloads the art once, scaled down, into the
//    shared container; the widget only ever reads a local file.
enum WidgetBridge {

    /// Called from the web bridge with the message body.
    static func accept(_ body: [String: Any]) {
        var s = WLSnapshot()
        s.at = Date().timeIntervalSince1970
        s.watching = body["watching"] as? Int ?? 0

        if let rows = body["up"] as? [[String: Any]] {
            s.up = rows.prefix(4).map { r in
                WLUpNext(id: String(describing: r["id"] ?? ""),
                         title: r["title"] as? String ?? "",
                         ep: intOf(r["ep"]),
                         total: intOf(r["total"]),
                         img: r["img"] as? String ?? "")
            }.filter { !$0.title.isEmpty }
        }
        if let a = body["air"] as? [String: Any], let t = a["title"] as? String, !t.isEmpty {
            let at = (a["at"] as? Double) ?? Double(intOf(a["at"]))
            if at > 0 { s.air = WLAir(title: t, at: at, ep: intOf(a["ep"])) }
        }
        if let th = body["theme"] as? [String: Any] {
            s.theme = WLTheme(a: hex(th["a"]) ?? s.theme.a,
                              bg: hex(th["bg"]) ?? s.theme.bg,
                              bg2: hex(th["bg2"]) ?? s.theme.bg2,
                              t1: hex(th["t1"]) ?? s.theme.t1,
                              t2: hex(th["t2"]) ?? s.theme.t2)
        }

        // `at` is a timestamp, so it differs on every single message. Comparing
        // with it included would make every snapshot "changed" and defeat the
        // whole point of the check.
        let old = WLSnapshot.load()
        var a = old, b = s
        a.at = 0; b.at = 0
        let changed = (a != b)

        guard changed else { return }
        guard s.save() else {
            NSLog("WatchList: widget snapshot could not be written — is the App Group entitlement on?")
            return
        }
        // The cache is keyed by title id, so a re-picked cover would otherwise
        // keep drawing the old artwork for ever: the file is already there, and
        // "already there" is the only question fetchArt asks. Drop the file when
        // the URL behind it changed.
        var was: [String: String] = [:]
        for r in old.up { was[r.id] = r.img }
        for r in s.up where was[r.id] != nil && was[r.id] != r.img {
            if let u = WidgetShare.artURL(r.id) { try? FileManager.default.removeItem(at: u) }
        }
        prune(keeping: s.up)
        fetchArt(for: s.up) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Everything you have ever been part-way through would otherwise leave a
    /// cover behind in a container that is backed up and never swept. Only the
    /// handful the widget can actually draw is worth keeping.
    private static func prune(keeping rows: [WLUpNext]) {
        guard let dir = WidgetShare.artDir else { return }
        let keep = Set(rows.compactMap { WidgetShare.artURL($0.id)?.lastPathComponent })
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
        for n in names where !keep.contains(n) {
            try? fm.removeItem(at: dir.appendingPathComponent(n))
        }
    }

    /// Clearing the list, signing out, or locking the app should not leave
    /// yesterday's titles sitting on the Home Screen where anyone can read them.
    static func clear() {
        WLSnapshot().save()
        if let d = WidgetShare.artDir { try? FileManager.default.removeItem(at: d) }
        WidgetCenter.shared.reloadAllTimelines()
    }

    // ── art ──────────────────────────────────────────────────────────────────
    private static func fetchArt(for rows: [WLUpNext], done: @escaping () -> Void) {
        let group = DispatchGroup()
        for r in rows {
            guard let dest = WidgetShare.artURL(r.id),
                  let url = URL(string: r.img), !r.img.isEmpty else { continue }
            // Covers do not change under you; one download per title is enough.
            if FileManager.default.fileExists(atPath: dest.path) { continue }
            group.enter()
            URLSession.shared.dataTask(with: url) { data, _, _ in
                defer { group.leave() }
                guard let data, let small = shrink(data) else { return }
                try? small.write(to: dest, options: .atomic)
            }.resume()
        }
        // The widget must be redrawn whether or not the art arrived — a title
        // with no cover is a widget with a coloured tile, not a blank one. And
        // if a download hangs, the redraw does not wait for it. Whichever
        // happens first wins: a widget reload is a budgeted resource, so the
        // slow path must not spend a second one.
        var fired = false
        let once = { if !fired { fired = true; done() } }
        group.notify(queue: .main) { once() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { once() }
    }

    /// A 1500px AniList cover is ~400 KB and the widget draws it at ~150pt.
    /// Keeping the full size would put megabytes in a container that is backed
    /// up and synced for no visible gain.
    private static func shrink(_ data: Data) -> Data? {
        #if canImport(UIKit)
        guard let img = UIImage(data: data) else { return nil }
        let maxW: CGFloat = 400
        guard img.size.width > maxW else { return img.jpegData(compressionQuality: 0.85) }
        let scale = maxW / img.size.width
        let size = CGSize(width: maxW, height: (img.size.height * scale).rounded())
        let r = UIGraphicsImageRenderer(size: size)
        let out = r.image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        return out.jpegData(compressionQuality: 0.85)
        #else
        return data
        #endif
    }

    // ── small helpers ────────────────────────────────────────────────────────
    private static func intOf(_ v: Any?) -> Int {
        if let i = v as? Int { return i }
        if let d = v as? Double { return Int(d) }
        if let s = v as? String { return Int(s) ?? 0 }
        return 0
    }
    /// Only accepts what it can actually draw. getComputedStyle can hand back
    /// `rgb(…)`, a gradient, or nothing at all, and a widget is not the place to
    /// discover that — an unparseable colour falls back to the default theme.
    private static func hex(_ v: Any?) -> String? {
        guard var s = v as? String else { return nil }
        s = s.trimmingCharacters(in: .whitespaces)
        guard s.hasPrefix("#"), s.count == 7 || s.count == 4 else { return nil }
        let body = s.dropFirst()
        guard body.allSatisfy({ $0.isHexDigit }) else { return nil }
        return s
    }
}
