import SwiftUI
import ReplayKit

struct ContentView: View {
    // Start with safe, cheap defaults — do NOT touch AppGroup (the shared
    // pasteboard) here, because reading it during view init runs at launch on the
    // main thread and can stall the very first frame (black screen). We load it in
    // .task instead, once the UI is already on screen.
    @State private var name = ""
    @State private var code = ""
    @State private var joined = false

    private let codeChars = Array("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
    private func mint() -> String { String((0..<6).map { _ in codeChars.randomElement()! }) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                    Text("WatchList Party").font(.largeTitle.bold())
                    Text("Host a watch party from your iPhone. Friends watch in WatchList on any device — in perfect sync.")
                        .font(.footnote).foregroundStyle(.secondary)

                    TextField("Your name", text: $name)
                        .textFieldStyle(.roundedBorder).autocorrectionDisabled()

                    if joined {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("PARTY CODE — share it").font(.caption2).foregroundStyle(.secondary)
                            Text(code).font(.system(size: 28, weight: .black, design: .monospaced))
                                .kerning(4).foregroundStyle(.pink)
                        }.padding().frame(maxWidth: .infinity, alignment: .leading)
                         .background(.pink.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 14))

                        // iOS's own "Start Broadcast" button → picks our extension
                        BroadcastButton().frame(height: 56)

                        Text("Tap ‘Start Broadcast’, pick **WatchListBroadcast**, then open the anime. Your play/pause/seek is what everyone sees.")
                            .font(.caption).foregroundStyle(.secondary)

                        Button("Leave party") { AppGroup.partyOn(false); joined = false }
                            .foregroundStyle(.secondary)
                    } else {
                        Button {
                            guard !name.isEmpty else { return }
                            code = mint(); persist(); joined = true
                        } label: { Text("Start a party").bold().frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent).tint(.pink)

                        HStack {
                            TextField("Join a code", text: $code)
                                .textFieldStyle(.roundedBorder).textInputAutocapitalization(.characters)
                            Button("Join") {
                                code = code.uppercased()
                                guard !name.isEmpty, code.count >= 5 else { return }
                                persist(); joined = true
                            }
                        }
                    }
            }
            .padding()
        }
        .task { loadShared() }
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
