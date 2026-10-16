import SwiftUI
import AVFoundation

final class PlayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

struct PlayerView: UIViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity = .resizeAspect
    func makeUIView(context: Context) -> PlayerUIView {
        let v = PlayerUIView()
        v.backgroundColor = .black
        v.playerLayer.player = player
        v.playerLayer.videoGravity = gravity
        return v
    }
    func updateUIView(_ uiView: PlayerUIView, context: Context) {
        if uiView.playerLayer.player !== player { uiView.playerLayer.player = player }
        uiView.playerLayer.videoGravity = gravity
    }
}

enum InspectorTab: String, CaseIterable, Identifiable {
    case cut, picture, sound
    var id: String { rawValue }
    var label: String {
        switch self {
        case .cut: return "Cuts"
        case .picture: return "Picture"
        case .sound: return "Sound"
        }
    }
    var symbol: String {
        switch self {
        case .cut: return "scissors"
        case .picture: return "camera.filters"
        case .sound: return "waveform"
        }
    }
}

struct EditorScreen: View {
    @EnvironmentObject var router: Router
    @StateObject private var model: EditorModel
    @State private var tab: InspectorTab = .cut
    @State private var showExport = false
    @State private var renaming = false
    @State private var newName = ""

    init(project: Project, store: ProjectStore) {
        _model = StateObject(wrappedValue: EditorModel(project: project, store: store))
    }

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width > 900
            ZStack {
                Theme.bg.ignoresSafeArea()
                if wide {
                    VStack(spacing: 12) {
                        topBar
                        HStack(alignment: .top, spacing: 14) {
                            VStack(spacing: 10) {
                                ProgramPlayer(model: model)
                                TransportBar(model: model)
                                AnglesStrip(model: model, height: 92)
                                TimelineStrip(model: model)
                                    .frame(height: 170)
                                Spacer(minLength: 0)
                            }
                            Inspector(model: model, tab: $tab)
                                .frame(width: 340)
                        }
                    }
                    .padding(14)
                } else {
                    VStack(spacing: 10) {
                        topBar
                        ProgramPlayer(model: model)
                        TransportBar(model: model)
                        AnglesStrip(model: model, height: 64)
                        TimelineStrip(model: model).frame(height: 120)
                        Inspector(model: model, tab: $tab)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 6)
                }
                if model.prepProgress != nil || !model.ready {
                    PrepOverlay(model: model) {
                        model.saveNow()
                        router.screen = .home
                    }
                }
            }
        }
        .sheet(isPresented: $showExport) { ExportSheet(model: model).tuttiSheetBackground() }
        .alert("Name", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Save") { model.project.name = newName }
            Button("Cancel", role: .cancel) {}
        }
        .onAppear {
            model.start()
            switch router.demoTab {
            case "sound": tab = .sound
            case "picture": tab = .picture
            case "export":
                DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                    showExport = true
                    model.export(ExportOptions(uhd: false, maxQuality: false))
                }
            default: break
            }
        }
        .onDisappear { model.saveNow() }
        .background(shortcuts)
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            RoundIcon(symbol: "chevron.left", size: 38) {
                model.saveNow()
                router.screen = .home
            }
            Button {
                newName = model.project.name
                renaming = true
            } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.project.name).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text("\(model.project.cams.count) cameras · \(formatClock(model.duration)) · \(model.project.fps) fps")
                        .font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
            }
            .buttonStyle(.plain)
            Spacer()
            RoundIcon(symbol: "arrow.uturn.backward", size: 38) { model.undo() }
                .disabled(!model.canUndo).opacity(model.canUndo ? 1 : 0.4)
            RoundIcon(symbol: "arrow.uturn.forward", size: 38) { model.redo() }
                .disabled(!model.canRedo).opacity(model.canRedo ? 1 : 0.4)
            Button { showExport = true } label: {
                Label("Export", systemImage: "square.and.arrow.up")
                    .font(.system(size: 15, weight: .semibold))
                    .padding(.horizontal, 14).frame(height: 38)
                    .foregroundStyle(.white)
                    .background(Capsule().fill(Theme.accent))
            }
            .buttonStyle(.plain)
            .disabled(!model.ready)
        }
    }

    private var shortcuts: some View {
        ZStack {
            Button("") { model.togglePlay() }.keyboardShortcut(.space, modifiers: [])
            Button("") { model.step(frames: -1) }.keyboardShortcut(.leftArrow, modifiers: [])
            Button("") { model.step(frames: 1) }.keyboardShortcut(.rightArrow, modifiers: [])
            Button("") { model.undo() }.keyboardShortcut("z", modifiers: .command)
            Button("") { model.redo() }.keyboardShortcut("z", modifiers: [.command, .shift])
            ForEach(1..<10) { i in
                Button("") { if model.project.cams.contains(i) { model.cut(to: i) } }
                    .keyboardShortcut(KeyEquivalent(Character("\(i)")), modifiers: [])
            }
        }
        .opacity(0)
        .allowsHitTesting(false)
    }
}

// MARK: - Player and transport

private struct ProgramPlayer: View {
    @ObservedObject var model: EditorModel
    var body: some View {
        ZStack(alignment: .topLeading) {
            PlayerView(player: model.player)
            let cam = model.project.camera(at: model.time)
            HStack(spacing: 6) {
                CamBadge(cam: cam)
                if model.playing {
                    Text("Tap an angle below to cut").font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.8))
                }
            }
            .padding(10)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line))
        .onTapGesture { model.togglePlay() }
    }
}

private struct TransportBar: View {
    @ObservedObject var model: EditorModel
    var body: some View {
        HStack(spacing: 14) {
            Text(formatTimecode(model.time, fps: model.project.fps)).font(Theme.num(15)).foregroundStyle(Theme.ink)
                .frame(minWidth: 96, alignment: .leading)
            Spacer()
            Button { model.jumpToCut(next: false) } label: { Image(systemName: "backward.end.fill") }
            Button { model.step(frames: -1) } label: { Image(systemName: "chevron.left") }
            Button { model.togglePlay() } label: {
                Image(systemName: model.playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 20, weight: .bold))
                    .frame(width: 52, height: 44)
                    .background(Capsule().fill(Theme.accent))
                    .foregroundStyle(.white)
            }
            Button { model.step(frames: 1) } label: { Image(systemName: "chevron.right") }
            Button { model.jumpToCut(next: true) } label: { Image(systemName: "forward.end.fill") }
            Spacer()
            Text(formatClock(model.duration)).font(Theme.num(13)).foregroundStyle(Theme.muted)
                .frame(minWidth: 96, alignment: .trailing)
        }
        .font(.system(size: 17, weight: .semibold))
        .foregroundStyle(Theme.ink)
        .buttonStyle(.plain)
    }
}

/// Every camera angle, playing in step. Tap one to cut to it at the playhead.
private struct AnglesStrip: View {
    @ObservedObject var model: EditorModel
    var height: CGFloat

    var body: some View {
        let current = model.project.camera(at: model.time)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(model.project.videoClips) { clip in
                    Button { model.cut(to: clip.cam) } label: {
                        ZStack(alignment: .topLeading) {
                            if let p = model.camPlayers[clip.cam] {
                                PlayerView(player: p, gravity: .resizeAspectFill)
                            } else {
                                Rectangle().fill(Theme.stage)
                            }
                            CamBadge(cam: clip.cam).padding(5)
                        }
                        .frame(width: height * 16 / 9, height: height)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(current == clip.cam ? Theme.rec : Theme.cam(clip.cam).opacity(0.4), lineWidth: current == clip.cam ? 3 : 1))
                    }
                    .buttonStyle(.plain)
                }
                if model.ready {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Image(systemName: model.transition.symbol)
                            Text(model.transition.label)
                        }
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                        Text("next cut").font(.system(size: 11)).foregroundStyle(Theme.muted)
                    }
                    .padding(.horizontal, 10)
                }
            }
        }
        .frame(height: height)
    }
}

private struct PrepOverlay: View {
    @ObservedObject var model: EditorModel
    let back: () -> Void
    var body: some View {
        ZStack(alignment: .topLeading) {
            Theme.bg.opacity(0.92).ignoresSafeArea()
            RoundIcon(symbol: "chevron.left", size: 38, action: back).padding(14)
            VStack(spacing: 16) {
                TuttiMark(size: 64)
                    .rotationEffect(.degrees((model.prepProgress ?? 0) * 360))
                    .animation(.easeInOut(duration: 0.6), value: model.prepProgress)
                Text(model.prepText.isEmpty ? "Opening…" : model.prepText).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                if let p = model.prepProgress {
                    ProgressView(value: p).tint(Theme.accentText).frame(width: 260)
                    Text("Lining up every camera by its sound and matching the pictures.")
                        .font(.system(size: 13)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                } else {
                    ProgressView()
                }
                if let err = model.problem {
                    Text(err).font(.system(size: 13)).foregroundStyle(Theme.warn)
                }
            }
            .padding(30)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
