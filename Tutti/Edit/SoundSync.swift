import Foundation
import Accelerate

/// Lines recordings up by listening: GCC-PHAT cross-correlation (sharp even in reverberant halls),
/// then a sample-accurate refinement at 48 kHz.
enum SoundSync {
    struct Match {
        var lag: Int            // samples: move `other` this much later to line it up with `ref`
        var confidence: Double  // peak height over the noise floor
    }

    /// Both windows must start at the same moment on the current timeline.
    static func coarse(ref: [Float], other: [Float], maxLag: Int) -> Match? {
        let len = min(ref.count, other.count, 1 << 19)
        guard len >= 2048 else { return nil }
        var n = 1
        while n < len * 2 { n <<= 1 }
        guard let fwd = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(n), .FORWARD),
              let inv = vDSP_DFT_zop_CreateSetup(fwd, vDSP_Length(n), .INVERSE) else { return nil }
        defer { vDSP_DFT_DestroySetup(fwd); vDSP_DFT_DestroySetup(inv) }

        var a = [Float](repeating: 0, count: n)
        var b = [Float](repeating: 0, count: n)
        // remove DC and taper the edges
        let meanA = ref.prefix(len).reduce(0, +) / Float(len)
        let meanB = other.prefix(len).reduce(0, +) / Float(len)
        for i in 0..<len {
            let w = taper(i, len)
            a[i] = (ref[i] - meanA) * w
            b[i] = (other[i] - meanB) * w
        }
        let zeros = [Float](repeating: 0, count: n)
        var ar = [Float](repeating: 0, count: n), ai = ar, br = ar, bi = ar
        vDSP_DFT_Execute(fwd, a, zeros, &ar, &ai)
        vDSP_DFT_Execute(fwd, b, zeros, &br, &bi)
        var cr = [Float](repeating: 0, count: n), ci = cr
        for k in 0..<n {
            let re = ar[k] * br[k] + ai[k] * bi[k]
            let im = ai[k] * br[k] - ar[k] * bi[k]
            let mag = sqrt(re * re + im * im) + 1e-12
            let w = 1 / pow(mag, 0.85)        // PHAT weighting (β = 0.85)
            cr[k] = re * w
            ci[k] = im * w
        }
        var rr = [Float](repeating: 0, count: n), ri = rr
        vDSP_DFT_Execute(inv, cr, ci, &rr, &ri)

        let m = min(maxLag, n / 2 - 1)
        var best = -Float.infinity, bestK = 0
        var sum = 0.0, sumSq = 0.0, count = 0.0
        for k in -m...m {
            let v = rr[k >= 0 ? k : n + k]
            if v > best { best = v; bestK = k }
            sum += Double(v); sumSq += Double(v * v); count += 1
        }
        let mean = sum / count
        let sd = sqrt(max(1e-20, sumSq / count - mean * mean))
        return Match(lag: bestK, confidence: (Double(best) - mean) / sd)
    }

    /// Sample-accurate refinement: plain correlation for small lags.
    static func fine(ref: [Float], other: [Float], maxLag: Int) -> Int {
        let len = min(ref.count, other.count) - 2 * maxLag
        guard len > 1000 else { return 0 }
        var best = -Float.infinity, bestK = 0
        ref.withUnsafeBufferPointer { r in
            other.withUnsafeBufferPointer { o in
                for k in -maxLag...maxLag {
                    var dot: Float = 0
                    // event at ref[i] ↔ other[i - k]  (other must move k later)
                    vDSP_dotpr(r.baseAddress! + maxLag, 1, o.baseAddress! + maxLag - k, 1, &dot, vDSP_Length(len))
                    if dot > best { best = dot; bestK = k }
                }
            }
        }
        return bestK
    }

    private static func taper(_ i: Int, _ n: Int) -> Float {
        let edge = max(1, n / 20)
        if i < edge { return 0.5 - 0.5 * cos(Float.pi * Float(i) / Float(edge)) }
        if i > n - edge { return 0.5 - 0.5 * cos(Float.pi * Float(n - i) / Float(edge)) }
        return 1
    }
}
