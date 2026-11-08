import WidgetKit
import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// The Home Screen widget.
//
// THE ARTWORK IS THE WIDGET. Not a card with a poster in it — the poster, edge
// to edge, with the one piece of information that is not already in the picture
// laid over the bottom of it: how far through you are. The first version had a
// caps label, a title, an episode line, a scrim and a progress pill stacked on
// top of the art, which is a dashboard tile wearing a poster and looks like
// every generated widget ever shipped. A Home Screen is already a grid of
// artwork; this belongs to that grid rather than sitting on top of it.
//
// It computes nothing. Everything here was decided by the web app and written
// into the App Group container by the shell (see WidgetShared / WidgetBridge),
// because the widget runs as its own process at moments iOS chooses and has no
// way to reach the list otherwise.
// ─────────────────────────────────────────────────────────────────────────────

struct WLEntry: TimelineEntry {
    let date: Date
    let snap: WLSnapshot
}

struct WLProvider: TimelineProvider {
    func placeholder(in context: Context) -> WLEntry {
        WLEntry(date: Date(), snap: WLSnapshot.sample)
    }
    func getSnapshot(in context: Context, completion: @escaping (WLEntry) -> Void) {
        let s = WLSnapshot.load()
        completion(WLEntry(date: Date(), snap: (context.isPreview && s.isEmpty) ? .sample : s))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WLEntry>) -> Void) {
        // One entry. The app pushes a reload whenever the list actually changes,
        // which is the only thing that alters what is drawn here — the countdown
        // on the lock screen ticks on its own (Text(style: .relative) redraws
        // without an entry). The hourly refresh is the safety net for a phone
        // whose owner has not opened the app in days, not the mechanism.
        let snap = WLSnapshot.load()
        let now = Date()
        var entries = [WLEntry(date: now, snap: snap)]
        // `Text(style: .relative)` prints the SIZE of the gap and never its
        // sign, so the minute an episode is out that same line reads "Ep 12 in
        // 5 min" about something that aired five minutes ago, and keeps saying
        // it until the next timeline an hour later. A second entry at the airing
        // moment rebuilds the view as "is out" exactly then. Extra entries in
        // one timeline are free; only asking for a new timeline costs a reload.
        if let air = snap.air {
            let out = air.when.addingTimeInterval(1)
            if out > now { entries.append(WLEntry(date: out, snap: snap)) }
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(3600))))
    }
}

@main
struct WatchListWidgetBundle: WidgetBundle {
    var body: some Widget { UpNextWidget() }
}

struct UpNextWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "wl.upnext", provider: WLProvider()) { entry in
            UpNextView(entry: entry)
        }
        .configurationDisplayName("Up next")
        .description("The show you are part-way through, and how far through you are.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
        // Without this the artwork fills the tile but everything drawn ON it is
        // inset by the system's 16pt content margin — so the hairline meant to
        // sit along the bottom edge floats above it with gaps at both sides.
        .contentMarginsDisabled()
    }
}

// ─── the view ────────────────────────────────────────────────────────────────

struct UpNextView: View {
    @Environment(\.widgetFamily) var family
    let entry: WLEntry
    var snap: WLSnapshot { entry.snap }
    var top: WLUpNext? { snap.up.first }

    var body: some View {
        if isAccessory {
            InlineCard(snap: snap).wlAccessoryContainer()
        } else if let top {
            ArtCard(item: top, theme: snap.theme, wide: family == .systemMedium)
        } else {
            Empty(snap: snap)
        }
    }

    private var isAccessory: Bool {
        family == .accessoryRectangular || family == .accessoryInline || family == .accessoryCircular
    }
}

/// Artwork, edge to edge, and a hairline of progress across the bottom.
///
/// The bar carries its own dark track rather than sitting on a gradient over
/// the picture: a track is three and a half points of the artwork given up, a
/// scrim is a third of it dimmed. Over a bright cover the track is what makes
/// the accent readable, and it is the smallest thing that does.
private struct ArtCard: View {
    let item: WLUpNext
    let theme: WLTheme
    let wide: Bool

    var body: some View {
        ZStack(alignment: .bottom) {
            if item.progress > 0 { ProgressStrip(value: item.progress, tint: theme.color(\.a)) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .wlArtBackground { Art(item: item, theme: theme, wide: wide) }
        .widgetURL(item.link)
    }
}

private struct Art: View {
    let item: WLUpNext
    let theme: WLTheme
    let wide: Bool

    var body: some View {
        // A portrait cover cropped to a medium widget is a band across
        // somebody's chin, so the wide size prefers the art that was drawn
        // wide and only falls back to the cover when a title has none.
        if let img = WLArt.image(item.id, wide: wide) ?? WLArt.image(item.id, wide: false) {
            Image(uiImage: img).resizable().scaledToFill()
        } else {
            NoArt(item: item, theme: theme)
        }
    }
}

/// A title with no artwork cannot be a picture, so it stops pretending and
/// becomes type on the app's own ground — quiet, not a coloured rectangle.
private struct NoArt: View {
    let item: WLUpNext
    let theme: WLTheme
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            theme.color(\.bg)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.system(size: 15, weight: .bold)).lineLimit(3)
                    .foregroundColor(theme.color(\.t1))
                Text(item.epLine)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(theme.color(\.t2))
            }
            .padding(14)
            .padding(.bottom, 4)
        }
    }
}

private struct ProgressStrip: View {
    let value: Double
    let tint: Color
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Color.black.opacity(0.5)
                tint.frame(width: max(2, geo.size.width * value))
            }
        }
        .frame(height: 3.5)
    }
}

// Lock screen / StandBy: one line of type, no colour of its own. There is no
// artwork here to speak of — the system draws these as a vibrant stencil — so
// this size says in words what the others say in pictures.
private struct InlineCard: View {
    let snap: WLSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Up next").font(.system(size: 11, weight: .semibold)).wlAccentable()
            if let top = snap.up.first {
                Text(top.title).font(.system(size: 14, weight: .bold)).lineLimit(1)
                // Only when the countdown belongs to the title above it. Stacked
                // otherwise, the two lines are about two different shows and read
                // as one sentence about the first.
                if let air = snap.air, air.title == top.title {
                    AirLine(air: air, withTitle: false).font(.system(size: 11)).lineLimit(1)
                } else {
                    Text(top.epLine).font(.system(size: 11)).lineLimit(1)
                }
            } else {
                Text("Nothing on the go").font(.system(size: 14, weight: .bold)).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Margins are off for the whole widget so the artwork can reach the
        // edges; the lock-screen size has no artwork and wants them back.
        .padding(.horizontal, 2)
        .widgetURL(snap.up.first?.link ?? WLUpNext.home)
    }
}

private struct Empty: View {
    let snap: WLSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Nothing on the go")
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(snap.theme.color(\.t1))
            Text(snap.at == 0 ? "Open WatchList once and this fills in."
                              : "Start something and it shows up here.")
                .font(.system(size: 11))
                .foregroundColor(snap.theme.color(\.t2))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .padding(14)
        .wlArtBackground { snap.theme.color(\.bg) }
        .widgetURL(WLUpNext.home)
    }
}

/// The countdown has to TICK. Built as a string it freezes until the next
/// timeline entry — an hour away — so "in 4 hr" would still say four hours at a
/// quarter to, which is worse than saying nothing. `Text(_:style: .relative)` is
/// redrawn by the system without spending one of the day's reloads, which is the
/// only way to say "soon" honestly and cheaply at once.
///
/// It names the show, too: the episode being counted down is often not the title
/// at the top of the widget, and an unattributed "Ep 12 in 3 hr" is a riddle.
private struct AirLine: View {
    let air: WLAir
    let withTitle: Bool
    var body: some View {
        let who = (withTitle && !air.title.isEmpty) ? air.title + " " : ""
        if air.isOut {
            Text("\(who)\(air.epName) is out")
        } else {
            Text("\(who)\(air.epName) in ") + Text(air.when, style: .relative)
        }
    }
}

// ─── small plumbing ──────────────────────────────────────────────────────────

enum WLArt {
    static func image(_ id: String, wide: Bool) -> UIImage? {
        guard let u = WidgetShare.artURL(id, wide: wide), let d = try? Data(contentsOf: u) else { return nil }
        return UIImage(data: d)
    }
}

extension WLUpNext {
    static let home = URL(string: "watchlist://home")!
    var link: URL { URL(string: "watchlist://title/\(id)") ?? Self.home }
    /// Episodes finished over episodes there are. `ep` is the one to WATCH, so
    /// the one before it is the last one done.
    var progress: Double {
        guard total > 0, ep > 0 else { return 0 }
        return min(1, Double(ep - 1) / Double(total))
    }
    var epLine: String { total > 0 ? "Ep \(ep) of \(total)" : "Ep \(ep)" }
    var epShort: String { "Ep \(ep)" }
}

extension WLAir {
    var when: Date { Date(timeIntervalSince1970: at) }
    var epName: String { ep > 0 ? "Ep \(ep)" : "Next ep" }
    var isOut: Bool { when <= Date() }
}

extension WLTheme {
    func color(_ k: KeyPath<WLTheme, String>) -> Color { Color(hex: self[keyPath: k]) }
}

extension Color {
    init(hex: String) {
        var s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        let v = UInt64(s, radix: 16) ?? 0
        self.init(.sRGB,
                  red: Double((v >> 16) & 0xff) / 255,
                  green: Double((v >> 8) & 0xff) / 255,
                  blue: Double(v & 0xff) / 255,
                  opacity: 1)
    }
}

extension View {
    /// A widget may not paint its own background directly; it has to be
    /// declared, or the widget draws on the system material instead of the
    /// artwork filling the tile.
    func wlArtBackground<B: View>(@ViewBuilder _ bg: @escaping () -> B) -> some View {
        containerBackground(for: .widget) { bg() }
    }
    /// The lock screen renders its widgets as a vibrant stencil over the
    /// wallpaper. Giving that one a background paints a dark block onto
    /// somebody's lock screen; it gets a clear container instead.
    func wlAccessoryContainer() -> some View {
        containerBackground(for: .widget) { Color.clear }
    }
    func wlAccentable() -> some View { widgetAccentable() }
}

extension WLSnapshot {
    /// What the widget gallery shows before anyone has installed it. Real-looking
    /// but obviously not yours.
    static var sample: WLSnapshot {
        var s = WLSnapshot()
        s.watching = 4
        s.up = [WLUpNext(id: "s1", title: "Frieren", ep: 12, total: 28),
                WLUpNext(id: "s2", title: "Vinland Saga", ep: 4, total: 24),
                WLUpNext(id: "s3", title: "Dandadan", ep: 7, total: 12)]
        s.air = WLAir(title: "Frieren", at: Date().addingTimeInterval(5400).timeIntervalSince1970, ep: 13)
        return s
    }
}
