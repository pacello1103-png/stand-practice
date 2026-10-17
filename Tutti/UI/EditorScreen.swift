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
            let shape = ScreenShape(size: geo.size)
            ZStack {
                Theme.bg.ignoresSafeArea()
                if shape.landscape && shape.compactHeight {
                    // iPhone on its side
                    HStack(alignment: .top, spacing: 10) {
                        VStack(spacing: 6) {
                            topBar(compact: true)
                            ProgramPlayer(model: model).frame(maxWidth: .infinity, maxHeight: .infinity)
                            TransportBar(model: model, compact: true)
                            TimelineStrip(model: model).frame(height: 64)
                        }
                        VStack(spacing: 6) {
                            AnglesStrip(model: model, height: 46)
                            Inspector(model: model, tab: $tab)
                        }
                        .frame(width: min(330, geo.size.width * 0.42))
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                } else if shape.landscape {
                    // iPad on its side
                    VStack(spacing: 10) {
                        topBar(compact: false)
                        HStack(alignment: .top, spacing: 14) {
                            VStack(spacing: 10) {
                                ProgramPlayer(model: model).frame(maxHeight: max(200, geo.size.height - 400))
                                TransportBar(model: model, compact: false)
                                AnglesStrip(model: model, height: 78)
                                TimelineStrip(model: model).frame(height: 140)
                                Spacer(minLength: 0)
                            }
                            Inspector(model: model, tab: $tab)
                                .frame(width: 340)
                        }
                    }
                    .padding(14)
                } else {
                    // upright: iPhone and iPad
                    let phone = shape.compactWidth
                    VStack(spacing: phone ? 8 : 10) {
                        topBar(compact: phone)
                        ProgramPlayer(model: model).frame(maxHeight: geo.size.height * (phone ? 0.34 : 0.38))
                        TransportBar(model: model, compact: phone)
                        AnglesStrip(model: model, height: phone ? 52 : 76)
                        TimelineStrip(model: model).frame(height: phone ? 86 : 130)
                        Inspector(model: model, tab: $tab)
                    }
                    .padding(.horizontal, phone ? 10 : 14)
                    .padding(.top, 4)
                }
                if !model.ready {
                    LoadingOverlay(model: model) {
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
                DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
                    showExport = true
                    model.export(ExportOptions(uhd: false, quality: .high))
                }
            default: break
            }
        }
        .onDisappear { model.saveNow() }
        .background(shortcuts)
    }

    private func topBar(compact: Bool) -> some View {
        HStack(spacing: compact ? 6 : 10) {
            RoundIcon(symbol: "chevron.left", size: compact ? 34 : 38) {
                model.saveNow()
                router.screen = .home
            }
            Button {
                newName = model.project.name
                renaming = true
            } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.project.name).font(.system(size: compact ? 15 : 17, weight: .bold, design: .rounded))
                        .foregroundStyle(Theme.ink).lineLimit(1)
                    Text("\(model.project.cams.count) cameras · \(formatClock(model.duration)) · \(model.project.outputFormat.label)")
                        .font(.system(size: 11)).foregroundStyle(Theme.muted).lineLimit(1)
                }
            }
            .buttonStyle(.plain)
            .layoutPriority(-1)
            Spacer(minLength: 4)
            RoundIcon(symbol: "arrow.uturn.backward", size: compact ? 32 : 38) { model.undo() }
                .disabled(!model.canUndo).opacity(model.canUndo ? 1 : 0.4)
            RoundIcon(symbol: "arrow.uturn.forward", size: compact ? 32 : 38) { model.redo() }
                .disabled(!model.canRedo).opacity(model.canRedo ? 1 : 0.4)
            Button { showExport = true } label: {
                Group {
                    if compact {
                        Image(systemName: "square.and.arrow.up").frame(width: 38, height: 34)
                    } else {
                        Label("Export", systemImage: "square.and.arrow.up").padding(.horizontal, 14).frame(height: 38)
                    }
                }
                .font(.system(size: 15, weight: .semibold))
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
            Button("") { model.setIn() }.keyboardShortcut("i", modifiers: [])
            Button("") { model.setOut() }.keyboardShortcut("o", modifiers: [])
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
                if let p = model.prepProgress {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.mini).tint(.white)
                        Text("\(model.prepText) \(Int(p * 100))%").lineLimit(1)
                    }
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 8).frame(height: 22)
                    .background(Capsule().fill(Color.black.opacity(0.6)))
                } else if !model.cleaning.isEmpty {
                    Text("Cleaning the sound…").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 8).frame(height: 22)
                        .background(Capsule().fill(Color.black.opacity(0.6)))
                }
            }
            .padding(8)
        }
        .aspectRatio(CGFloat(model.project.outputFormat.aspect), contentMode: .fit)
        .background(Color.black)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line))
        .frame(maxWidth: .infinity)
        .onTapGesture { model.togglePlay() }
    }
}

private struct TransportBar: View {
    @ObservedObject var model: EditorModel
    var compact: Bool
    var body: some View {
        HStack(spacing: compact ? 10 : 14) {
            Text(formatTimecode(model.time, fps: model.project.fps)).font(Theme.num(compact ? 13 : 15)).foregroundStyle(Theme.ink)
                .fixedSize()
            Spacer(minLength: 0)
            Button { model.jumpToCut(next: false) } label: { Image(systemName: "backward.end.fill") }
            Button { model.step(frames: -1) } label: { Image(systemName: "chevron.left") }
            Button { model.togglePlay() } label: {
                Image(systemName: model.playing ? "pause.fill" : "play.fill")
                    .font(.system(size: compact ? 17 : 20, weight: .bold))
                    .frame(width: compact ? 46 : 52, height: compact ? 38 : 44)
                    .background(Capsule().fill(Theme.accent))
                    .foregroundStyle(.white)
            }
            Button { model.step(frames: 1) } label: { Image(systemName: "chevron.right") }
            Button { model.jumpToCut(next: true) } label: { Image(systemName: "forward.end.fill") }
            Spacer(minLength: 0)
            Text(formatClock(model.project.end - model.project.start)).font(Theme.num(compact ? 12 : 13)).foregroundStyle(Theme.muted)
                .fixedSize()
        }
        .font(.system(size: compact ? 15 : 17, weight: .semibold))
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
                            Rectangle().fill(Color.black)
                            if let p = model.camPlayers[clip.cam] {
                                PlayerView(player: p, gravity: .resizeAspect)
                            } else if let still = model.stills[clip.cam] {
                                Image(uiImage: still).resizable().scaledToFit()
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                            CamBadge(cam: clip.cam).padding(4)
                        }
                        .frame(width: height * 16 / 9, height: height)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(current == clip.cam ? Theme.rec : Theme.cam(clip.cam).opacity(0.4), lineWidth: current == clip.cam ? 3 : 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(height: height)
    }
}

private struct LoadingOverlay: View {
    @ObservedObject var model: EditorModel
    let back: () -> Void
    var body: some View {
        ZStack(alignment: .topLeading) {
            Theme.bg.opacity(0.94).ignoresSafeArea()
            RoundIcon(symbol: "chevron.left", size: 38, action: back).padding(14)
            VStack(spacing: 14) {
                TuttiMark(size: 56)
                Text("Opening…").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                ProgressView()
                if let err = model.problem {
                    Text(err).font(.system(size: 13)).foregroundStyle(Theme.warn).multilineTextAlignment(.center)
                }
            }
            .padding(30)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
