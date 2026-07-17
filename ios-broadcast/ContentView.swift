import SwiftUI
import ReplayKit

// WatchList brand tokens (from the web app's :root palette) so the native host
// screen matches the app rather than looking like stock iOS.
extension Color {
    init(hex: UInt) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255,
                  opacity: 1)
    }
}
enum Brand {
    static let bg      = Color(hex: 0x0a0a0c)
    static let surface = Color(hex: 0x18181c)
    static let border  = Color.white.opacity(0.09)
    static let t1      = Color(hex: 0xf0ecea)
    static let t2      = Color(hex: 0xbcb7c3)
    static let t3      = Color(hex: 0x918e99)
    static let accent  = Color(hex: 0xda374f)
    static let accent2 = Color(hex: 0xff6070)
}

struct ContentView: View {
    // Start with safe defaults — read the shared pasteboard in .task (after the
    // first draw), never during view init (that stalls launch → black screen).
    @State private var name = ""
    @State private var code = ""
    @State private var joined = false

    private let codeChars = Array("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
    private func mint() -> String { String((0..<6).map { _ in codeChars.randomElement()! }) }

    var body: some View {
        ZStack {
            Brand.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("WatchList Party")
                            .font(.system(size: 38, weight: .heavy))
                            .foregroundStyle(Brand.t1)
                        Text("Host a watch party from your iPhone. Friends watch in WatchList on any device — in perfect sync.")
                            .font(.subheadline)
                            .foregroundStyle(Brand.t2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 8)

                    field("Your name", text: $name)

                    if joined {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("PARTY CODE — SHARE IT")
                                .font(.caption2.weight(.heavy))
                                .foregroundStyle(Brand.t3)
                            Text(code)
                                .font(.system(size: 30, weight: .heavy, design: .monospaced))
                                .foregroundStyle(Brand.accent2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Brand.accent.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Brand.accent.opacity(0.28), lineWidth: 1))

                        VStack(spacing: 10) {
                            Text("START BROADCAST")
                                .font(.caption.weight(.heavy))
                                .foregroundStyle(.white)
                            BroadcastButton().frame(height: 40)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Brand.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 14))

                        Text("Tap Start Broadcast, pick **WatchListBroadcast**, then open your anime. Your play / pause / seek is what everyone sees.")
                            .font(.footnote)
                            .foregroundStyle(Brand.t3)
                            .fixedSize(horizontal: false, vertical: true)

                        Button { AppGroup.partyOn(false); joined = false } label: {
                            Text("Leave party").font(.subheadline.weight(.semibold)).foregroundStyle(Brand.t3)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)
                    } else {
                        Button {
                            guard !name.isEmpty else { return }
                            code = mint(); persist(); joined = true
                        } label: {
                            Text("Start a party").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(PrimaryButton())

                        HStack(spacing: 10) {
                            field("Join a code", text: $code, caps: true)
                            Button("Join") {
                                code = code.uppercased()
                                guard !name.isEmpty, code.count >= 5 else { return }
                                persist(); joined = true
                            }
                            .font(.body.weight(.bold))
                            .foregroundStyle(Brand.accent2)
                        }

                        Text("Your friends open the code in WatchList — no app needed on their end.")
                            .font(.footnote).foregroundStyle(Brand.t3)
                    }
                }
                .padding(20)
            }
        }
        .preferredColorScheme(.dark)
        .task { loadShared() }
    }

    private func field(_ placeholder: String, text: Binding<String>, caps: Bool = false) -> some View {
        TextField("", text: text, prompt: Text(placeholder).foregroundColor(Brand.t3))
            .foregroundStyle(Brand.t1)
            .textFieldStyle(.plain)
            .autocorrectionDisabled()
            .textInputAutocapitalization(caps ? .characters : .words)
            .padding(.horizontal, 14).padding(.vertical, 13)
            .background(Brand.surface)
            .clipShape(RoundedRectangle(cornerRadius: 13))
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(Brand.border, lineWidth: 1))
    }

    private func loadShared() {
        let n = AppGroup.partyName
        name = (n == "Guest") ? "" : n
        code = AppGroup.partyCode
        joined = !AppGroup.partyCode.isEmpty
    }

    private func persist() {
        AppGroup.partyName = name.isEmpty ? "Guest" : name
        AppGroup.partyCode = code.uppercased()
        AppGroup.partyOn(true)
    }
}

struct PrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.bold))
            .foregroundStyle(.white)
            .padding(.vertical, 15)
            .background(Brand.accent.opacity(configuration.isPressed ? 0.82 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// Wraps iOS's system broadcast picker so the extension can start.
struct BroadcastButton: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let v = RPSystemBroadcastPickerView(frame: .zero)
        v.showsMicrophoneButton = false
        // Preselect our extension so the picker opens straight to it.
        v.preferredExtension = "com.watchlist.party.BroadcastExt"
        return v
    }
    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}
