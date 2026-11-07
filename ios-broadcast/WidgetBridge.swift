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

        // The raw art values, kept aside. Artwork somebody picked themselves is
        // a data: URL holding the whole image — fine to fetch from, ruinous to
        // store: it would sit in the snapshot that is read on every single
        // widget draw, and a four-title snapshot could be megabytes of base64.
        // What gets stored is a fingerprint, which is all the change detection
        // ever needed from it.
        var art: [String: (String, String)] = [:]      // id -> (cover, banner)
        if let rows = body["up"] as? [[String: Any]] {
            s.up = rows.prefix(4).map { r in
                let id = String(describing: r["id"] ?? "")
                let cover = r["img"] as? String ?? ""
                let wide = r["banner"] as? String ?? ""
                art[id] = (cover, wide)
                return WLUpNext(id: id,
                                title: r["title"] as? String ?? "",
                                ep: intOf(r["ep"]),
                                total: intOf(r["total"]),
                                img: tag(cover),
                                banner: tag(wide))
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
        var wasCover: [String: String] = [:], wasWide: [String: String] = [:]
        for r in old.up { wasCover[r.id] = r.img; wasWide[r.id] = r.banner }
        for r in s.up {
            if wasCover[r.id] != nil, wasCover[r.id] != r.img,
               let u = WidgetShare.artURL(r.id) { try? FileManager.default.removeItem(at: u) }
            if wasWide[r.id] != nil, wasWide[r.id] != r.banner,
               let u = WidgetShare.artURL(r.id, wide: true) { try? FileManager.default.removeItem(at: u) }
        }
        prune(keeping: s.up)
        fetchArt(for: s.up, from: art) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Everything you have ever been part-way through would otherwise leave a
    /// cover behind in a container that is backed up and never swept. Only the
    /// handful the widget can actually draw is worth keeping.
    private static func prune(keeping rows: [WLUpNext]) {
        guard let dir = WidgetShare.artDir else { return }
        var keep = Set(rows.compactMap { WidgetShare.artURL($0.id)?.lastPathComponent })
        keep.formUnion(rows.compactMap { WidgetShare.artURL($0.id, wide: true)?.lastPathComponent })
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
    private static func fetchArt(for rows: [WLUpNext],
                                from art: [String: (String, String)],
                                done: @escaping () -> Void) {
        let group = DispatchGroup()
        var jobs: [(String, URL, CGFloat)] = []    // src, dest, longest edge
        for r in rows {
            let (cover, wide) = art[r.id] ?? ("", "")
            if let d = WidgetShare.artURL(r.id), !cover.isEmpty { jobs.append((cover, d, 700)) }
            if let d = WidgetShare.artURL(r.id, wide: true), !wide.isEmpty { jobs.append((wide, d, 1200)) }
        }
        for (src, dest, maxW) in jobs {
            guard let url = URL(string: src) else { continue }
            // Art does not change under you; one download per file is enough.
            if FileManager.default.fileExists(atPath: dest.path) { continue }
            // URLSession does not speak data:, and artwork somebody picked from
            // their own photos IS a data: URL — so every self-chosen cover would
            // have failed with "unsupported URL" and shown no art at all.
            // Data(contentsOf:) reads both schemes; only the remote one needs to
            // be off the main thread.
            if src.hasPrefix("data:") {
                if let d = try? Data(contentsOf: url), let small = shrink(d, maxW: maxW) {
                    try? small.write(to: dest, options: .atomic)
                }
                continue
            }
            group.enter()
            URLSession.shared.dataTask(with: url) { data, _, _ in
                defer { group.leave() }
                guard let data, let small = shrink(data, maxW: maxW) else { return }
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

    /// Scaled to roughly what the widget draws, with headroom for a 3x screen
    /// and for aspect-fill cropping — the artwork IS the widget now, so a soft
    /// cover is the whole thing looking soft. Not the full 1500px original
    /// either: that would put megabytes in a container that is backed up and
    /// synced, for detail no 155pt tile can show.
    private static func shrink(_ data: Data, maxW: CGFloat) -> Data? {
        #if canImport(UIKit)
        guard let img = UIImage(data: data) else { return nil }
        guard img.size.width > maxW else { return img.jpegData(compressionQuality: 0.9) }
        let scale = maxW / img.size.width
        let size = CGSize(width: maxW, height: (img.size.height * scale).rounded())
        let r = UIGraphicsImageRenderer(size: size)
        let out = r.image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        return out.jpegData(compressionQuality: 0.9)
        #else
        return data
        #endif
    }

    // ── small helpers ────────────────────────────────────────────────────────
    /// What gets STORED in place of an art value. A remote URL is already short
    /// and is kept as is; a data: URL becomes a fingerprint of itself, so the
    /// snapshot stays small and "has this cover changed" still has an honest
    /// answer. djb2 rather than hashValue: Swift seeds hashValue per process, so
    /// the same image would fingerprint differently after every relaunch and
    /// every cover would look re-picked.
    private static func tag(_ v: String) -> String {
        guard v.hasPrefix("data:") else { return v }
        var h: UInt64 = 5381
        for b in v.utf8 { h = (h &* 33) &+ UInt64(b) }
        return "data:#\(h)"
    }

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
