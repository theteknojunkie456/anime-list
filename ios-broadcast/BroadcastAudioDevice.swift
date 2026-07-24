import Foundation
import WebRTC
import CoreMedia
import AVFoundation
import AudioToolbox

// A custom WebRTC audio device that never opens the microphone or an AVAudioSession.
// Instead it forwards the app-audio PCM that ReplayKit hands the broadcast extension
// straight into WebRTC's audio pipeline, so party viewers hear whatever the host is
// actually playing on screen.
//
// Why a custom device at all: the stock WebRTC ADM records from the mic via an
// AudioUnit backed by AVAudioSession(.playAndRecord). Inside a Broadcast Upload
// Extension that both fights ReplayKit for the audio session AND blows the ~50 MB
// memory budget — which is exactly why "iOS broadcast can't do audio" is the usual
// verdict. By implementing RTCAudioDevice ourselves and *never* touching AVAudioSession,
// we sidestep the conflict and just push ReplayKit's buffers in. It's send-only, so
// playout is a deliberate no-op (the extension must not play anything back).
final class BroadcastAudioDevice: NSObject, RTCAudioDevice {

    // What we hand WebRTC. Its audio-processing module re-frames this into 10 ms chunks
    // internally, so a steady 48 kHz mono int16 stream is all it needs. Mono keeps the
    // extension light and halves audio bandwidth — plenty for a watch party.
    private let outRate: Double = 48000
    private let outChannels = 1

    private weak var delegate: RTCAudioDeviceDelegate?
    private let dstFormat: AVAudioFormat
    private var converter: AVAudioConverter?
    private var srcFormat: AVAudioFormat?
    private var srcRate: Double = 0
    private var srcChannels: UInt32 = 0
    private var runningSampleTime: Float64 = 0

    // Flags the native ADM reads/drives between initialize and terminate.
    private var _isInitialized = false
    private var _isPlayoutInitialized = false
    private var _isRecordingInitialized = false
    private var _isPlaying = false
    private var _isRecording = false

    override init() {
        dstFormat = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                  sampleRate: 48000,
                                  channels: 1,
                                  interleaved: true)!
        super.init()
    }

    // MARK: ReplayKit app-audio -> WebRTC

    // Called from the ReplayKit sample-handler thread for every .audioApp buffer.
    // ReplayKit uses a single serial delivery thread, satisfying the ADM's
    // "same thread" requirement for deliverRecordedData.
    func push(sampleBuffer: CMSampleBuffer) {
        guard _isRecording, let delegate = delegate,
              CMSampleBufferDataIsReady(sampleBuffer),
              let fmtDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmtDesc) else { return }

        // (Re)build the resampler if the incoming format changed (it's stable for a
        // session in practice, but be safe).
        let rate = asbd.pointee.mSampleRate
        let ch = asbd.pointee.mChannelsPerFrame
        if converter == nil || rate != srcRate || ch != srcChannels {
            guard let sFormat = AVAudioFormat(streamDescription: asbd) else { return }
            converter = AVAudioConverter(from: sFormat, to: dstFormat)
            srcFormat = sFormat; srcRate = rate; srcChannels = ch
        }
        guard let converter = converter, let srcFormat = srcFormat else { return }

        // Wrap the CMSampleBuffer's PCM in an AVAudioPCMBuffer matching its own format.
        let numFrames = CMSampleBufferGetNumSamples(sampleBuffer)
        guard numFrames > 0,
              let srcBuffer = AVAudioPCMBuffer(pcmFormat: srcFormat,
                                               frameCapacity: AVAudioFrameCount(numFrames)) else { return }
        srcBuffer.frameLength = AVAudioFrameCount(numFrames)
        let copyStatus = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer, at: 0, frameCount: Int32(numFrames),
            into: srcBuffer.mutableAudioBufferList)
        guard copyStatus == noErr else { return }

        // Resample / downmix to 48 kHz mono int16.
        let capacity = AVAudioFrameCount(Double(numFrames) * outRate / srcFormat.sampleRate) + 1024
        guard let dstBuffer = AVAudioPCMBuffer(pcmFormat: dstFormat, frameCapacity: capacity) else { return }
        var provided = false
        var convError: NSError?
        let convStatus = converter.convert(to: dstBuffer, error: &convError) { _, outStatus in
            if provided { outStatus.pointee = .noDataNow; return nil }
            provided = true
            outStatus.pointee = .haveData
            return srcBuffer
        }
        guard convStatus != .error, dstBuffer.frameLength > 0 else { return }

        // Feed the converted PCM into WebRTC's ADM.
        var flags = AudioUnitRenderActionFlags(rawValue: 0)
        var ts = AudioTimeStamp()
        ts.mSampleTime = runningSampleTime
        ts.mFlags = .sampleTimeValid
        runningSampleTime += Float64(dstBuffer.frameLength)
        _ = delegate.deliverRecordedData(&flags, &ts, 0, dstBuffer.frameLength,
                                         dstBuffer.audioBufferList, nil, nil)
    }

    // MARK: RTCAudioDevice — reported parameters

    var deviceInputSampleRate: Double { outRate }
    var inputIOBufferDuration: TimeInterval { 0.01 }
    var inputNumberOfChannels: Int { outChannels }
    var inputLatency: TimeInterval { 0 }
    var deviceOutputSampleRate: Double { outRate }
    var outputIOBufferDuration: TimeInterval { 0.01 }
    var outputNumberOfChannels: Int { outChannels }
    var outputLatency: TimeInterval { 0 }

    // MARK: RTCAudioDevice — lifecycle

    var isInitialized: Bool { _isInitialized }

    @objc(initializeWithDelegate:)
    func initialize(with delegate: RTCAudioDeviceDelegate) -> Bool {
        self.delegate = delegate
        _isInitialized = true
        return true
    }

    func terminateDevice() -> Bool {
        delegate = nil
        _isInitialized = false
        _isPlayoutInitialized = false
        _isRecordingInitialized = false
        _isPlaying = false
        _isRecording = false
        return true
    }

    // Playout: send-only, so accept the calls but never pull/emit audio.
    var isPlayoutInitialized: Bool { _isPlayoutInitialized }
    func initializePlayout() -> Bool { _isPlayoutInitialized = true; return true }
    var isPlaying: Bool { _isPlaying }
    func startPlayout() -> Bool { _isPlaying = true; return true }
    func stopPlayout() -> Bool { _isPlaying = false; return true }

    // Recording: flip the flag; the real work is push(sampleBuffer:) above.
    var isRecordingInitialized: Bool { _isRecordingInitialized }
    func initializeRecording() -> Bool { _isRecordingInitialized = true; return true }
    var isRecording: Bool { _isRecording }
    func startRecording() -> Bool { _isRecording = true; return true }
    func stopRecording() -> Bool { _isRecording = false; return true }
}
