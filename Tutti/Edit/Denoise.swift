import AVFoundation
import Accelerate

/// Noise reduction for a microphone track (hiss, air conditioning, phone-mic noise):
/// learns the noise from the quietest moments, then gently gates it out of the spectrum.
/// Tuned for music — it never removes more than the chosen amount and keeps note tails natural.
enum Denoise {
    private static let n = 2048
    private static let hop = 512
    private static let log2n = vDSP_Length(11)

    /// Streams a file in hops and hands out windowed frames.
    private final class Framer {
        var buffer: [Float] = []
        var read = 0
        let window: [Float]
        init(window: [Float], pad: Int) {
            self.window = window
            buffer = [Float](repeating: 0, count: pad)
        }
        func push(_ p: UnsafePointer<Float>, _ count: Int) {
            buffer.append(contentsOf: UnsafeBufferPointer(start: p, count: count))
        }
        func pushZeros(_ count: Int) { buffer.append(contentsOf: [Float](repeating: 0, count: count)) }
        /// Calls `body` with each complete frame (windowed).
        func frames(_ body: ([Float]) -> Void) {
            while buffer.count - read >= Denoise.n {
                var f = [Float](repeating: 0, count: Denoise.n)
                buffer.withUnsafeBufferPointer { b in
                    vDSP_vmul(b.baseAddress! + read, 1, window, 1, &f, 1, vDSP_Length(Denoise.n))
                }
                body(f)
                read += Denoise.hop
            }
            if read > 1 << 16 {
                buffer.removeFirst(read)
                read = 0
            }
        }
    }

    private final class FFT {
        let setup: FFTSetup
        var re = [Float](repeating: 0, count: Denoise.n / 2)
        var im = [Float](repeating: 0, count: Denoise.n / 2)
        init() { setup = vDSP_create_fftsetup(Denoise.log2n, FFTRadix(kFFTRadix2))! }
        deinit { vDSP_destroy_fftsetup(setup) }

        /// Magnitudes (n/2 + 1 bins) of a windowed frame; keeps the spectrum for `inverse`.
        func forward(_ frame: [Float], mags: inout [Float]) {
            re.withUnsafeMutableBufferPointer { rp in
                im.withUnsafeMutableBufferPointer { ip in
                    var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                    frame.withUnsafeBufferPointer { fp in
                        fp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: Denoise.n / 2) {
                            vDSP_ctoz($0, 2, &split, 1, vDSP_Length(Denoise.n / 2))
                        }
                    }
                    vDSP_fft_zrip(setup, &split, 1, Denoise.log2n, FFTDirection(FFT_FORWARD))
                }
            }
            let half = Denoise.n / 2
            mags[0] = abs(re[0])
            mags[half] = abs(im[0])
            for k in 1..<half { mags[k] = (re[k] * re[k] + im[k] * im[k]).squareRoot() }
        }

        /// Applies per-bin gains to the kept spectrum and returns the time signal.
        func inverse(gains: [Float]) -> [Float] {
            let half = Denoise.n / 2
            re[0] *= gains[0]
            im[0] *= gains[half]
            for k in 1..<half { re[k] *= gains[k]; im[k] *= gains[k] }
            var out = [Float](repeating: 0, count: Denoise.n)
            re.withUnsafeMutableBufferPointer { rp in
                im.withUnsafeMutableBufferPointer { ip in
                    var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                    vDSP_fft_zrip(setup, &split, 1, Denoise.log2n, FFTDirection(FFT_INVERSE))
                    out.withUnsafeMutableBufferPointer { op in
                        op.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) {
                            vDSP_ztoc(&split, 1, $0, 2, vDSP_Length(half))
                        }
                    }
                }
            }
            return out
        }
    }

    private static func addInPlace(_ a: inout [Float], _ b: [Float]) {
        let count = min(a.count, b.count)
        a.withUnsafeMutableBufferPointer { p in vDSP_vadd(p.baseAddress!, 1, b, 1, p.baseAddress!, 1, vDSP_Length(count)) }
    }

    private static func mulInPlace(_ a: inout [Float], _ b: [Float]) {
        let count = min(a.count, b.count)
        a.withUnsafeMutableBufferPointer { p in vDSP_vmul(p.baseAddress!, 1, b, 1, p.baseAddress!, 1, vDSP_Length(count)) }
    }

    private static func scaleInPlace(_ a: inout [Float], _ k: Float) {
        var s = k
        let count = a.count
        a.withUnsafeMutableBufferPointer { p in vDSP_vsmul(p.baseAddress!, 1, &s, p.baseAddress!, 1, vDSP_Length(count)) }
    }

    private static var hann: [Float] {
        (0..<n).map { i in 0.5 - 0.5 * cos(2 * Float.pi * Float(i) / Float(n)) }
    }

    static func process(input: URL, output: URL, strength: Double, progress: ((Double) -> Void)? = nil) throws {
        let file = try AVAudioFile(forReading: input, commonFormat: .pcmFormatFloat32, interleaved: false)
        let fmt = file.processingFormat
        let ch = Int(fmt.channelCount)
        let total = Int(file.length)
        let block: AVAudioFrameCount = 1 << 16
        guard total > n * 4, let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: block) else {
            throw CaptureError.writer("The sound is too short to clean.")
        }
        let half = n / 2
        let window = hann

        // 1. loudness of every hop, to find the quiet moments
        var energies: [Float] = []
        file.framePosition = 0
        while file.framePosition < file.length {
            try file.read(into: buf, frameCount: block)
            let len = Int(buf.frameLength)
            guard len > 0, let d = buf.floatChannelData else { break }
            var i = 0
            while i + hop <= len {
                var e: Float = 0
                for c in 0..<ch { var v: Float = 0; vDSP_measqv(d[c] + i, 1, &v, vDSP_Length(hop)); e += v }
                energies.append(e)
                i += hop
            }
        }
        let sorted = energies.sorted()
        let quiet = sorted[min(sorted.count - 1, max(0, Int(Double(sorted.count) * 0.12)))]
        progress?(0.15)

        // 2. noise spectrum from the quiet frames (mono sum)
        var noise = [Float](repeating: 0, count: half + 1)
        var counted = 0
        do {
            let fft = FFT()
            let framer = Framer(window: window, pad: 0)
            var mags = [Float](repeating: 0, count: half + 1)
            var frameIndex = 0
            file.framePosition = 0
            var mono = [Float](repeating: 0, count: Int(block))
            while file.framePosition < file.length {
                try file.read(into: buf, frameCount: block)
                let len = Int(buf.frameLength)
                guard len > 0, let d = buf.floatChannelData else { break }
                mono.withUnsafeMutableBufferPointer { m in
                    vDSP_vclr(m.baseAddress!, 1, vDSP_Length(len))
                    for c in 0..<ch { vDSP_vadd(m.baseAddress!, 1, d[c], 1, m.baseAddress!, 1, vDSP_Length(len)) }
                }
                mono.withUnsafeBufferPointer { framer.push($0.baseAddress!, len) }
                framer.frames { f in
                    let e = frameIndex < energies.count ? energies[frameIndex] : .infinity
                    frameIndex += 1
                    guard e <= quiet else { return }
                    fft.forward(f, mags: &mags)
                    addInPlace(&noise, mags)
                    counted += 1
                }
            }
        }
        guard counted > 4 else { throw CaptureError.writer("No quiet moment to learn the noise from.") }
        scaleInPlace(&noise, 1 / Float(counted * max(1, ch)))     // per channel (the profile was summed over channels)
        progress?(0.3)

        // 3. clean every channel
        let s = Float(max(0, min(1, strength)))
        let floorGain = pow(10, -(6 + 16 * s) / 20)
        let over = 1.2 + 1.6 * s
        try? FileManager.default.removeItem(at: output)
        let out = try AVAudioFile(forWriting: output, settings: fmt.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
        let pad = n - hop
        let ffts = (0..<ch).map { _ in FFT() }
        let framers = (0..<ch).map { _ in Framer(window: window, pad: pad) }
        var olas = [[Float]](repeating: [Float](repeating: 0, count: n), count: ch)
        var smooth = [[Float]](repeating: [Float](repeating: 1, count: half + 1), count: ch)
        var pending = [[Float]](repeating: [], count: ch)
        var toSkip = pad
        var written = 0
        let norm: Float = 1 / (Float(2 * n) * 1.5)
        var mags = [Float](repeating: 0, count: half + 1)
        var gains = [Float](repeating: 1, count: half + 1)

        func processFrames() {
            for c in 0..<ch {
                framers[c].frames { f in
                    ffts[c].forward(f, mags: &mags)
                    for k in 0...half {
                        let g = max(floorGain, 1 - over * noise[k] / max(mags[k], 1e-9))
                        // open fast, close slowly (keeps note tails and reverberation)
                        let prev = smooth[c][k]
                        smooth[c][k] = g > prev ? g : prev * 0.82 + g * 0.18
                    }
                    // smooth across neighbouring bins
                    gains[0] = smooth[c][0]
                    gains[half] = smooth[c][half]
                    for k in 1..<half { gains[k] = (smooth[c][k - 1] + 2 * smooth[c][k] + smooth[c][k + 1]) * 0.25 }
                    var y = ffts[c].inverse(gains: gains)
                    mulInPlace(&y, window)
                    scaleInPlace(&y, norm)
                    addInPlace(&olas[c], y)
                    pending[c].append(contentsOf: olas[c][0..<hop])
                    olas[c].removeFirst(hop)
                    olas[c].append(contentsOf: [Float](repeating: 0, count: hop))
                }
            }
        }

        func flushOutput(final: Bool) throws {
            let ready = pending.map(\.count).min() ?? 0
            guard ready > 0 else { return }
            var start = 0
            if toSkip > 0 {
                let k = min(toSkip, ready)
                start = k
                toSkip -= k
            }
            let count = min(ready - start, total - written)
            if count > 0, let ob = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(count)), let od = ob.floatChannelData {
                ob.frameLength = AVAudioFrameCount(count)
                for c in 0..<ch {
                    pending[c].withUnsafeBufferPointer { p in
                        od[c].update(from: p.baseAddress! + start, count: count)
                    }
                }
                try out.write(from: ob)
                written += count
            }
            for c in 0..<ch { pending[c].removeFirst(ready) }
        }

        file.framePosition = 0
        while file.framePosition < file.length {
            try file.read(into: buf, frameCount: block)
            let len = Int(buf.frameLength)
            guard len > 0, let d = buf.floatChannelData else { break }
            for c in 0..<ch { framers[c].push(d[c], len) }
            processFrames()
            try flushOutput(final: false)
            progress?(0.3 + 0.7 * Double(file.framePosition) / Double(max(1, file.length)))
        }
        for c in 0..<ch { framers[c].pushZeros(n) }
        processFrames()
        try flushOutput(final: true)
    }
}
