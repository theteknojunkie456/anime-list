import WidgetKit
import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// The Home Screen widget.
//
// It computes nothing. Everything on it was decided by the web app and written
// into the App Group container by the shell (see WidgetShared / WidgetBridge),
// because the widget runs as its own process at moments iOS chooses and has no
// way to reach the list otherwise.
//
// It also wears the theme the app is wearing. The accent arrives in the
// snapshot, so switching theme in the app moves the widget too — the alternative
// is a widget that sits next to the app icon in a colour the app abandoned
// months ago.
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
        // ticks on its own (Text(style: .relative) redraws without an entry).
        // The hourly refresh is the safety net for a phone whose owner has not
        // opened the app in days, not the mechanism.
        let entry = WLEntry(date: Date(), snap: WLSnapshot.load())
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
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
        .description("What you are part-way through, and when the next episode lands.")
        .supportedFamilies(Self.families)
    }
    static var families: [WidgetFamily] {
        if #available(iOS 16.0, *) { return [.systemSmall, .systemMedium, .accessoryRectangular] }
        return [.systemSmall, .systemMedium]
    }
}

// ─── the view ────────────────────────────────────────────────────────────────

struct UpNextView: View {
    @Environment(\.widgetFamily) var family
    let entry: WLEntry
    var snap: WLSnapshot { entry.snap }

    var body: some View {
        // The lock screen renders its widgets as a vibrant stencil over the
        // wallpaper. Giving that one the app's background paints a dark block
        // onto somebody's lock screen; it gets a clear container instead.
        content.wlContainer(isAccessory ? Color.clear : snap.theme.color(\.bg))
    }

    private var isAccessory: Bool {
        if #available(iOS 16.0, *) {
            return family == .accessoryRectangular || family == .accessoryInline
                || family == .accessoryCircular
        }
        return false
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .systemSmall:  SmallCard(snap: snap)
        case .systemMedium: MediumCard(snap: snap)
        default:            InlineCard(snap: snap)
        }
    }
}

// One title, cover-led. The poster is the point: it is the thing you recognise
// from across the Home Screen before you have read a word.
private struct SmallCard: View {
    let snap: WLSnapshot
    var body: some View {
        if let top = snap.up.first {
            ZStack(alignment: .bottomLeading) {
                Cover(id: top.id, theme: snap.theme)
                LinearGradient(colors: [.black.opacity(0), .black.opacity(0.55), .black.opacity(0.88)],
                               startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 3) {
                    Text("UP NEXT")
                        .font(.system(size: 9, weight: .heavy)).tracking(0.8)
                        .foregroundColor(snap.theme.color(\.a))
                    Text(top.title)
                        .font(.system(size: 14, weight: .bold)).lineLimit(2)
                        .foregroundColor(.white)
                    Text(top.epLine)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.white.opacity(0.75))
                    Progress(value: top.progress, tint: snap.theme.color(\.a))
                }
                .padding(12)
            }
            .widgetURL(top.link)
        } else {
            Empty(snap: snap)
        }
    }
}

// Three titles at a glance, each its own tap target, with the next air time on
// the header line where it is read once and not looked for again.
private struct MediumCard: View {
    let snap: WLSnapshot
    var body: some View {
        if snap.up.isEmpty {
            Empty(snap: snap)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Up next")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(snap.theme.color(\.t1))
                    Spacer(minLength: 6)
                    if let air = snap.air {
                        Text(air.line)
                            .font(.system(size: 11, weight: .medium)).lineLimit(1)
                            .foregroundColor(snap.theme.color(\.t2))
                    } else if snap.watching > 0 {
                        Text("\(snap.watching) on the go")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(snap.theme.color(\.t2))
                    }
                }
                HStack(alignment: .top, spacing: 10) {
                    ForEach(Array(snap.up.prefix(3))) { item in
                        Link(destination: item.link) { Tile(item: item, theme: snap.theme) }
                    }
                    // Two titles should not stretch into three-wide tiles.
                    if snap.up.count < 3 {
                        ForEach(0..<(3 - snap.up.count), id: \.self) { _ in
                            Color.clear.frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            .padding(14)
        }
    }
}

private struct Tile: View {
    let item: WLUpNext
    let theme: WLTheme
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Cover(id: item.id, theme: theme)
                .aspectRatio(2.0/3.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(item.title)
                .font(.system(size: 10, weight: .semibold)).lineLimit(1)
                .foregroundColor(theme.color(\.t1))
            Text(item.epShort)
                .font(.system(size: 9, weight: .medium)).lineLimit(1)
                .foregroundColor(theme.color(\.t2))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Lock screen / StandBy: one line of type, no colour of its own.
private struct InlineCard: View {
    let snap: WLSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Up next").font(.system(size: 11, weight: .semibold)).wlAccentable()
            if let top = snap.up.first {
                Text(top.title).font(.system(size: 14, weight: .bold)).lineLimit(1)
                Text(snap.air.map { "\(top.epShort) · \($0.line)" } ?? top.epLine)
                    .font(.system(size: 11)).lineLimit(1)
            } else {
                Text("Nothing on the go").font(.system(size: 14, weight: .bold)).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(snap.up.first?.link ?? WLUpNext.home)
    }
}

private struct Empty: View {
    let snap: WLSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Nothing on the go")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(snap.theme.color(\.t1))
            Text(snap.at == 0 ? "Open WatchList once and this fills in."
                              : "Start something and it shows up here.")
                .font(.system(size: 11))
                .foregroundColor(snap.theme.color(\.t2))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(14)
        .widgetURL(WLUpNext.home)
    }
}

/// The cached cover, or a tinted placeholder that still looks deliberate.
private struct Cover: View {
    let id: String
    let theme: WLTheme
    var body: some View {
        GeometryReader { geo in
            if let img = WLArt.image(id) {
                Image(uiImage: img).resizable().scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
            } else {
                LinearGradient(colors: [theme.color(\.bg2), theme.color(\.bg)],
                               startPoint: .top, endPoint: .bottom)
                    .overlay(theme.color(\.a).opacity(0.14))
            }
        }
    }
}

private struct Progress: View {
    let value: Double
    let tint: Color
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.22))
                Capsule().fill(tint).frame(width: max(3, geo.size.width * value))
            }
        }
        .frame(height: 3)
        .opacity(value > 0 ? 1 : 0)
    }
}

// ─── small plumbing ──────────────────────────────────────────────────────────

enum WLArt {
    static func image(_ id: String) -> UIImage? {
        guard let u = WidgetShare.artURL(id), let d = try? Data(contentsOf: u) else { return nil }
        return UIImage(data: d)
    }
}

extension WLUpNext {
    static let home = URL(string: "watchlist://home")!
    var link: URL { URL(string: "watchlist://title/\(id)") ?? Self.home }
    var progress: Double {
        guard total > 0, ep > 0 else { return 0 }
        return min(1, Double(ep - 1) / Double(total))
    }
    var epLine: String { total > 0 ? "Ep \(ep) of \(total)" : "Ep \(ep)" }
    var epShort: String { "Ep \(ep)" }
}

extension WLAir {
    /// "Ep 6 in 4h" — relative, because "1:30 AM Friday" needs arithmetic from
    /// the reader and the whole job of this line is to save them that.
    var line: String {
        let when = Date(timeIntervalSince1970: at)
        let ep = self.ep > 0 ? "Ep \(self.ep)" : "Next ep"
        if when <= Date() { return "\(ep) is out" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return "\(ep) \(f.localizedString(for: when, relativeTo: Date()))"
    }
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
    /// iOS 17 stopped letting a widget paint its own background directly; it has
    /// to be declared, or the widget draws on the system material and every
    /// colour in the snapshot is thrown away.
    @ViewBuilder func wlContainer(_ bg: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { bg }
        } else {
            self.background(bg)
        }
    }
    @ViewBuilder func wlAccentable() -> some View {
        if #available(iOS 16.0, *) { self.widgetAccentable() } else { self }
    }
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
