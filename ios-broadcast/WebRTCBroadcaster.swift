import Foundation
import WebRTC
import CoreMedia

// One broadcaster → many viewers (mesh). It owns a single screen video track and,
// for each viewer in the party, a peer connection that gets that track. Uses
// non-trickle ICE (wait for gathering to finish, then send the offer once) to match
// the web viewer, which doesn't handle trickled candidates.
final class WebRTCBroadcaster {
    private let factory: RTCPeerConnectionFactory
    private let videoSource: RTCVideoSource
    private let videoTrack: RTCVideoTrack
    private let capturer: RTCVideoCapturer
    private var peers: [String: Peer] = [:]

    // called to hand a completed offer/answer back to the party signaling layer
    var onOffer: ((_ toUid: String, _ sdp: String) -> Void)?

    private let iceServers = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]

    init() {
        RTCInitializeSSL()
        let encoder = RTCDefaultVideoEncoderFactory()
        let decoder = RTCDefaultVideoDecoderFactory()
        factory = RTCPeerConnectionFactory(encoderFactory: encoder, decoderFactory: decoder)
        videoSource = factory.videoSource()
        capturer = RTCVideoCapturer(delegate: videoSource)   // we feed frames manually
        videoTrack = factory.videoTrack(with: videoSource, trackId: "screen0")
    }

    private func config() -> RTCConfiguration {
        let c = RTCConfiguration()
        // Use the urlStrings:username:credential: initializer, NOT urlStrings: alone —
        // the single-arg form compiles to the selector `initWithURLStrings:`, which
        // App Store validation rejects as a non-public selector (code 50). STUN needs
        // no creds, so pass nil.
        c.iceServers = [RTCIceServer(urlStrings: iceServers, username: nil, credential: nil)]
        c.sdpSemantics = .unifiedPlan
        return c
    }

    // A viewer appeared → build a peer, add the screen track, offer them the stream.
    func connect(to uid: String) {
        guard peers[uid] == nil else { return }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let pc = factory.peerConnection(with: config(), constraints: constraints, delegate: nil) else { return }
        pc.add(videoTrack, streamIds: ["screen"])
        let peer = Peer(uid: uid, pc: pc) { [weak self] sdp in self?.onOffer?(uid, sdp) }
        pc.delegate = peer
        peers[uid] = peer
        peer.makeOffer()
    }

    func handleAnswer(from uid: String, sdp: String) {
        guard let peer = peers[uid] else { return }
        let desc = RTCSessionDescription(type: .answer, sdp: sdp)
        peer.pc.setRemoteDescription(desc) { _ in }
    }

    func drop(_ uid: String) { peers[uid]?.pc.close(); peers[uid] = nil }
    func dropAll() { peers.values.forEach { $0.pc.close() }; peers.removeAll() }
    func viewers() -> Set<String> { Set(peers.keys) }

    // Feed one ReplayKit screen frame into the shared video track.
    func push(sampleBuffer: CMSampleBuffer) {
        guard let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let rtcBuffer = RTCCVPixelBuffer(pixelBuffer: pixel)
        let ts = Int64(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) * 1_000_000_000)
        let frame = RTCVideoFrame(buffer: rtcBuffer, rotation: ._0, timeStampNs: ts)
        videoSource.capturer(capturer, didCapture: frame)
    }
}

// One viewer's peer connection. Handles non-trickle: create offer → set local →
// when ICE gathering completes, hand the full SDP (candidates embedded) upward.
private final class Peer: NSObject, RTCPeerConnectionDelegate {
    let uid: String
    let pc: RTCPeerConnection
    private let deliverOffer: (String) -> Void
    private var offerSent = false

    init(uid: String, pc: RTCPeerConnection, deliverOffer: @escaping (String) -> Void) {
        self.uid = uid; self.pc = pc; self.deliverOffer = deliverOffer
    }

    func makeOffer() {
        let c = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc.offer(for: c) { [weak self] desc, _ in
            guard let self, let desc else { return }
            self.pc.setLocalDescription(desc) { _ in }
            // fallback in case the "complete" delegate is slow
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) { self.flushOffer() }
        }
    }
    private func flushOffer() {
        guard !offerSent, let sdp = pc.localDescription?.sdp else { return }
        offerSent = true
        deliverOffer(sdp)
    }

    // RTCPeerConnectionDelegate
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        if newState == .complete { flushOffer() }
    }
    func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {}
    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}   // non-trickle: ignore
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
