import ReplayKit

// The Broadcast Upload Extension. iOS runs this in its own process the moment you
// start a broadcast; every screen frame arrives in processSampleBuffer. We connect
// to the party as host, offer the screen to each viewer over WebRTC, and pump frames.
class SampleHandler: RPBroadcastSampleHandler, PartySignalingDelegate {
    private let signaling = PartySignaling()
    private let broadcaster = WebRTCBroadcaster()
    private var myUid = ""

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        myUid = AppGroup.uid
        broadcaster.onOffer = { [weak self] toUid, sdp in
            self?.signaling.sendSignal(to: toUid, kind: "offer", data: ["type": "offer", "sdp": sdp])
        }
        signaling.delegate = self
        let code = AppGroup.partyCode
        if code.isEmpty {
            finishBroadcastWithError(NSError(domain: "WatchListParty", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Open WatchList Broadcast and set a party code first."]))
            return
        }
        signaling.connect(code: code, name: AppGroup.partyName, uid: myUid)
        signaling.sendShare(true)
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        switch sampleBufferType {
        case .video:    broadcaster.push(sampleBuffer: sampleBuffer)
        case .audioApp: broadcaster.pushAudio(sampleBuffer: sampleBuffer)   // the media the host is playing
        case .audioMic: break                                              // ignore the room mic — app audio only
        @unknown default: break
        }
    }

    override func broadcastFinished() {
        signaling.sendShare(false)
        broadcaster.dropAll()
        signaling.disconnect()
    }

    // PartySignalingDelegate — the live room
    func party(members: [(uid: String, name: String)], host: String) {
        let present = Set(members.map { $0.uid })
        // offer the screen to any viewer we're not connected to yet
        for m in members where m.uid != myUid { broadcaster.connect(to: m.uid) }
        // drop viewers who left
        for gone in broadcaster.viewers().subtracting(present) { broadcaster.drop(gone) }
    }
    func party(signalFrom uid: String, kind: String, data: [String: Any]) {
        if kind == "answer", let sdp = data["sdp"] as? String {
            broadcaster.handleAnswer(from: uid, sdp: sdp)
        }
    }
}
