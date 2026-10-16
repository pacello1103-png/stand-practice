import AVFoundation
import CoreGraphics
import simd

/// Measures each camera's brightness and colour so they can all be matched to one reference camera,
/// and evens out brightness that drifts during a take.
enum LookMatch {
    struct Sample {
        var time: Double
        var mid: Double          // median luminance (linear)
        var high: Double         // 90th percentile luminance
        var rgb: SIMD3<Double>   // mean colour of the mid-tones (linear)
    }

    private static let toLinear: [Double] = (0..<256).map { i in
        let c = Double(i) / 255
        return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }

    static func analyze(url: URL, duration: Double, maxSamples: Int = 40) async -> [Sample] {
        let asset = AVURLAsset(url: url)
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = false
        gen.maximumSize = CGSize(width: 96, height: 96)
        let tol = CMTime(seconds: 0.5, preferredTimescale: 600)
        gen.requestedTimeToleranceBefore = tol
        gen.requestedTimeToleranceAfter = tol
        let n = max(3, min(maxSamples, Int(duration / 1.5)))
        var out: [Sample] = []
        for i in 0..<n {
            let t = duration * (Double(i) + 0.5) / Double(n)
            guard let img = try? await gen.image(at: CMTime(seconds: t, preferredTimescale: 600)).image,
                  let s = stats(img) else { continue }
            out.append(Sample(time: t, mid: s.mid, high: s.high, rgb: s.rgb))
        }
        return out
    }

    private static func stats(_ img: CGImage) -> (mid: Double, high: Double, rgb: SIMD3<Double>)? {
        let w = 64, h = 36
        var px = [UInt8](repeating: 0, count: w * h * 4)
        guard let cs = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let drawn: Bool = px.withUnsafeMutableBytes { raw in
            guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return nil }
        var lum: [Double] = []
        lum.reserveCapacity(w * h)
        var sum = SIMD3<Double>(repeating: 0)
        var count = 0.0
        for i in 0..<(w * h) {
            let r = toLinear[Int(px[i * 4])], g = toLinear[Int(px[i * 4 + 1])], b = toLinear[Int(px[i * 4 + 2])]
            let y = 0.2126 * r + 0.7152 * g + 0.0722 * b
            lum.append(y)
            if y > 0.03 && y < 0.6 {   // mid-tones: no black curtains, no blown lights
                sum += SIMD3(r, g, b)
                count += 1
            }
        }
        lum.sort()
        let mid = lum[lum.count / 2]
        let high = lum[Int(Double(lum.count) * 0.9)]
        let rgb = count > 20 ? sum / count : SIMD3(repeating: max(mid, 0.001))
        return (mid, high, rgb)
    }

    private static func median(_ v: [Double]) -> Double {
        guard !v.isEmpty else { return 0 }
        let s = v.sorted()
        return s[s.count / 2]
    }

    private static func level(_ s: Sample) -> Double { sqrt(max(1e-6, s.mid) * max(1e-6, s.high)) }

    /// Corrections that make `cam` look like `ref`.
    static func match(cam: [Sample], ref: [Sample], isReference: Bool) -> AutoLook {
        var look = AutoLook()
        guard !cam.isEmpty else { return look }
        if !isReference, !ref.isEmpty {
            let camL = median(cam.map(level)), refL = median(ref.map(level))
            if camL > 0.0005, refL > 0.0005 {
                look.exposure = max(0.55, min(1.8, refL / camL))
            }
            func chroma(_ list: [Sample]) -> SIMD3<Double> {
                var s = SIMD3<Double>(repeating: 0)
                for x in list {
                    let y = max(1e-4, 0.2126 * x.rgb.x + 0.7152 * x.rgb.y + 0.0722 * x.rgb.z)
                    s += x.rgb / y
                }
                return s / Double(list.count)
            }
            let c = chroma(cam), r = chroma(ref)
            var g = SIMD3<Double>(r.x / max(c.x, 1e-4), r.y / max(c.y, 1e-4), r.z / max(c.z, 1e-4))
            g = simd_clamp(g, SIMD3(repeating: 0.88), SIMD3(repeating: 1.12))
            let norm = 0.2126 * g.x + 0.7152 * g.y + 0.0722 * g.z
            g /= norm
            look.gains = [g.x, g.y, g.z]
        }
        // steady brightness over time
        if cam.count >= 5 {
            let levels = cam.map(level)
            let med = median(levels)
            var smooth: [Double] = []
            for i in 0..<levels.count {
                let lo = max(0, i - 2), hi = min(levels.count - 1, i + 2)
                smooth.append(median(Array(levels[lo...hi])))
            }
            let gains = smooth.map { max(0.8, min(1.25, med / max($0, 1e-5))) }
            if let worst = gains.map({ abs($0 - 1) }).max(), worst > 0.04 {
                look.steadyTimes = cam.map(\.time)
                look.steadyGains = gains
            }
        }
        return look
    }
}
