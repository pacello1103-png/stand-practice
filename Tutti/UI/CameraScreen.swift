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
    @State private var showMic = false

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
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

                // the recorded picture (the preview shows all of it) with the director's guide and the tally
                Color.clear
                    .aspectRatio(landscape ? 16.0 / 9 : 9.0 / 16, contentMode: .fit)
                    .overlay {
                        GuideRect(framing: model.guide, color: Theme.cam(max(1, model.cam)))
                            .animation(.easeInOut(duration: max(0.15, model.guideDuration)), value: model.guide)
                    }
                    .overlay {
                        if model.onAir { Rectangle().stroke(Theme.rec, lineWidth: 6) }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)

                if let p = focusPoint {
                    RoundedRectangle(cornerRadius: 6).stroke(Theme.warn, lineWidth: 1.5)
                        .frame(width: 74, height: 74)
                        .position(p)
                        .allowsHitTesting(false)
                }

                VStack(spacing: 10) {
                    topBar
                    if engine.isRecording, let since = model.recordingSince {
                        HStack(spacing: 6) {
                            Circle().fill(Theme.rec).frame(width: 9, height: 9)
                            Text(formatClock(now.timeIntervalSince1970 - since)).font(Theme.num(15)).foregroundStyle(.white)
                        }
                        .padding(.horizontal, 12).frame(height: 30)
                        .background(Capsule().fill(Color.black.opacity(0.55)))
                    } else if !landscape && model.director != nil {
                        Label("Turn sideways to film 16:9", systemImage: "rotate.right")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 12).frame(height: 28)
                            .background(Capsule().fill(Color.black.opacity(0.5)))
                    }
                    Spacer(minLength: 0)
                    if let msg = model.message ?? engine.problem {
                        Text(msg).font(.system(size: 13, weight: .medium)).foregroundStyle(.white)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(Capsule().fill(Color.black.opacity(0.6)))
                    }
                    if let p = model.sendProgress {
                        VStack(spacing: 6) {
                            Text("Sending to the director… \(Int(p * 100))%").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                            ProgressView(value: p).tint(Theme.accentText).frame(width: 220)
                        }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 14).fill(Color.black.opacity(0.6)))
                    }
                    lensRow
                    bottomBar
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)

                if model.dimmed { dimView }
            }
        }
        .sheet(isPresented: $showMic) { MicSheet(engine: engine).presentationDetents([.height(260)]).tuttiSheetBackground() }
    }

    private var topBar: some View {
        HStack(spacing: 8) {
            RoundIcon(symbol: "xmark", size: 36, action: exit)
            HStack(spacing: 7) {
                Circle().fill(model.director == nil ? Theme.warn : Theme.good).frame(width: 8, height: 8)
                Text(model.director?.displayName ?? "Looking for the director…")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                if model.director != nil, model.syncMs >= 0, model.syncMs.isFinite {
                    Text(String(format: "±%.0f ms", max(1, model.syncMs))).font(Theme.num(11)).foregroundStyle(.white.opacity(0.65))
                        .fixedSize()
                }
            }
            .padding(.horizontal, 12).frame(height: 32)
            .background(Capsule().fill(Color.black.opacity(0.55)))
            .layoutPriority(-1)
            Spacer(minLength: 4)
            if model.onAir {
                Text("ON AIR").font(.system(size: 11, weight: .heavy)).tracking(1)
                    .foregroundStyle(.white).padding(.horizontal, 9).frame(height: 26)
                    .background(Capsule().fill(Theme.rec))
                    .fixedSize()
            }
            if model.cam > 0 { CamBadge(cam: model.cam, large: true).fixedSize() }
        }
    }

    private var lensRow: some View {
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
                Text(String(format: "%.1f×", engine.zoomDisplay))
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.black)
                    .padding(.horizontal, 10).frame(height: 26)
                    .background(Capsule().fill(Theme.warn))
            }
        }
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            Button { showMic = true } label: {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill").font(.system(size: 13))
                    LevelMeter(level: engine.peak).frame(width: 70, height: 5)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 12).frame(height: 36)
                .background(Capsule().fill(Color.black.opacity(0.55)))
            }
            .buttonStyle(.plain)
            if engine.locked {
                Image(systemName: "lock.fill").font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
                    .frame(width: 36, height: 36).background(Circle().fill(Color.black.opacity(0.55)))
            }
            Spacer(minLength: 0)
            RoundIcon(symbol: "moon.fill", size: 36) { withAnimation { model.dimmed = true } }
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

private struct MicSheet: View {
    @ObservedObject var engine: CameraEngine
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: "mic.fill").foregroundStyle(Theme.accentText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(engine.audioName).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text(engine.stereo ? "Stereo" : "Mono").font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
            }
            LevelMeter(level: engine.peak).frame(height: 8)
            if engine.inputGainSettable {
                SliderRow(title: "Input level", value: Binding(get: { Double(engine.inputGain) }, set: { engine.setInputGain(Float($0)) }),
                          range: 0...1, format: { "\(Int($0 * 100))%" })
            }
            Text("Keep the loudest moments out of the red. A microphone plugged into this device is used automatically.")
                .font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
        .padding(20)
    }
}
