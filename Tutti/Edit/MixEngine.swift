import AVFoundation
import AudioToolbox

/// The sound studio: main microphone + room microphones, tone, gentle compression, room reverb,
/// loudness and a peak limiter. The same graph plays live in the editor and renders the final file.
final class MixEngine {
    struct Source {
        let cam: Int
        let file: AVAudioFile
        let player = AVAudioPlayerNode()
        let speed = AVAudioUnitVarispeed()
        let trim = AVAudioUnitEQ(numberOfBands: 1)   // gain (globalGain) + high-pass for room mics
        let pan = AVAudioMixerNode()
        var start: Double          // project time of the file's first sample
        var drift: Double
        var autoGain: Double       // dB to bring the mic to a common level
    }

    let engine = AVAudioEngine()
    private(set) var sources: [Source] = []
    private let mainBus = AVAudioMixerNode()
    private let roomBus = AVAudioMixerNode()
    private let sum = AVAudioMixerNode()
    private let tone = AVAudioUnitEQ(numberOfBands: 4)
    private let comp: AVAudioUnitEffect
    private let reverb = AVAudioUnitReverb()
    private let limiter: AVAudioUnitEffect
    let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
    private(set) var settings = SoundSettings()
    private var gainDB: Double = 0
    private var routedToRoom: [Bool] = []

    init(project p: Project, store: ProjectStore) throws {
        comp = AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
            componentType: kAudioUnitType_Effect, componentSubType: kAudioUnitSubType_DynamicsProcessor,
            componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0))
        limiter = AVAudioUnitEffect(audioComponentDescription: AudioComponentDescription(
            componentType: kAudioUnitType_Effect, componentSubType: kAudioUnitSubType_PeakLimiter,
            componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0))

        for node in [mainBus, roomBus, sum] { engine.attach(node) }
        for node in [tone, comp, reverb, limiter] as [AVAudioNode] { engine.attach(node) }

        engine.connect(mainBus, to: sum, format: format)
        engine.connect(roomBus, to: sum, format: format)
        engine.connect(sum, to: tone, format: format)
        engine.connect(tone, to: comp, format: format)
        engine.connect(comp, to: reverb, format: format)
        engine.connect(reverb, to: limiter, format: format)
        engine.connect(limiter, to: engine.mainMixerNode, format: format)

        let target = p.sound.target
        for c in p.audioClips {
            guard let name = c.audioFile,
                  let file = try? AVAudioFile(forReading: store.url(p, name), commonFormat: .pcmFormatFloat32, interleaved: false) else { continue }
            let auto = c.loudness.map { max(-18, min(18, (target - 6) - $0)) } ?? 0
            let s = Source(cam: c.cam, file: file, start: c.start + c.audioShift, drift: c.drift, autoGain: auto)
            for n in [s.player, s.speed, s.trim, s.pan] as [AVAudioNode] { engine.attach(n) }
            let f = file.processingFormat
            engine.connect(s.player, to: s.speed, format: f)
            engine.connect(s.speed, to: s.trim, format: f)
            engine.connect(s.trim, to: s.pan, format: f)
            engine.connect(s.pan, to: mainBus, format: f)
            s.speed.rate = Float(1 / (1 + c.drift))
            routedToRoom.append(false)
            sources.append(s)
        }
        engine.mainMixerNode.outputVolume = 0.891   // −1 dB ceiling
        apply(p.sound, gainDB: p.mixGain ?? 0)
    }

    /// Re-routes each microphone (main / room / off) and sets every control.
    func apply(_ s: SoundSettings, gainDB: Double) {
        settings = s
        self.gainDB = gainDB
        let roomCams = s.mics.filter { $0.role == .room }.map(\.cam)
        for (i, src) in sources.enumerated() {
            let mic = s.mics.first { $0.cam == src.cam } ?? MicSetting(cam: src.cam, role: i == 0 ? .main : .room)
            let toRoom = mic.role == .room
            if toRoom != routedToRoom[i] {
                engine.disconnectNodeOutput(src.pan)
                engine.connect(src.pan, to: toRoom ? roomBus : mainBus, format: src.file.processingFormat)
                routedToRoom[i] = toRoom
            }
            src.pan.outputVolume = mic.role == .off ? 0 : 1
            src.trim.globalGain = Float(max(-24, min(24, src.autoGain + mic.gain)))
            let band = src.trim.bands[0]
            band.filterType = .highPass
            band.frequency = mic.role == .room ? 110 : 30
            band.bypass = false
            var pan = mic.pan
            if mic.role == .room, roomCams.count > 1, abs(mic.pan) < 0.001, let k = roomCams.firstIndex(of: src.cam) {
                // spread room microphones across the stereo picture
                let spread = (Double(k) / Double(roomCams.count - 1)) * 2 - 1
                pan = spread * s.roomWidth
            }
            src.pan.pan = Float(pan)
        }
        // how much room: 0 → none, 1 → room as loud as the main mic
        roomBus.outputVolume = Float(pow(max(0, min(1, s.room)), 1.4))
        mainBus.outputVolume = 1

        let bands = tone.bands
        bands[0].filterType = .highPass
        bands[0].frequency = 70
        bands[0].bypass = !s.lowCut
        bands[1].filterType = .lowShelf
        bands[1].frequency = 220
        bands[1].gain = Float(s.warmth * 4)
        bands[1].bypass = abs(s.warmth) < 0.01
        bands[2].filterType = .parametric
        bands[2].frequency = 3200
        bands[2].bandwidth = 1.2
        bands[2].gain = Float(s.presence * 4)
        bands[2].bypass = abs(s.presence) < 0.01
        bands[3].filterType = .highShelf
        bands[3].frequency = 9500
        bands[3].gain = Float(s.air * 5)
        bands[3].bypass = abs(s.air) < 0.01

        let a = max(0, min(1, s.compress))
        comp.bypass = a < 0.01
        setParam(comp, kDynamicsProcessorParam_Threshold, Float(-8 - 22 * a))
        setParam(comp, kDynamicsProcessorParam_HeadRoom, Float(10 - 7 * a))
        setParam(comp, kDynamicsProcessorParam_AttackTime, 0.015)
        setParam(comp, kDynamicsProcessorParam_ReleaseTime, 0.25)

        if s.reverb == .none {
            reverb.bypass = true
        } else {
            reverb.bypass = false
            reverb.loadFactoryPreset(Self.preset(s.reverb))
            reverb.wetDryMix = Float(max(0, min(1, s.reverbAmount)) * 45)
        }

        setParam(limiter, kLimiterParam_AttackTime, 0.004)
        setParam(limiter, kLimiterParam_DecayTime, 0.05)
        setParam(limiter, kLimiterParam_PreGain, Float(max(-30, min(30, gainDB))))
    }

    private static func preset(_ r: RoomSound) -> AVAudioUnitReverbPreset {
        switch r {
        case .studio: return .mediumRoom
        case .chamber: return .mediumChamber
        case .hall: return .largeHall
        case .church: return .cathedral
        case .plate: return .plate
        case .none: return .smallRoom
        }
    }

    private func setParam(_ unit: AVAudioUnitEffect, _ id: AudioUnitParameterID, _ value: Float) {
        AudioUnitSetParameter(unit.audioUnit, id, kAudioUnitScope_Global, 0, value, 0)
    }

    // MARK: - Playing

    /// Queue every microphone so that project time `t` plays first.
    func schedule(from t: Double) {
        for s in sources {
            s.player.stop()
            let sr = s.file.processingFormat.sampleRate
            let into = (t - s.start) / (1 + s.drift)
            var startFrame: AVAudioFramePosition = 0
            var delay = 0.0
            if into >= 0 { startFrame = AVAudioFramePosition(into * sr) } else { delay = -(t - s.start) }
            let frames = s.file.length - startFrame
            guard frames > 0 else { continue }
            let when: AVAudioTime? = delay > 0 ? AVAudioTime(sampleTime: AVAudioFramePosition(delay * sr), atRate: sr) : nil
            s.player.scheduleSegment(s.file, startingFrame: startFrame, frameCount: AVAudioFrameCount(frames), at: when, completionHandler: nil)
        }
    }

    func play(from t: Double, hostTime: UInt64) {
        if !engine.isRunning { try? engine.start() }
        schedule(from: t)
        let at = AVAudioTime(hostTime: hostTime)
        for s in sources { s.player.play(at: at) }
    }

    func pause() {
        for s in sources { s.player.stop() }
    }

    func shutdown() {
        pause()
        engine.stop()
    }

    // MARK: - Rendering

    /// Renders the mix offline. With `measureOnly` nothing is written; returns the loudness (LUFS).
    func render(duration: Double, to url: URL?, progress: ((Double) -> Void)? = nil) throws -> Double? {
        engine.stop()
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
        defer { engine.stop(); engine.disableManualRenderingMode() }
        try engine.start()
        schedule(from: 0)
        for s in sources { s.player.play() }

        let total = AVAudioFramePosition(duration * format.sampleRate)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: engine.manualRenderingMaximumFrameCount) else { return nil }
        var out: AVAudioFile?
        if let url {
            try? FileManager.default.removeItem(at: url)
            out = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        }
        let meter = LoudnessMeter(channels: 2)
        var lastReport = 0.0
        while engine.manualRenderingSampleTime < total {
            let left = total - engine.manualRenderingSampleTime
            let n = AVAudioFrameCount(min(Int64(buffer.frameCapacity), left))
            let status = try engine.renderOffline(n, to: buffer)
            switch status {
            case .success:
                if let out { try out.write(from: buffer) }
                if let d = buffer.floatChannelData {
                    meter.process([UnsafePointer(d[0]), UnsafePointer(d[1])], frames: Int(buffer.frameLength))
                }
                let f = Double(engine.manualRenderingSampleTime) / Double(max(1, total))
                if f - lastReport > 0.01 { lastReport = f; progress?(f) }
            case .insufficientDataFromInputNode, .cannotDoInCurrentContext:
                continue
            case .error:
                throw CaptureError.writer("The sound could not be rendered.")
            @unknown default:
                continue
            }
        }
        return meter.integrated
    }
}
