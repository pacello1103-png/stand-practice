import SwiftUI

enum Theme {
    static let bg = Color(red: 0.055, green: 0.055, blue: 0.075)
    static let card = Color(red: 0.10, green: 0.10, blue: 0.13)
    static let line = Color.white.opacity(0.08)
    static let text = Color.white
    static let muted = Color.white.opacity(0.55)
    static let lilac = Color(red: 0.78, green: 0.72, blue: 1.0)
    static let mint = Color(red: 0.62, green: 0.92, blue: 0.82)
    static let peach = Color(red: 1.0, green: 0.78, blue: 0.66)
    static let sky = Color(red: 0.64, green: 0.82, blue: 1.0)

    static let ring = AngularGradient(colors: [lilac, sky, mint, peach, lilac], center: .center)
}
