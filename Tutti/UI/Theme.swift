import SwiftUI

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

/// Same palette as Stand (dark theme) and the pastel arcs of the Arco / Stand icons.
enum Theme {
    static let bg = Color(hex: 0x0B0E16)
    static let stage = Color(hex: 0x05070C)
    static let surface = Color(hex: 0x161B29)
    static let sunk = Color(hex: 0x1E2435)
    static let sunk2 = Color(hex: 0x272E42)
    static let ink = Color(hex: 0xE9ECF4)
    static let muted = Color(hex: 0x959DB2)
    static let line = Color.white.opacity(0.09)
    static let accent = Color(hex: 0x2F4FB5)
    static let accentText = Color(hex: 0xA9BCFF)
    static let accentSoft = Color(hex: 0x7896FF, opacity: 0.14)
    static let rec = Color(hex: 0xFF5A5F)
    static let good = Color(hex: 0x3CC47F)
    static let warn = Color(hex: 0xF0B23A)

    /// Orange, yellow, green, blue, lilac (the icon arcs), then extra pastels for more cameras.
    static let pastelHex: [UInt32] = [0xF2A65A, 0xF2D16E, 0x96CF83, 0x85B5F2, 0xB39AF0, 0xF29AB8, 0x7FD6CF, 0xD9B48F]

    static func cam(_ n: Int) -> Color {
        Color(hex: pastelHex[(max(n, 1) - 1) % pastelHex.count])
    }

    static var rainbow: LinearGradient {
        LinearGradient(colors: pastelHex.prefix(5).map { Color(hex: $0) }, startPoint: .leading, endPoint: .trailing)
    }

    static func num(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }
}

func formatClock(_ t: Double) -> String {
    let s = max(0, t)
    let m = Int(s) / 60
    let sec = Int(s) % 60
    if m >= 60 { return String(format: "%d:%02d:%02d", m / 60, m % 60, sec) }
    return String(format: "%02d:%02d", m, sec)
}

func formatTimecode(_ t: Double, fps: Int) -> String {
    let s = max(0, t)
    let frames = Int((s - floor(s)) * Double(max(fps, 1)))
    return formatClock(s) + String(format: ".%02d", frames)
}
