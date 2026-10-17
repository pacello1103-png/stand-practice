import SwiftUI

/// Remote camera operator: tap the subject, choose how much to zoom in, glide left/right,
/// and drive the real lens zoom with a chosen speed — all from the director.
struct OperatorPanel: View {
    @ObservedObject var model: DirectorModel
    @ObservedObject var cam: RemoteCam
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var hsize
    @State private var aimPoint: CGPoint?
    @State private var lensSpeed = 1.0
    @State private var lensValue: Double = 1
    @State private var lastLensSend = 0.0

    private let zooms: [(String, Double)] = [("Centre", 1), ("+10%", 1.1), ("+25%", 1.25), ("+50%", 1.5), ("2×", 2)]
    private let speeds: [(String, Double)] = [("Instant", 0), ("Quick", 0.8), ("Smooth", 2), ("Slow", 4), ("Very slow", 8)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    picture
                    framingControls
                    lensControls
                }
                .padding(18)
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        CamBadge(cam: cam.index, large: true)
                        Text(cam.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .onAppear { lensValue = cam.status.zoom > 0 ? cam.status.zoom : 1 }
    }

    // MARK: Picture

    private var picture: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tap the subject, then choose a zoom. The dashed frame is what goes out.")
                .font(.system(size: 13)).foregroundStyle(Theme.muted)
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !cam.moving)) { _ in
                let now = cam.framing(at: Clock.now)
                let layout = hsize == .compact ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
                layout {
                    // the full camera picture: tap to aim
                    GeometryReader { g in
                        ZStack {
                            Color.black
                            if let img = cam.image { Image(uiImage: img).resizable().aspectRatio(contentMode: .fit) }
                            GuideRect(framing: now, color: Theme.cam(cam.index))
                            if let p = aimPoint {
                                Circle().stroke(Theme.warn, lineWidth: 2).frame(width: 30, height: 30)
                                    .position(x: p.x * g.size.width, y: p.y * g.size.height)
                                Circle().fill(Theme.warn).frame(width: 6, height: 6)
                                    .position(x: p.x * g.size.width, y: p.y * g.size.height)
                            }
                        }
                        .frame(width: g.size.width, height: g.size.height)
                        .clipped()
                        .contentShape(Rectangle())
                        .onTapGesture { loc in
                            aimPoint = CGPoint(x: max(0, min(1, loc.x / g.size.width)), y: max(0, min(1, loc.y / g.size.height)))
                        }
                    }
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(alignment: .topLeading) { label("Full picture") }

                    // what the director sends out
                    FramedImage(image: cam.image, framing: now)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(model.program == cam.index ? Theme.rec : Theme.line, lineWidth: 2))
                        .overlay(alignment: .topLeading) { label(String(format: "Out · %.2f×", now.zoom)) }
                        .frame(maxWidth: hsize == .compact ? .infinity : 260)
                }
            }
        }
    }

    private func label(_ s: String) -> some View {
        Text(s).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Capsule().fill(Color.black.opacity(0.55))).padding(6)
    }

    // MARK: Framing

    private var framingControls: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle(text: "Framing move")
                FlowLayout {
                    ForEach(zooms.indices, id: \.self) { i in
                        let z = zooms[i]
                        Chip(label: z.0, selected: false) {
                            let point = aimPoint ?? cam.framing(at: Clock.now).center
                            model.aim(cam, at: point, zoomBy: z.1)
                            aimPoint = nil
                        }
                    }
                }
                FlowLayout {
                    Text("Speed").font(.system(size: 13)).foregroundStyle(Theme.muted).frame(height: 34)
                    ForEach(speeds.indices, id: \.self) { i in
                        let sp = speeds[i]
                        Chip(label: sp.0, selected: abs(model.moveSpeed - sp.1) < 0.01) { model.moveSpeed = sp.1 }
                    }
                }
                HStack(spacing: 10) {
                    padButton("arrow.left") { model.pan(cam, dx: -0.06, dy: 0) }
                    VStack(spacing: 8) {
                        padButton("arrow.up") { model.pan(cam, dx: 0, dy: -0.06) }
                        padButton("arrow.down") { model.pan(cam, dx: 0, dy: 0.06) }
                    }
                    padButton("arrow.right") { model.pan(cam, dx: 0.06, dy: 0) }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 8) {
                        Button { model.frame(cam, to: Framing()) } label: {
                            Label("Back to wide", systemImage: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        Button { model.aim(cam, at: cam.framing(at: Clock.now).center, zoomBy: 1 / 1.1) } label: {
                            Label("−10%", systemImage: "minus.magnifyingglass").font(.system(size: 14, weight: .semibold))
                        }
                    }
                }
                Text("Moves are smooth and recorded with the take; the editor renders them from the full-resolution file, so record in 4K for the sharpest close-ups. You can also edit them later.")
                    .font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
        }
    }

    private func padButton(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .bold))
                .frame(width: 46, height: 42)
                .foregroundStyle(Theme.ink)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.sunk))
        }
        .buttonStyle(.plain)
    }

    // MARK: Lens

    private var lensControls: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle(text: "Lens zoom (the real camera)")
                if !cam.status.lenses.isEmpty {
                    FlowLayout {
                        ForEach(cam.status.lenses, id: \.self) { z in
                            Chip(label: String(format: "%g×", z), selected: abs(cam.status.zoom - z) < 0.05) {
                                lensValue = z
                                model.lensZoom(cam, to: z, speed: lensSpeed)
                            }
                        }
                        if cam.status.digital {
                            Text("digital").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.warn)
                        }
                    }
                }
                let lo = cam.status.lenses.min() ?? 1
                let hi = max(lo + 0.5, (cam.status.lenses.max() ?? 2) * 2)
                SliderRow(title: "Zoom", value: Binding(get: { lensValue }, set: { v in
                    lensValue = v
                    let now = Clock.now
                    if now - lastLensSend > 0.08 {
                        lastLensSend = now
                        model.lensZoom(cam, to: v, speed: lensSpeed)
                    }
                }), range: lo...hi, format: { String(format: "%.1f×", $0) }, onEnd: { model.lensZoom(cam, to: lensValue, speed: lensSpeed) })
                FlowLayout {
                    Text("Speed").font(.system(size: 13)).foregroundStyle(Theme.muted).frame(height: 34)
                    Chip(label: "Slow", selected: lensSpeed == 0.3) { lensSpeed = 0.3 }
                    Chip(label: "Medium", selected: lensSpeed == 1) { lensSpeed = 1 }
                    Chip(label: "Fast", selected: lensSpeed == 3) { lensSpeed = 3 }
                }
                Text("The lens buttons are optical — full quality. Between them the phone crops digitally.")
                    .font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
        }
    }
}
