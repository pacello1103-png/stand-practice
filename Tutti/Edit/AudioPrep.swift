import AVFoundation
import Accelerate

/// ITU-R BS.1770 loudness (LUFS) with K-weighting and gating — the measure streaming services use.
final class LoudnessMeter {
    private struct Biquad {
        var b0, b1, b2, a1, a2: Double
        var z1 = 0.0, z2 = 0.0
        mutating func run(_ x: Double) -> Double {
            let y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            return y
        }
    }

    private var shelf: [Biquad]
    private var highpass: [Biquad]
    private let sub: Int                 // 100 ms
    private var acc = 0.0
    private var count = 0
    private var blocks: [Double] = []    // mean square per 100 ms (summed over channels)

    init(channels: Int, sampleRate: Double = 48_000) {
        // Coefficients from BS.1770 for 48 kHz.
        let s = Biquad(b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585)
        let h = Biquad(b0: 1.0, b1: -2.0, b2: 1.0, a1: -1.99004745483398, a2: 0.99007225036621)
        shelf = Array(repeating: s, count: max(1, channels))
        highpass = Array(repeating: h, count: max(1, channels))
        sub = Int(sampleRate * 0.1)
    }

    /// Non-interleaved channel pointers.
    func process(_ channels: [UnsafePointer<Float>], frames: Int) {
        let n = min(channels.count, shelf.count)
        for i in 0..<frames {
            var e = 0.0
            for c in 0..<n {
                let y = highpass[c].run(shelf[c].run(Double(channels[c][i])))
                e += y * y
            }
            if n == 1 { e *= 2 }   // a mono source plays on both speakers
            acc += e
            count += 1
            if count == sub {
                blocks.append(acc / Double(sub))
                acc = 0
                count = 0
            }
        }
    }

    var integrated: Double? {
        guard blocks.count >= 4 else { return nil }
        var gated: [Double] = []
        for i in 0...(blocks.count - 4) {
            let ms = (blocks[i] + blocks[i + 1] + blocks[i + 2] + blocks[i + 3]) / 4
            if ms > 0 { gated.append(ms) }
        }
        func lufs(_ ms: Double) -> Double { -0.691 + 10 * log10(ms) }
        let absGate = gated.filter { lufs($0) > -70 }
        guard !absGate.isEmpty else { return nil }
        let rel = lufs(absGate.reduce(0, +) / Double(absGate.count)) - 10
        let relGate = absGate.filter { lufs($0) > rel }
        guard !relGate.isEmpty else { return nil }
        return lufs(relGate.reduce(0, +) / Double(relGate.count))
    }
}

struct PreparedAudio {
    var channels: Int
    var low: [Float]        // mono, 8 kHz, for syncing
    var peaks: [Float]      // 100 per second, for drawing
    var loudness: Double?
    var duration: Double
}

enum AudioPrep {
    static let rate = 48_000.0
    static let lowRate = 8_000.0

    /// Copies the sound of a clip into a 48 kHz float file the mixer can play, and measures it on the way.
    static func prepare(from source: URL, to out: URL) async throws -> PreparedAudio? {
        let asset = AVURLAsset(url: source)
        guard let track = try await asset.loadTracks(withMediaType: .audio).first else { return nil }
        let descs = try await track.load(.formatDescriptions)
        var ch = 1
        if let d = descs.first, let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(d)?.pointee {
            ch = Int(max(1, min(2, asbd.mChannelsPerFrame)))
        }
        let reader = try AVAssetReader(asset: asset)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: rate,
            AVNumberOfChannelsKey: ch,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { return nil }
        reader.add(output)
        guard reader.startReading() else { throw reader.error ?? CaptureError.writer("Could not read the sound.") }

        guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: AVAudioChannelCount(ch), interleaved: false) else { return nil }
        try? FileManager.default.removeItem(at: out)
        let file = try AVAudioFile(forWriting: out, settings: fmt.settings, commonFormat: .pcmFormatFloat32, interleaved: false)

        let meter = LoudnessMeter(channels: ch)
        var low: [Float] = []
        var peaks: [Float] = []
        var lowAcc: Float = 0, lowN = 0
        var peakAcc: Float = 0, peakN = 0
        let decim = Int(rate / lowRate)       // 6
        let peakEvery = Int(rate / 100)       // 480
        var total = 0
        var interleaved: [Float] = []

        while let sb = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sb) else { continue }
            let frames = CMSampleBufferGetNumSamples(sb)
            guard frames > 0 else { continue }
            let count = frames * ch
            if interleaved.count < count { interleaved = [Float](repeating: 0, count: count) }
            let status = interleaved.withUnsafeMutableBytes { raw in
                CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: count * 4, destination: raw.baseAddress!)
            }
            guard status == kCMBlockBufferNoErr else { continue }
            guard let pcm = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(frames)), let dst = pcm.floatChannelData else { continue }
            pcm.frameLength = AVAudioFrameCount(frames)
            for c in 0..<ch {
                let d = dst[c]
                for i in 0..<frames { d[i] = interleaved[i * ch + c] }
            }
            try file.write(from: pcm)
            let ptrs = (0..<ch).map { UnsafePointer(dst[$0]) }
            meter.process(ptrs, frames: frames)
            let inv = 1 / Float(ch)
            for i in 0..<frames {
                var m: Float = 0
                for c in 0..<ch { m += dst[c][i] }
                m *= inv
                lowAcc += m
                lowN += 1
                if lowN == decim { low.append(lowAcc / Float(decim)); lowAcc = 0; lowN = 0 }
                let a = abs(m)
                if a > peakAcc { peakAcc = a }
                peakN += 1
                if peakN == peakEvery { peaks.append(peakAcc); peakAcc = 0; peakN = 0 }
            }
            total += frames
        }
        if reader.status == .failed { throw reader.error ?? CaptureError.writer("Could not read the sound.") }
        return PreparedAudio(channels: ch, low: low, peaks: peaks, loudness: meter.integrated, duration: Double(total) / rate)
    }

    static func savePeaks(_ peaks: [Float], to url: URL) {
        let data = peaks.withUnsafeBufferPointer { Data(buffer: $0) }
        try? data.write(to: url)
    }

    static func loadPeaks(_ url: URL) -> [Float] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        var out = [Float](repeating: 0, count: data.count / 4)
        _ = out.withUnsafeMutableBytes { data.copyBytes(to: $0) }
        return out
    }

    /// Mono window from a prepared 48 kHz file.
    static func readMono(_ url: URL, from start: Int, count: Int) -> [Float]? {
        guard let f = try? AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false),
              start >= 0, start < f.length, count > 0 else { return nil }
        let n = min(Int64(count), f.length - Int64(start))
        guard let buf = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: AVAudioFrameCount(n)) else { return nil }
        f.framePosition = AVAudioFramePosition(start)
        do { try f.read(into: buf, frameCount: AVAudioFrameCount(n)) } catch { return nil }
        guard let data = buf.floatChannelData else { return nil }
        let chs = Int(buf.format.channelCount)
        let len = Int(buf.frameLength)
        var out = [Float](repeating: 0, count: len)
        for c in 0..<chs {
            let p = data[c]
            for i in 0..<len { out[i] += p[i] }
        }
        if chs > 1 {
            let s = 1 / Float(chs)
            for i in 0..<len { out[i] *= s }
        }
        return out
    }
}
