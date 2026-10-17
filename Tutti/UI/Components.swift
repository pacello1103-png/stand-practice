import SwiftUI

/// The Tutti mark: pastel arcs around a white dot (in the style of the Arco icon).
struct TuttiMark: View {
    var size: CGFloat = 44
    var body: some View {
        ZStack {
            ForEach(0..<5, id: \.self) { i in
                Circle()
                    .trim(from: 0.02, to: 0.18)
                    .stroke(Color(hex: Theme.pastelHex[i]), style: StrokeStyle(lineWidth: size * 0.075, lineCap: .round))
                    .rotationEffect(.degrees(Double(i) * 72 - 90 - 36))
                    .padding(size * 0.12)
            }
            Circle().fill(Color.white).frame(width: size * 0.2, height: size * 0.2)
        }
        .frame(width: size, height: size)
    }
}

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct Chip: View {
    let label: String
    var symbol: String? = nil
    var selected: Bool
    var tint: Color = Theme.accent
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.system(size: 13, weight: .semibold)) }
                Text(label).font(.system(size: 14, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .foregroundStyle(selected ? Color.white : Theme.ink)
            .background(Capsule().fill(selected ? tint : Theme.sunk))
        }
        .buttonStyle(.plain)
    }
}

struct CamBadge: View {
    let cam: Int
    var large = false
    var body: some View {
        Text(large ? "CAM \(cam)" : "\(cam)")
            .font(Theme.num(large ? 15 : 12, .bold))
            .foregroundStyle(Color.black.opacity(0.82))
            .padding(.horizontal, large ? 10 : 6)
            .frame(minWidth: large ? 0 : 20, minHeight: large ? 28 : 20)
            .background(Capsule().fill(Theme.cam(cam)))
    }
}

struct LevelMeter: View {
    var level: Float          // 0...1 (peak, linear)
    var vertical = false
    var body: some View {
        GeometryReader { g in
            let db = 20 * log10(max(Double(level), 0.00001))
            let frac = CGFloat(max(0, min(1, (db + 60) / 60)))
            let color: Color = db > -1 ? Theme.rec : (db > -9 ? Theme.warn : Theme.good)
            ZStack(alignment: vertical ? .bottom : .leading) {
                RoundedRectangle(cornerRadius: 2).fill(Color.white.opacity(0.12))
                RoundedRectangle(cornerRadius: 2).fill(color)
                    .frame(width: vertical ? nil : g.size.width * frac, height: vertical ? g.size.height * frac : nil)
            }
        }
    }
}

struct PrimaryButton: View {
    let title: String
    var symbol: String? = nil
    var color: Color = Theme.accent
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let symbol { Image(systemName: symbol) }
                Text(title)
            }
            .font(.system(size: 16, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(Color.white)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(color))
        }
        .buttonStyle(.plain)
    }
}

struct RoundIcon: View {
    let symbol: String
    var size: CGFloat = 40
    var on = false
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .semibold))
                .frame(width: size, height: size)
                .foregroundStyle(on ? Color.white : Theme.ink)
                .background(Circle().fill(on ? Theme.accent : Color.black.opacity(0.35)))
        }
        .buttonStyle(.plain)
    }
}

struct SliderRow: View {
    let title: String
    @Binding var value: Double
    var range: ClosedRange<Double>
    var format: (Double) -> String = { String(format: "%.0f", $0) }
    var onEnd: (() -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
                Spacer()
                Text(format(value)).font(Theme.num(13)).foregroundStyle(Theme.muted)
            }
            Slider(value: $value, in: range, onEditingChanged: { editing in if !editing { onEnd?() } })
                .tint(Theme.accentText)
        }
    }
}

struct ToggleRow: View {
    let title: String
    var detail: String? = nil
    @Binding var isOn: Bool
    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink)
                if let detail { Text(detail).font(.system(size: 12)).foregroundStyle(Theme.muted) }
            }
        }
        .tint(Theme.accent)
    }
}

extension View {
    func tuttiSheetBackground() -> some View {
        self.presentationBackground(Theme.bg)
    }
}

/// Lays chips out in rows and wraps to the next line — nothing is ever cut off on a narrow screen.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > maxWidth {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX && x + s.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}

/// Screen shape helpers.
struct ScreenShape {
    let size: CGSize
    var landscape: Bool { size.width > size.height }
    var compactHeight: Bool { size.height < 520 }       // iPhone on its side
    var compactWidth: Bool { size.width < 600 }         // iPhone upright
    var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
}
