import Foundation

// WebSocket client for the WatchList party room. Same protocol the web app uses:
//   connect:  wss://…/party/<CODE>?uid=…&name=…&create=1
//   in:   {t:"state", room:{…, host, members:[{uid,name}], …}}
//         {t:"signal", from, kind:"answer"|"offer", data:{…}}
//   out:  {t:"share", on:true}    {t:"signal", to, kind, data}
protocol PartySignalingDelegate: AnyObject {
    func party(members: [(uid: String, name: String)], host: String)   // latest room state
    func party(signalFrom uid: String, kind: String, data: [String: Any])
}

final class PartySignaling {
    weak var delegate: PartySignalingDelegate?
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var code = "", name = "Guest", uid = ""
    private var wantOpen = false

    func connect(code: String, name: String, uid: String) {
        self.code = code; self.name = name; self.uid = uid; self.wantOpen = true
        openSocket(create: true)
    }
    func disconnect() { wantOpen = false; task?.cancel(with: .goingAway, reason: nil); task = nil }

    private func openSocket(create: Bool) {
        guard wantOpen, var comps = URLComponents(string: AppGroup.wsBase + code) else { return }
        comps.queryItems = [
            .init(name: "uid", value: uid),
            .init(name: "name", value: name),
            .init(name: "create", value: create ? "1" : "0"),
        ]
        guard let url = comps.url else { return }
        let t = session.webSocketTask(with: url)
        self.task = t
        t.resume()
        receive()
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                if self.wantOpen { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.openSocket(create: false) } }
            case .success(let msg):
                if case .string(let s) = msg { self.handle(s) }
                self.receive()
            }
        }
    }

    private func handle(_ s: String) {
        guard let d = s.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let t = obj["t"] as? String else { return }
        if t == "state", let room = obj["room"] as? [String: Any] {
            let host = room["host"] as? String ?? ""
            let members = (room["members"] as? [[String: Any]] ?? []).map {
                (uid: $0["uid"] as? String ?? "", name: $0["name"] as? String ?? "Guest")
            }
            delegate?.party(members: members, host: host)
        } else if t == "signal", let from = obj["from"] as? String {
            delegate?.party(signalFrom: from,
                            kind: obj["kind"] as? String ?? "",
                            data: obj["data"] as? [String: Any] ?? [:])
        }
    }

    func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }
    func sendShare(_ on: Bool) { send(["t": "share", "on": on]) }
    func sendSignal(to: String, kind: String, data: [String: Any]) {
        send(["t": "signal", "to": to, "kind": kind, "data": data])
    }
}
