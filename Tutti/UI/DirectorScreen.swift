import SwiftUI

struct DirectorScreen: View {
    @EnvironmentObject var router: Router
    @StateObject private var model: DirectorModel
    @Environment(\.horizontalSizeClass) private var hsize
    @State private var showSettings = false

    init(store: ProjectStore) {
        _model = StateObject(wrappedValue: DirectorModel(store: store))
    }

    var body: some View {
        GeometryReader { geo in
            let shape = ScreenShape(size: geo.size)
            ZStack {
                Theme.bg.ignoresSafeArea()
                if shape.landscape && shape.compactHeight {
                    // iPhone on its side: big picture left, controls right
                    HStack(spacing: 12) {
                        VStack(spacing: 8) {
                            topBar
                            ProgramMonitor(model: model)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                        ScrollView {
                            VStack(spacing: 10) {
                                RecordBar(model: model)
                                CameraGrid(model: model, columns: 2)
                                TransitionPicker(model: model)
                                LookAndOptions(model: model, showSettings: $showSettings)
                            }
                        }
                        .scrollIndicators(.hidden)
                        .frame(width: min(320, geo.size.width * 0.42))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                } else if shape.landscape {
                    // iPad on its side
                    HStack(spacing: 16) {
                        VStack(spacing: 12) {
                            topBar
                            ProgramMonitor(model: model)
                                .frame(maxHeight: geo.size.height * 0.56)
                            ScrollView {
                                CameraGrid(model: model, columns: max(2, min(4, model.cams.count)))
                            }
                            .scrollIndicators(.hidden)
                        }
                        SidePanel(model: model, showSettings: $showSettings)
                            .frame(width: 300)
                    }
                    .padding(16)
                } else {
                    ScrollView {
                        VStack(spacing: 14) {
                            topBar
                            ProgramMonitor(model: model)
                            RecordBar(model: model)
                            CameraGrid(model: model, columns: shape.isPad ? 3 : 2)
                            TransitionPicker(model: model)
                            LookAndOptions(model: model, showSettings: $showSettings)
                        }
                        .padding(14)
                    }
                }
                if model.phase == .collecting || isDone {
                    CollectSheet(model: model) { id in
                        model.reset()
                        router.screen = .editor(id)
                    }
                }
            }
        }
        .background(keyboardShortcuts)
        .sheet(isPresented: $showSettings) { CaptureSettingsSheet(model: model).tuttiSheetBackground() }
        .sheet(item: $model.controlled) { cam in OperatorPanel(model: model, cam: cam).tuttiSheetBackground() }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            if ProcessInfo.processInfo.arguments.contains("director") { model.addDemoCameras() } else { model.begin() }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            model.end()
        }
    }

    private var isDone: Bool {
        if case .done = model.phase { return true }
        return false
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            RoundIcon(symbol: "chevron.left", size: 38) {
                model.end()
                router.screen = .home
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("Director").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(Theme.ink)
                Text(cameraCountText).font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
            Spacer()
            if let n = model.notice {
                Text(n).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.warn).lineLimit(1)
                    .onTapGesture { model.notice = nil }
            }
        }
    }

    private var cameraCountText: String {
        let n = model.connectedCams.count
        return n == 0 ? "Waiting for cameras" : "\(n) camera\(n == 1 ? "" : "s") connected"
    }

    private var keyboardShortcuts: some View {
        ZStack {
            ForEach(1..<10) { i in
                Button("") { model.take(i) }
                    .keyboardShortcut(KeyEquivalent(Character("\(i)")), modifiers: [])
            }
            Button("") { model.isRecording ? model.stop() : model.record() }
                .keyboardShortcut(.space, modifiers: [])
        }
        .opacity(0)
        .allowsHitTesting(false)
    }
}

// MARK: - Program monitor

private struct ProgramMonitor: View {
    @ObservedObject var model: DirectorModel

    var body: some View {
        ZStack(alignment: .topLeading) {
            Rectangle().fill(Theme.stage)
            if let cam = model.cams.first(where: { $0.index == model.program }) {
                ProgramImage(cam: cam)
                    .id(cam.index)
                    .transition(transition)
            } else {
                VStack(spacing: 10) {
                    TuttiMark(size: 54).opacity(0.7)
                    Text("Open Tutti on each iPhone and tap Camera.\nThey connect here by themselves.")
                        .multilineTextAlignment(.center)
                        .font(.system(size: 15)).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack(spacing: 8) {
                Text("PROGRAM").font(.system(size: 11, weight: .heavy)).tracking(1.2)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8).frame(height: 22)
                    .background(Capsule().fill(model.isRecording ? Theme.rec : Color.black.opacity(0.55)))
                if model.cams.contains(where: { $0.index == model.program }) { CamBadge(cam: model.program) }
                if model.isRecording {
                    TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                        Text(formatClock(model.elapsed)).font(Theme.num(13)).foregroundStyle(.white)
                            .padding(.horizontal, 8).frame(height: 22)
                            .background(Capsule().fill(Color.black.opacity(0.55)))
                    }
                    Text("\(model.cutCount) cuts").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
                }
            }
            .padding(10)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(model.isRecording ? Theme.rec : Theme.line, lineWidth: model.isRecording ? 2 : 1))
        .animation(model.transition == .cut ? nil : .easeInOut(duration: model.transitionLength), value: model.program)
    }

    private var transition: AnyTransition {
        switch model.transition {
        case .cut: return .identity
        case .push: return .push(from: .trailing)
        case .wipe: return .move(edge: .leading).combined(with: .opacity)
        case .blur: return .opacity.combined(with: .scale(scale: 1.02))
        default: return .opacity
        }
    }
}

private struct ProgramImage: View {
    @ObservedObject var cam: RemoteCam
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !cam.moving)) { _ in
            FramedImage(image: cam.image, framing: cam.framing(at: Clock.now))
        }
    }
}

/// The picture as the director frames it: zoomed and positioned inside the full camera image.
struct FramedImage: View {
    let image: UIImage?
    let framing: Framing
    var body: some View {
        GeometryReader { g in
            let z = CGFloat(max(1, framing.zoom))
            let c = framing.center
            ZStack {
                Color.black
                if let image {
                    Image(uiImage: image).resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: g.size.width, height: g.size.height)
                        .scaleEffect(z)
                        .offset(x: (0.5 - c.x) * g.size.width * z, y: (0.5 - c.y) * g.size.height * z)
                }
            }
            .frame(width: g.size.width, height: g.size.height)
            .clipped()
        }
    }
}

/// Rectangle showing what the director's framing keeps of the full picture.
struct GuideRect: View {
    let framing: Framing
    var color: Color = .white
    var body: some View {
        GeometryReader { g in
            let z = CGFloat(max(1, framing.zoom))
            if z > 1.01 {
                let c = framing.center
                RoundedRectangle(cornerRadius: 3)
                    .stroke(color, style: StrokeStyle(lineWidth: 1.5, dash: [5, 3]))
                    .frame(width: g.size.width / z, height: g.size.height / z)
                    .position(x: c.x * g.size.width, y: c.y * g.size.height)
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Cameras

private struct CameraGrid: View {
    @ObservedObject var model: DirectorModel
    var columns: Int

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
            ForEach(model.cams) { cam in
                CameraTile(cam: cam, model: model)
            }
        }
    }
}

private struct CameraTile: View {
    @ObservedObject var cam: RemoteCam
    @ObservedObject var model: DirectorModel

    private var isProgram: Bool { model.program == cam.index }

    var body: some View {
        Button { model.take(cam.index) } label: {
            ZStack(alignment: .topLeading) {
                Rectangle().fill(Theme.stage)
                if let img = cam.image {
                    Image(uiImage: img).resizable().scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                GuideRect(framing: cam.target, color: Theme.cam(cam.index))
                if !cam.connected {
                    Color.black.opacity(0.6)
                    Label("Disconnected", systemImage: "wifi.slash").font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.warn).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 6) {
                        CamBadge(cam: cam.index)
                        Text(cam.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                        Spacer(minLength: 0)
                        if cam.status.locked { Image(systemName: "lock.fill").font(.system(size: 10)).foregroundStyle(.white.opacity(0.8)) }
                        battery
                        Button { model.controlled = cam } label: {
                            Image(systemName: "scope")
                                .font(.system(size: 12, weight: .bold))
                                .frame(width: 26, height: 22)
                                .foregroundStyle(.white)
                                .background(Capsule().fill(Theme.accent))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(6)
                    .background(LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom))
                    Spacer(minLength: 0)
                    HStack(spacing: 6) {
                        LevelMeter(level: cam.status.peak).frame(width: 46, height: 4)
                        if cam.status.digital { Text("digital").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.warn) }
                        Spacer(minLength: 0)
                        if cam.status.dropped > 0 { Text("\(cam.status.dropped) dropped").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.warn) }
                        if cam.status.zoom > 0 { Text(String(format: "%.1f×", cam.status.zoom)).font(Theme.num(10)).foregroundStyle(.white.opacity(0.85)) }
                    }
                    .padding(6)
                    .background(LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom))
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
                .stroke(isProgram ? Theme.rec : Theme.cam(cam.index).opacity(0.35), lineWidth: isProgram ? 3 : 1))
        }
        .buttonStyle(.plain)
        .contextMenu {
            if !cam.status.lenses.isEmpty {
                Section("Zoom") {
                    ForEach(cam.status.lenses, id: \.self) { z in
                        Button(String(format: "%g×", z)) { model.zoom(cam, to: z) }
                    }
                }
            }
            if model.phase == .ready {
                Section("Camera number") {
                    ForEach(1...max(model.cams.count, 1), id: \.self) { n in
                        Button("CAM \(n)") { model.moveCam(cam, to: n) }
                    }
                }
            }
        }
    }

    private var battery: some View {
        let b = cam.status.battery
        let symbol = b < 0 ? "battery.100" : (b > 0.75 ? "battery.100" : (b > 0.5 ? "battery.75" : (b > 0.25 ? "battery.50" : "battery.25")))
        return Image(systemName: symbol).font(.system(size: 11))
            .foregroundStyle(b >= 0 && b < 0.2 ? Theme.rec : .white.opacity(0.85))
    }
}

// MARK: - Controls

private struct RecordBar: View {
    @ObservedObject var model: DirectorModel
    var body: some View {
        Button {
            model.isRecording ? model.stop() : model.record()
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle().stroke(.white.opacity(0.9), lineWidth: 3).frame(width: 40, height: 40)
                    if model.isRecording {
                        RoundedRectangle(cornerRadius: 4).fill(Theme.rec).frame(width: 16, height: 16)
                    } else {
                        Circle().fill(Theme.rec).frame(width: 30, height: 30)
                    }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.isRecording ? "Stop" : "Record all").font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.ink)
                    if model.isRecording {
                        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                            Text(formatClock(model.elapsed)).font(Theme.num(13)).foregroundStyle(Theme.rec)
                        }
                    } else {
                        Text(model.connectedCams.isEmpty ? "No cameras yet" : "\(model.connectedCams.count) cameras start together")
                            .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
                Spacer()
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(model.isRecording ? Theme.rec.opacity(0.6) : Theme.line))
        }
        .buttonStyle(.plain)
        .disabled(model.connectedCams.isEmpty && !model.isRecording)
        .opacity(model.connectedCams.isEmpty && !model.isRecording ? 0.6 : 1)
    }
}

private struct TransitionPicker: View {
    @ObservedObject var model: DirectorModel
    var body: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle(text: "Transition when you tap a camera")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 8)], spacing: 8) {
                    ForEach(TransitionKind.allCases) { k in
                        Chip(label: k.label, symbol: k.symbol, selected: model.transition == k) { model.transition = k }
                    }
                }
                if model.transition != .cut {
                    SliderRow(title: "Length", value: $model.transitionLength, range: 0.2...2.0, format: { String(format: "%.1f s", $0) })
                }
            }
        }
    }
}

private struct LookAndOptions: View {
    @ObservedObject var model: DirectorModel
    @Binding var showSettings: Bool
    var body: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                SectionTitle(text: "Picture")
                Button { model.toggleLook() } label: {
                    HStack(spacing: 10) {
                        Image(systemName: model.lookLocked ? "lock.fill" : "lock.open")
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(model.lookLocked ? Theme.accent : Theme.sunk))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(model.lookLocked ? "Look locked on all cameras" : "Lock the look").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                            Text("Same white balance everywhere, flicker-free shutter, steady exposure and focus.")
                                .font(.system(size: 12)).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(.plain)
                ToggleRow(title: "This \(DeviceName.kind) films too", detail: "Uses its own camera as one more angle.", isOn: $model.useThisDevice)
                    .disabled(model.phase != .ready)
                Button { showSettings = true } label: {
                    HStack {
                        Image(systemName: "slider.horizontal.3")
                        Text("\(model.settings.uhd ? "4K" : "1080p") · \(model.settings.fps) fps\(model.settings.antiFlicker50 ? " · 50 Hz" : "")")
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Theme.muted)
                    }
                    .font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink)
                }
                .buttonStyle(.plain)
                .disabled(model.phase != .ready)
            }
        }
    }
}

private struct SidePanel: View {
    @ObservedObject var model: DirectorModel
    @Binding var showSettings: Bool
    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                RecordBar(model: model)
                TransitionPicker(model: model)
                LookAndOptions(model: model, showSettings: $showSettings)
                Card(padding: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        SectionTitle(text: "How it works")
                        Text("Tap a camera to put it on air — the red frame shows on that iPhone too. Every camera records its own full-quality file; when you stop, they come here and open in the editor, already cut the way you switched. Keys 1–9 and space work with a keyboard.")
                            .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

// MARK: - After recording

private struct CollectSheet: View {
    @ObservedObject var model: DirectorModel
    let open: (UUID) -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
            Card(padding: 20) {
                VStack(alignment: .leading, spacing: 14) {
                    Text(doneID == nil ? "Collecting the clips" : "All set").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(Theme.ink)
                    Text(doneID == nil ? "Each camera is sending its full-quality recording. Keep the devices close." : "The recording is ready to edit.")
                        .font(.system(size: 14)).foregroundStyle(Theme.muted)
                    ForEach(model.cams) { cam in CollectRow(cam: cam, model: model) }
                    if let id = doneID {
                        PrimaryButton(title: "Open in the editor", symbol: "film") { open(id) }
                    } else {
                        Button("Continue without the missing clips") { model.finish() }
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.accentText)
                    }
                }
            }
            .frame(maxWidth: 460)
            .padding(24)
        }
    }

    private var doneID: UUID? {
        if case .done(let id) = model.phase { return id }
        return nil
    }
}

private struct CollectRow: View {
    @ObservedObject var cam: RemoteCam
    @ObservedObject var model: DirectorModel
    var body: some View {
        HStack(spacing: 10) {
            CamBadge(cam: cam.index)
            Text(cam.name).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
            Spacer()
            if cam.received {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.good)
            } else if let f = cam.failed {
                Text(f).font(.system(size: 12)).foregroundStyle(Theme.warn).lineLimit(1)
                if cam.connected {
                    Button("Ask again") { model.askAgain(cam) }.font(.system(size: 12, weight: .semibold))
                }
            } else if let t = cam.transfer {
                ProgressView(value: t).tint(Theme.accentText).frame(width: 110)
                Text("\(Int(t * 100))%").font(Theme.num(12)).foregroundStyle(Theme.muted).frame(width: 36, alignment: .trailing)
            } else {
                ProgressView().scaleEffect(0.8)
                Text("finishing…").font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
        }
    }
}

// MARK: - Settings

private struct CaptureSettingsSheet: View {
    @ObservedObject var model: DirectorModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Resolution", selection: $model.settings.uhd) {
                        Text("4K").tag(true)
                        Text("1080p").tag(false)
                    }
                    Picker("Frame rate", selection: $model.settings.fps) {
                        ForEach([24, 25, 30, 50, 60], id: \.self) { Text("\($0) fps").tag($0) }
                    }
                } header: {
                    Text("Every camera")
                } footer: {
                    Text("4K keeps the picture sharp even when you zoom into a shot later in the editor. 25 or 50 fps suit lights on 50 Hz mains (Switzerland, Europe).")
                }
                Section {
                    Toggle("Flicker-free under 50 Hz lights", isOn: $model.settings.antiFlicker50)
                    Toggle("Stabilization (handheld)", isOn: $model.settings.stabilization)
                } footer: {
                    Text("Leave stabilization off on a tripod: the picture stays wider and sharper.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Recording")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
