import SwiftUI
import AVFoundation

final class PreviewUIView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

struct CameraPreview: UIViewRepresentable {
    let engine: CameraEngine
    var onTap: ((CGPoint) -> Void)?

    func makeUIView(context: Context) -> PreviewUIView {
        let v = PreviewUIView()
        v.backgroundColor = .black
        v.previewLayer.session = engine.session
        v.previewLayer.videoGravity = .resizeAspect
        engine.attach(previewLayer: v.previewLayer)
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        v.addGestureRecognizer(tap)
        context.coordinator.view = v
        return v
    }

    func updateUIView(_ uiView: PreviewUIView, context: Context) {
        context.coordinator.onTap = onTap
    }

    func makeCoordinator() -> Coordinator { Coordinator(engine: engine) }

    final class Coordinator: NSObject {
        let engine: CameraEngine
        weak var view: PreviewUIView?
        var onTap: ((CGPoint) -> Void)?
        init(engine: CameraEngine) { self.engine = engine }
        @objc func tapped(_ g: UITapGestureRecognizer) {
            guard let v = view else { return }
            let p = g.location(in: v)
            let device = v.previewLayer.captureDevicePointConverted(fromLayerPoint: p)
            engine.focus(at: device)
            onTap?(p)
        }
    }
}

struct CameraScreen: View {
    @EnvironmentObject var router: Router
    @StateObject private var model = CameraModel()
    @State private var focusPoint: CGPoint?
    @State private var pinchStart: Double?
    @State private var now = Date()
    private let clock = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

    var body: some View {
        CameraContent(model: model, engine: model.engine, focusPoint: $focusPoint, pinchStart: $pinchStart, now: now) {
            model.end()
            router.screen = .home
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            model.begin()
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            model.end()
        }
        .onReceive(clock) { now = $0 }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
    }
}

private struct CameraContent: View {
    @ObservedObject var model: CameraModel
    @ObservedObject var engine: CameraEngine
    @Binding var focusPoint: CGPoint?
    @Binding var pinchStart: Double?
    let now: Date
    let exit: () -> Void

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraPreview(engine: engine) { p in
                withAnimation(.easeOut(duration: 0.2)) { focusPoint = p }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { withAnimation { focusPoint = nil } }
            }
            .ignoresSafeArea()
            .gesture(MagnificationGesture()
                .onChanged { v in
                    if pinchStart == nil { pinchStart = engine.zoomDisplay }
                    let r = engine.zoomRange
                    engine.setZoom(display: max(r.lowerBound, min(r.upperBound, (pinchStart ?? 1) * Double(v))), ramp: false)
                }
                .onEnded { _ in pinchStart = nil })

            // the director's framing, as a guide for whoever holds the phone
            GeometryReader { g in
                GuideRect(framing: model.guide, color: Theme.cam(max(1, model.cam)))
                    .aspectRatio(g.size.width >= g.size.height ? 16 / 9 : 9 / 16, contentMode: .fit)
                    .frame(width: g.size.width, height: g.size.height)
            }
            .ignoresSafeArea()
            .animation(.easeInOut(duration: max(0.15, model.guideDuration)), value: model.guide)
            .allowsHitTesting(false)

            if let p = focusPoint {
                RoundedRectangle(cornerRadius: 6).stroke(Theme.warn, lineWidth: 1.5)
                    .frame(width: 74, height: 74)
                    .position(p)
                    .allowsHitTesting(false)
            }

            // tally light: red frame when this camera is on air
            if model.onAir {
                RoundedRectangle(cornerRadius: 0).stroke(Theme.rec, lineWidth: 8).ignoresSafeArea().allowsHitTesting(false)
            }

            VStack(spacing: 0) {
                topBar
                Spacer()
                if let msg = model.message ?? engine.problem {
                    Text(msg).font(.system(size: 14, weight: .medium)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Capsule().fill(Color.black.opacity(0.6)))
                        .padding(.bottom, 10)
                }
                if let p = model.sendProgress {
                    VStack(spacing: 6) {
                        Text("Sending to the director… \(Int(p * 100))%").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                        ProgressView(value: p).tint(Theme.accentText).frame(width: 240)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 14).fill(Color.black.opacity(0.6)))
                    .padding(.bottom, 10)
                }
                bottomBar
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            if model.dimmed {
                dimView
            }
        }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            RoundIcon(symbol: "xmark", size: 38, action: exit)
            connection
            Spacer()
            if engine.isRecording, let since = model.recordingSince {
                HStack(spacing: 6) {
                    Circle().fill(Theme.rec).frame(width: 9, height: 9)
                    Text(formatClock(now.timeIntervalSince1970 - since)).font(Theme.num(15)).foregroundStyle(.white)
                }
                .padding(.horizontal, 12).frame(height: 32)
                .background(Capsule().fill(Color.black.opacity(0.55)))
            }
            Spacer()
            if model.onAir {
                Text("ON AIR").font(.system(size: 12, weight: .heavy)).tracking(1)
                    .foregroundStyle(.white).padding(.horizontal, 10).frame(height: 28)
                    .background(Capsule().fill(Theme.rec))
            }
            if model.cam > 0 { CamBadge(cam: model.cam, large: true) }
            RoundIcon(symbol: "moon.fill", size: 38) { withAnimation { model.dimmed = true } }
        }
    }

    private var connection: some View {
        HStack(spacing: 7) {
            Circle().fill(model.director == nil ? Theme.warn : Theme.good).frame(width: 8, height: 8)
            if let d = model.director {
                Text(d.displayName).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                if model.syncMs >= 0 && model.syncMs.isFinite {
                    Text(String(format: "±%.0f ms", max(1, model.syncMs))).font(Theme.num(12)).foregroundStyle(.white.opacity(0.7))
                }
            } else {
                Text("Looking for the director…").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 12).frame(height: 32)
        .background(Capsule().fill(Color.black.opacity(0.55)))
    }

    private var bottomBar: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                ForEach(engine.lenses) { lens in
                    let on = abs(engine.zoomDisplay - lens.display) < 0.05
                    Button { engine.setZoom(display: lens.display) } label: {
                        Text(on ? lens.label + "×" : lens.label)
                            .font(Theme.num(on ? 14 : 12, .bold))
                            .foregroundStyle(on ? Theme.warn : .white)
                            .frame(width: on ? 44 : 36, height: on ? 44 : 36)
                            .background(Circle().fill(Color.black.opacity(0.55)))
                    }
                    .buttonStyle(.plain)
                }
                if engine.isDigitalZoom {
                    Text(String(format: "%.1f× digital", engine.zoomDisplay))
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.black)
                        .padding(.horizontal, 10).frame(height: 26)
                        .background(Capsule().fill(Theme.warn))
                }
            }
            HStack(spacing: 10) {
                Image(systemName: "mic.fill").foregroundStyle(.white.opacity(0.8)).font(.system(size: 13))
                Text(engine.audioName + (engine.stereo ? " · stereo" : "")).font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.85)).lineLimit(1)
                LevelMeter(level: engine.peak).frame(width: 120, height: 6)
                if engine.inputGainSettable {
                    Slider(value: Binding(get: { Double(engine.inputGain) }, set: { engine.setInputGain(Float($0)) }), in: 0...1)
                        .frame(width: 110).tint(Theme.accentText)
                }
                Spacer()
                if engine.locked {
                    Label("Look locked", systemImage: "lock.fill").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
                }
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(Capsule().fill(Color.black.opacity(0.5)))
        }
    }

    private var dimView: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 10) {
                if model.cam > 0 { CamBadge(cam: model.cam, large: true) }
                if engine.isRecording, let since = model.recordingSince {
                    HStack(spacing: 6) {
                        Circle().fill(Theme.rec).frame(width: 8, height: 8)
                        Text(formatClock(now.timeIntervalSince1970 - since)).font(Theme.num(16)).foregroundStyle(.white.opacity(0.6))
                    }
                } else {
                    Text(model.director == nil ? "Waiting for the director" : "Ready").font(.system(size: 14)).foregroundStyle(.white.opacity(0.45))
                }
                Text("Tap to wake").font(.system(size: 12)).foregroundStyle(.white.opacity(0.3))
            }
        }
        .onTapGesture { withAnimation { model.dimmed = false } }
    }
}
