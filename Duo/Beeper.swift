import AVFoundation

/// Plays the cue sound out of the built-in speaker at an exact moment,
/// even while Bluetooth headphones are connected.
final class Beeper {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let keepAlive = AVAudioPlayerNode()
    private let rate = 48_000.0
    private let format: AVAudioFormat

    init() {
        format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!
        engine.attach(player)
        engine.attach(keepAlive)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.connect(keepAlive, to: engine.mainMixerNode, format: format)
    }

    /// Routes this app's sound to the speaker. Netflix is not playing yet at
    /// this point, and as soon as `stop()` runs, everything goes back to the headphones.
    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker])
        try session.setActive(true)
        try? session.overrideOutputAudioPort(.speaker)
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
        // Silent loop keeps the app awake in the background until the cue has played.
        if let silence = buffer(from: [Float](repeating: 0, count: Int(rate))) {
            keepAlive.scheduleBuffer(silence, at: nil, options: .loops, completionHandler: nil)
            keepAlive.play()
        }
        player.play()
    }

    /// Schedules the sound so it leaves the speaker at `hostSeconds` (Clock time).
    func schedule(_ sound: CueSound, at hostSeconds: Double, volume: Float) {
        guard let buf = buffer(from: sound.samples(rate: rate)) else { return }
        let session = AVAudioSession.sharedInstance()
        let lead = session.outputLatency + session.ioBufferDuration
        player.volume = volume
        let when = AVAudioTime(hostTime: Clock.ticks(hostSeconds - lead))
        player.scheduleBuffer(buf, at: when, options: [], completionHandler: nil)
    }

    func stop() {
        player.stop()
        keepAlive.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func buffer(from samples: [Float]) -> AVAudioPCMBuffer? {
        guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let ch = buf.floatChannelData?[0] else { return nil }
        buf.frameLength = AVAudioFrameCount(samples.count)
        for i in 0..<samples.count { ch[i] = samples[i] }
        return buf
    }
}
