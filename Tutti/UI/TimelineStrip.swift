import SwiftUI

/// The program as coloured blocks (one colour per camera), transitions between them,
/// the main microphone's waveform and the playhead. Drag to scrub, drag a cut marker to move it,
/// pinch to zoom in time.
struct TimelineStrip: View {
    @ObservedObject var model: EditorModel
    @State private var zoom: CGFloat = 1          // 1 = whole recording fits
    @State private var pinchBase: CGFloat?
    @State private var leftTime: Double = 0       // time at the left edge
    @State private var mode: Mode = .idle
    @State private var downAt: CGPoint = .zero

    private enum Mode: Equatable { case idle, scrub, move(UUID) }

    var body: some View {
        GeometryReader { g in
            let width = g.size.width
            let dur = max(0.5, model.duration)
            let scale = width / CGFloat(dur) * zoom          // points per second
            let maxLeft = max(0, dur - Double(width / scale))
            let left = min(max(0, leftTime), maxLeft)

            Canvas { ctx, size in
                draw(ctx, size: size, scale: scale, left: left)
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        if mode == .idle {
                            downAt = v.startLocation
                            if let id = cutNear(x: v.startLocation.x, y: v.startLocation.y, scale: scale, left: left, height: g.size.height) {
                                mode = .move(id)
                                model.selectedCut = id
                            } else {
                                mode = .scrub
                            }
                        }
                        let t = left + Double(v.location.x / scale)
                        switch mode {
                        case .move(let id): model.moveCut(id, to: t, done: false)
                        default: model.seek(to: t)
                        }
                    }
                    .onEnded { v in
                        let t = left + Double(v.location.x / scale)
                        if case .move(let id) = mode { model.moveCut(id, to: t, done: true) }
                        else if hypot(v.location.x - downAt.x, v.location.y - downAt.y) < 6 {
                            // a tap on a block selects the cut that starts it
                            let laneTop: CGFloat = 22
                            let laneH = (g.size.height - laneTop - 8) * 0.48
                            if v.location.y > laneTop && v.location.y < laneTop + laneH {
                                let sorted = model.project.cuts.sorted { $0.time < $1.time }
                                model.selectedCut = sorted.last { $0.time <= t }?.id
                            }
                        }
                        mode = .idle
                    }
            )
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { m in
                        if pinchBase == nil { pinchBase = zoom }
                        let newZoom = max(1, min(400, (pinchBase ?? 1) * m))
                        // keep the playhead where it is on screen
                        let px = CGFloat(model.time - left) * scale
                        let newScale = width / CGFloat(dur) * newZoom
                        leftTime = model.time - Double(px / newScale)
                        zoom = newZoom
                    }
                    .onEnded { _ in pinchBase = nil }
            )
            .onChange(of: model.time) { _, t in
                // follow the playhead
                let visible = Double(width / scale)
                if t < left || t > left + visible * 0.92 {
                    leftTime = max(0, min(maxLeft, t - visible * 0.1))
                }
            }
        }
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func cutNear(x: CGFloat, y: CGFloat, scale: CGFloat, left: Double, height: CGFloat) -> UUID? {
        let laneTop: CGFloat = 22
        let laneH = (height - laneTop - 8) * 0.48
        guard y > 10, y < laneTop + laneH + 6 else { return nil }
        var best: (UUID, CGFloat)?
        for c in model.project.cuts where c.time > 0.001 {
            let cx = CGFloat(c.time - left) * scale
            let d = abs(cx - x)
            if d < 16, d < (best?.1 ?? .infinity) { best = (c.id, d) }
        }
        return best?.0
    }

    private func draw(_ ctx: GraphicsContext, size: CGSize, scale: CGFloat, left: Double) {
        let p = model.project
        let dur = max(0.5, model.duration)
        let x: (Double) -> CGFloat = { CGFloat($0 - left) * scale }
        let rulerH: CGFloat = 18
        let laneTop: CGFloat = 22
        let laneH = (size.height - laneTop - 8) * 0.48
        let waveTop = laneTop + laneH + 6
        let waveH = size.height - waveTop - 2

        // ruler
        let steps: [Double] = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
        let step = steps.first { CGFloat($0) * scale >= 64 } ?? 600
        var t = (left / step).rounded(.down) * step
        while x(t) < size.width {
            let px = x(t)
            if px >= 0 {
                ctx.fill(Path(CGRect(x: px, y: rulerH - 6, width: 1, height: 6)), with: .color(Theme.muted.opacity(0.6)))
                ctx.draw(Text(formatClock(t)).font(Theme.num(10, .medium)).foregroundColor(Theme.muted),
                         at: CGPoint(x: px + 3, y: 2), anchor: .topLeading)
            }
            t += step
        }

        // program blocks
        var cuts = p.cuts.sorted { $0.time < $1.time }
        if cuts.isEmpty, let first = p.cams.first { cuts = [Cut(time: 0, cam: first)] }
        for (i, c) in cuts.enumerated() {
            let s = c.time
            let e = i + 1 < cuts.count ? cuts[i + 1].time : dur
            let r = CGRect(x: x(s), y: laneTop, width: max(1, x(e) - x(s)), height: laneH)
            guard r.maxX >= 0, r.minX <= size.width else { continue }
            let block = Path(roundedRect: r.insetBy(dx: 0.5, dy: 0), cornerRadius: 6)
            ctx.fill(block, with: .color(Theme.cam(c.cam).opacity(0.82)))
            if c.id == model.selectedCut {
                ctx.stroke(block, with: .color(.white), lineWidth: 2)
            }
            if r.width > 46 {
                let inset: CGFloat = (i > 0 && c.kind != .cut && c.length > 0) ? max(20, CGFloat(c.length) * scale + 6) : 8
                ctx.draw(Text("CAM \(c.cam)").font(Theme.num(11, .bold)).foregroundColor(Color.black.opacity(0.75)),
                         at: CGPoint(x: max(r.minX, 0) + inset, y: r.midY), anchor: .leading)
            }
            // transition: a soft ramp from the previous camera's colour
            if i > 0, c.kind != .cut, c.length > 0 {
                let prev = cuts[i - 1].cam
                let tr = CGRect(x: x(s), y: laneTop, width: max(2, CGFloat(c.length) * scale), height: laneH)
                ctx.fill(Path(tr), with: .linearGradient(Gradient(colors: [Theme.cam(prev).opacity(0.9), Theme.cam(c.cam).opacity(0.0)]),
                                                         startPoint: CGPoint(x: tr.minX, y: tr.midY), endPoint: CGPoint(x: tr.maxX, y: tr.midY)))
                if tr.width > 18 {
                    ctx.draw(Image(systemName: c.kind.symbol), in: CGRect(x: tr.minX + 3, y: laneTop + 3, width: 12, height: 12))
                }
            }
            // handle to drag the cut
            if i > 0 {
                let hx = x(s)
                var tri = Path()
                tri.move(to: CGPoint(x: hx - 6, y: laneTop - 4))
                tri.addLine(to: CGPoint(x: hx + 6, y: laneTop - 4))
                tri.addLine(to: CGPoint(x: hx, y: laneTop + 4))
                tri.closeSubpath()
                ctx.fill(tri, with: .color(c.id == model.selectedCut ? .white : Theme.ink.opacity(0.7)))
            }
        }

        // waveform of the main microphone
        let mainCam = p.sound.mics.first { $0.role == .main }?.cam ?? p.audioClips.first?.cam
        if let cam = mainCam, let peaks = model.peaks[cam], let clip = p.clip(cam: cam), !peaks.isEmpty, waveH > 6 {
            let mid = waveTop + waveH / 2
            var path = Path()
            let origin = clip.start + clip.audioShift
            let cols = Int(size.width / 2)
            for col in 0..<max(1, cols) {
                let px = CGFloat(col) * 2
                let t0 = left + Double(px / scale) - origin
                let t1 = left + Double((px + 2) / scale) - origin
                let a = Int(t0 * 100), b = max(a + 1, Int(t1 * 100))
                guard b > 0, a < peaks.count else { continue }
                var m: Float = 0
                for k in max(0, a)..<min(peaks.count, b) { m = max(m, peaks[k]) }
                let hgt = CGFloat(min(1, sqrt(m))) * waveH / 2
                path.addRect(CGRect(x: px, y: mid - hgt, width: 1.4, height: max(0.5, hgt * 2)))
            }
            ctx.fill(path, with: .color(Theme.accentText.opacity(0.75)))
        }

        // outside the film's start / end: dimmed
        if p.isTrimmed {
            let shade = Color.black.opacity(0.55)
            let a = x(p.start), b = x(p.end)
            if a > 0 { ctx.fill(Path(CGRect(x: 0, y: laneTop - 4, width: min(a, size.width), height: size.height - laneTop + 4)), with: .color(shade)) }
            if b < size.width { ctx.fill(Path(CGRect(x: max(0, b), y: laneTop - 4, width: size.width - max(0, b), height: size.height - laneTop + 4)), with: .color(shade)) }
            for edge in [a, b] where edge >= 0 && edge <= size.width {
                ctx.fill(Path(CGRect(x: edge - 1.5, y: laneTop - 4, width: 3, height: size.height - laneTop + 4)), with: .color(Theme.warn))
            }
        }

        // playhead
        let ph = x(model.time)
        if ph >= -2 && ph <= size.width + 2 {
            ctx.fill(Path(CGRect(x: ph - 1, y: 0, width: 2, height: size.height)), with: .color(Theme.rec))
            var cap = Path()
            cap.addEllipse(in: CGRect(x: ph - 5, y: 0, width: 10, height: 10))
            ctx.fill(cap, with: .color(Theme.rec))
        }
    }
}
