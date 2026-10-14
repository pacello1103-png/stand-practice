import Foundation

/// The cue sounds. Pop, Click and Ee are shaped like the sounds that
/// Switch Control can listen for; Beep is a plain tone.
enum CueSound: String, CaseIterable, Identifiable {
    case pop, click, ee, beep

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pop: return "Pop"
        case .click: return "Click"
        case .ee: return "Ee"
        case .beep: return "Beep"
        }
    }

    var hint: String {
        switch self {
        case .pop: return "A soft lip pop. In Switch Control choose “Pop”."
        case .click: return "A short tongue click. In Switch Control choose “Click”."
        case .ee: return "A short “ee” tone. In Switch Control choose “Ee”."
        case .beep: return "A plain beep, for Vocal Shortcuts."
        }
    }

    func samples(rate: Double) -> [Float] {
        switch self {
        case .pop: return Self.normalize(Self.pop(rate))
        case .click: return Self.normalize(Self.click(rate))
        case .ee: return Self.normalize(Self.ee(rate))
        case .beep: return Self.normalize(Self.beep(rate))
        }
    }

    private static func normalize(_ x: [Float]) -> [Float] {
        let peak = x.map { abs($0) }.max() ?? 1
        guard peak > 0 else { return x }
        return x.map { $0 / peak * 0.9 }
    }

    private static func pop(_ rate: Double) -> [Float] {
        let n = Int(0.08 * rate)
        var out = [Float](repeating: 0, count: n)
        var phase = 0.0
        for i in 0..<n {
            let t = Double(i) / rate
            let f = 80 + 520 * exp(-t * 70)
            phase += 2 * .pi * f / rate
            let env = (1 - exp(-t * 4000)) * exp(-t * 45)
            out[i] = Float(sin(phase) * env)
        }
        return out
    }

    private static func click(_ rate: Double) -> [Float] {
        let n = Int(0.04 * rate)
        var out = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let t = Double(i) / rate
            let env = (1 - exp(-t * 20000)) * exp(-t * 180)
            let s = sin(2 * .pi * 2700 * t)
                + 0.7 * sin(2 * .pi * 3800 * t + 1.3)
                + 0.5 * sin(2 * .pi * 1600 * t + 2.1)
            out[i] = Float(s * env)
        }
        return out
    }

    /// Vowel "ee" made from harmonics shaped by its three formants.
    private static func ee(_ rate: Double) -> [Float] {
        let dur = 0.45
        let f0 = 200.0
        let formants: [(f: Double, bw: Double, g: Double)] = [(270, 70, 1.0), (2290, 110, 0.55), (3010, 150, 0.35)]
        let count = Int(4500 / f0)
        var amps = [Double](repeating: 0, count: count + 1)
        for k in 1...count {
            let fk = Double(k) * f0
            amps[k] = formants.reduce(0) { $0 + $1.g / (1 + pow((fk - $1.f) / $1.bw, 2)) }
        }
        let n = Int(dur * rate)
        var out = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let t = Double(i) / rate
            let env = min(1, t / 0.02) * min(1, (dur - t) / 0.06)
            var s = 0.0
            for k in 1...count { s += amps[k] * sin(2 * .pi * Double(k) * f0 * t) }
            out[i] = Float(s * env)
        }
        return out
    }

    private static func beep(_ rate: Double) -> [Float] {
        let dur = 0.18
        let n = Int(dur * rate)
        var out = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let t = Double(i) / rate
            let env = min(1, t / 0.005) * min(1, (dur - t) / 0.005)
            out[i] = Float(sin(2 * .pi * 1000 * t) * env)
        }
        return out
    }
}
