import AVFoundation
import SwiftUI
import UIKit

/// Plays the program, every camera angle and the live sound mix in step, and holds the edit.
/// Opens at once: lining up the sound, measuring the picture and making proxies run in the background.
final class EditorModel: ObservableObject {
    let store: ProjectStore
    @Published var project: Project { didSet { if project != oldValue { scheduleSave() } } }
    @Published private(set) var time: Double = 0
    @Published private(set) var playing = false
    @Published private(set) var ready = false
    @Published private(set) var prepProgress: Double?
    @Published private(set) var prepText = ""
    @Published private(set) var cleaning: Set<Int> = []
    @Published var selectedCut: UUID?
    @Published var transition: TransitionKind = .dissolve
    @Published var transitionLength = 0.8
    @Published private(set) var peaks: [Int: [Float]] = [:]
    @Published private(set) var stills: [Int: UIImage] = [:]
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false
    @Published private(set) var problem: String?

    // export
    @Published var exportProgress: Double?
    @Published var exportText = ""
    @Published var exportedURL: URL?
    @Published var exportError: String?

    let player = AVPlayer()
    @Published private(set) var camPlayers: [Int: AVPlayer] = [:]
    private var timeline: Timeline?
    private var mix: MixEngine?
    private var timeObserver: Any?
    private var undoStack: [[Cut]] = []
    private var redoStack: [[Cut]] = []
    private var saveItem: DispatchWorkItem?
    private var measureTask: Task<Void, Never>?
    private var cleanTasks: [Int: Task<Void, Never>] = [:]
    private var seeking = false
    private var pendingSeek: Double?

    var duration: Double { timeline?.duration ?? project.duration }

    /// The preview is rendered a little smaller than the film, for smooth playback.
    var previewSize: CGSize {
        let long: CGFloat = UIDevice.current.userInterfaceIdiom == .pad ? 1920 : 1280
        let a = CGFloat(project.outputFormat.aspect)
        let w = a >= 1 ? long : (long * a).rounded()
        let h = a >= 1 ? (long / a).rounded() : long
        return CGSize(width: Int(w) / 2 * 2, height: Int(h) / 2 * 2)
    }

    init(project: Project, store: ProjectStore) {
        self.project = project
        self.store = store
        player.automaticallyWaitsToMinimizeStalling = false
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        mix?.shutdown()
        cleanTasks.values.forEach { $0.cancel() }
    }

    // MARK: - Opening

    func start() {
        guard !ready, timeline == nil else { return }
        Task { @MainActor in
            await load()
            if !project.prepared { prepare() } else { makeProxies() }
        }
    }

    private func prepare() {
        prepProgress = 0
        prepText = "Lining up the cameras…"
        let p = project
        let store = self.store
        Task.detached(priority: .userInitiated) {
            let done = await Preparer.run(p, store: store) { f, text in
                DispatchQueue.main.async { self.prepProgress = f; self.prepText = text }
            }
            await MainActor.run { self.merge(prepared: done) }
            await store.makeThumbnail(done)
            await MainActor.run {
                self.prepProgress = nil
                self.makeProxies()
            }
            await self.load()
        }
    }

    /// Takes what preparing found, keeping anything changed while it ran.
    @MainActor
    private func merge(prepared done: Project) {
        var p = project
        for i in p.clips.indices {
            guard let d = done.clips.first(where: { $0.id == p.clips[i].id }) else { continue }
            let mine = p.clips[i]
            var c = d
            c.look = mine.look
            c.framing = mine.framing
            c.fit = mine.fit
            c.moves = mine.moves ?? d.moves
            p.clips[i] = c
        }
        if p.sound.mics.isEmpty { p.sound.mics = done.sound.mics }
        p.picture.reference = done.picture.reference
        if p.cuts.isEmpty { p.cuts = done.cuts }
        p.prepared = true
        project = p
        store.save(p)
    }

    @MainActor
    func load() async {
        let wasPlaying = playing
        if wasPlaying { pause() }
        do {
            let tl = try await Timeline.build(project: project, store: store)
            if !project.prepared || project.audioClips.isEmpty { await tl.addRawAudio(project: project, store: store) }
            timeline = tl
            let item = AVPlayerItem(asset: tl.composition)
            item.videoComposition = tl.videoComposition(project: project, size: previewSize, final: false)
            player.replaceCurrentItem(with: item)
            player.isMuted = tl.audioTrack == nil ? true : false
            rebuildMix()
            refreshAngles()
            var pk: [Int: [Float]] = [:]
            for c in project.clips { if let f = c.peaksFile { pk[c.cam] = AudioPrep.loadPeaks(store.url(project, f)) } }
            peaks = pk
            if timeObserver == nil {
                timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] t in
                    self?.tick(t.seconds)
                }
            }
            ready = true
            seek(to: time)
            if project.prepared && project.mixGain == nil { remeasure(after: 0.5) }
            loadStills()
        } catch {
            problem = error.localizedDescription
        }
    }

    /// The mixer plays the prepared sound; until then the program plays the main camera's own sound.
    private func rebuildMix() {
        mix?.shutdown()
        mix = nil
        guard project.prepared, !project.audioClips.isEmpty, timeline?.audioTrack == nil else { return }
        mix = try? MixEngine(project: project, store: store)
        mix?.apply(project.sound, gainDB: project.mixGain ?? 4)
    }

    /// Angle previews play the small proxies (smooth even with many 4K cameras).
    private func refreshAngles() {
        var players: [Int: AVPlayer] = [:]
        for c in project.videoClips {
            guard let proxy = c.proxyFile, FileManager.default.fileExists(atPath: store.url(project, proxy).path) else { continue }
            if let existing = camPlayers[c.cam] { players[c.cam] = existing; continue }
            let p = AVPlayer(url: store.url(project, proxy))
            p.isMuted = true
            p.automaticallyWaitsToMinimizeStalling = false
            players[c.cam] = p
        }
        camPlayers = players
    }

    private func makeProxies() {
        let p = project
        let store = self.store
        Task.detached(priority: .utility) {
            await Proxies.make(project: p, store: store) { cam, name in
                DispatchQueue.main.async {
                    self.setClipQuietly(cam: cam) { $0.proxyFile = name }
                    self.refreshAngles()
                    if let c = self.project.clip(cam: cam), let player = self.camPlayers[cam] {
                        player.seek(to: CMTime(seconds: max(0, self.time - c.start), preferredTimescale: 600))
                    }
                }
            }
        }
    }

    private func loadStills() {
        let p = project
        let store = self.store
        Task.detached(priority: .utility) {
            var out: [Int: UIImage] = [:]
            for c in p.videoClips {
                guard let f = c.file else { continue }
                let gen = AVAssetImageGenerator(asset: AVURLAsset(url: store.url(p, f)))
                gen.appliesPreferredTrackTransform = true
                gen.maximumSize = CGSize(width: 480, height: 480)
                let t = CMTime(seconds: min(1.5, c.duration / 2), preferredTimescale: 600)
                if let img = try? await gen.image(at: t).image { out[c.cam] = UIImage(cgImage: img) }
            }
            await MainActor.run { self.stills = out }
        }
    }

    // MARK: - Transport

    func togglePlay() { playing ? pause() : play() }

    func play() {
        guard ready, player.currentItem != nil else { return }
        var t = time
        if t >= project.end - 0.05 || t < project.start - 0.01 { t = project.start }
        time = t
        let host = Clock.now + 0.15
        let hostCM = Clock.cmTime(host)
        Self.start(player, at: Timeline.time(t), hostTime: hostCM)
        for (cam, p) in camPlayers { startCam(cam, p, at: t, hostTime: hostCM) }
        mix?.play(from: t, hostTime: Clock.hostTime(host))
        playing = true
    }

    private func startCam(_ cam: Int, _ p: AVPlayer, at t: Double, hostTime: CMTime) {
        guard let c = project.clip(cam: cam) else { return }
        let local = t - c.start
        if local >= 0 && local < c.duration {
            Self.start(p, at: CMTime(seconds: local, preferredTimescale: 60_000), hostTime: hostTime)
        } else {
            p.pause()
            p.seek(to: .zero)
        }
    }

    /// Starts a player at an exact moment, so picture and sound stay locked together.
    private static func start(_ p: AVPlayer, at time: CMTime, hostTime: CMTime) {
        if p.currentItem?.status == .readyToPlay {
            p.setRate(1, time: time, atHostTime: hostTime)
        } else {
            p.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
            p.play()
        }
    }

    func pause() {
        player.pause()
        camPlayers.values.forEach { $0.pause() }
        mix?.pause()
        playing = false
        time = player.currentTime().seconds
    }

    private func tick(_ t: Double) {
        guard playing else { return }
        time = t
        if t >= min(duration, project.end) - 0.03 { pause(); return }
        for (cam, p) in camPlayers where p.rate == 0 {
            guard let c = project.clip(cam: cam), t >= c.start, t < c.end else { continue }
            Self.start(p, at: CMTime(seconds: t - c.start, preferredTimescale: 60_000), hostTime: Clock.cmTime(Clock.now + 0.03))
        }
    }

    /// Seek that keeps up with a finger: only one seek in flight, the latest wins.
    func seek(to t: Double) {
        let target = max(0, min(duration, t))
        time = target
        if playing { pause(); time = target }
        if seeking { pendingSeek = target; return }
        seeking = true
        player.seek(to: Timeline.time(target), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.seeking = false
                if let next = self.pendingSeek {
                    self.pendingSeek = nil
                    self.seek(to: next)
                }
            }
        }
        let tol = CMTime(value: 1, timescale: 10)
        for (cam, p) in camPlayers {
            guard let c = project.clip(cam: cam) else { continue }
            let local = max(0, min(c.duration, target - c.start))
            p.seek(to: CMTime(seconds: local, preferredTimescale: 60_000), toleranceBefore: tol, toleranceAfter: tol)
        }
    }

    func step(frames: Int) {
        seek(to: time + Double(frames) / Double(max(1, project.fps)))
    }

    func jumpToCut(next: Bool) {
        var times = project.cuts.map(\.time)
        times.append(contentsOf: [project.start, project.end])
        times.sort()
        if next, let t = times.first(where: { $0 > time + 0.02 }) { seek(to: t) }
        else if !next, let t = times.last(where: { $0 < time - 0.02 }) { seek(to: t) }
        else if !next { seek(to: 0) }
    }

    // MARK: - Trim

    func setIn() {
        let t = time
        project.trimIn = t < 0.05 ? nil : min(t, project.end - 0.5)
        refreshProgram()
    }

    func setOut() {
        let t = time
        project.trimOut = t > duration - 0.05 ? nil : max(t, project.start + 0.5)
        refreshProgram()
    }

    func clearTrim() {
        project.trimIn = nil
        project.trimOut = nil
        refreshProgram()
    }

    // MARK: - Editing the program

    private func pushUndo() {
        undoStack.append(project.cuts)
        if undoStack.count > 100 { undoStack.removeFirst() }
        redoStack.removeAll()
        canUndo = true
        canRedo = false
    }

    func undo() {
        guard let last = undoStack.popLast() else { return }
        redoStack.append(project.cuts)
        project.cuts = last
        canUndo = !undoStack.isEmpty
        canRedo = true
        refreshProgram()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(project.cuts)
        project.cuts = next
        canUndo = true
        canRedo = !redoStack.isEmpty
        refreshProgram()
    }

    /// Switch to a camera at the playhead (works while playing — like live switching).
    func cut(to cam: Int) {
        let t = playing ? player.currentTime().seconds : time
        pushUndo()
        var cuts = project.cuts.filter { abs($0.time - t) > 0.12 || $0.time < 0.001 }
        if t < 0.05, let i = cuts.firstIndex(where: { $0.time < 0.001 }) {
            cuts[i].cam = cam
            project.cuts = normalized(cuts)
            selectedCut = cuts[i].id
        } else {
            let c = Cut(time: t, cam: cam, kind: transition, length: transition == .cut ? 0 : transitionLength)
            cuts.append(c)
            project.cuts = normalized(cuts)
            selectedCut = project.cuts.contains(where: { $0.id == c.id }) ? c.id : nil
        }
        refreshProgram()
    }

    private func normalized(_ list: [Cut]) -> [Cut] {
        var out: [Cut] = []
        for c in list.sorted(by: { $0.time < $1.time }) {
            if let last = out.last, last.cam == c.cam { continue }
            out.append(c)
        }
        if out.isEmpty, let first = project.cams.first { out = [Cut(time: 0, cam: first)] }
        if let f = out.first, f.time > 0.001 { out[0].time = 0 }
        return out
    }

    var selected: Cut? { project.cuts.first { $0.id == selectedCut } }

    func updateSelected(_ change: (inout Cut) -> Void) {
        guard let i = project.cuts.firstIndex(where: { $0.id == selectedCut }) else { return }
        pushUndo()
        var c = project.cuts[i]
        change(&c)
        if c.kind == .cut { c.length = 0 } else if c.length < 0.1 { c.length = transitionLength }
        project.cuts[i] = c
        project.cuts = normalized(project.cuts)
        refreshProgram()
    }

    func deleteSelected() {
        guard let i = project.cuts.firstIndex(where: { $0.id == selectedCut }), project.cuts[i].time > 0.001 else { return }
        pushUndo()
        project.cuts.remove(at: i)
        project.cuts = normalized(project.cuts)
        selectedCut = nil
        refreshProgram()
    }

    private var dragStartCuts: [Cut]?

    func moveCut(_ id: UUID, to t: Double, done: Bool) {
        if dragStartCuts == nil { dragStartCuts = project.cuts }
        guard let i = project.cuts.firstIndex(where: { $0.id == id }), project.cuts[i].time > 0.001 else { return }
        let sorted = project.cuts.sorted { $0.time < $1.time }
        let k = sorted.firstIndex { $0.id == id } ?? 0
        let lo = k > 0 ? sorted[k - 1].time + 0.1 : 0.1
        let hi = k + 1 < sorted.count ? sorted[k + 1].time - 0.1 : duration - 0.1
        project.cuts[i].time = max(lo, min(hi, t))
        if done {
            if let start = dragStartCuts {
                undoStack.append(start)
                redoStack.removeAll()
                canUndo = true
                canRedo = false
            }
            dragStartCuts = nil
            refreshProgram()
        }
    }

    /// New program instructions (after an edit or a picture change); the frame on screen updates too.
    func refreshProgram() {
        guard let tl = timeline, let item = player.currentItem else { return }
        item.videoComposition = tl.videoComposition(project: project, size: previewSize, final: false)
        if !playing {
            player.seek(to: Timeline.time(time), toleranceBefore: .zero, toleranceAfter: .zero)
        }
    }

    // MARK: - Picture and sound

    func setPicture(_ change: (inout PictureSettings) -> Void) {
        change(&project.picture)
        refreshProgram()
    }

    func setFormat(_ f: ProjectFormat?) {
        project.format = f
        refreshProgram()
    }

    func setClip(cam: Int, _ change: (inout Clip) -> Void) {
        guard let i = project.clips.firstIndex(where: { $0.cam == cam }) else { return }
        change(&project.clips[i])
        refreshProgram()
    }

    private func setClipQuietly(cam: Int, _ change: (inout Clip) -> Void) {
        guard let i = project.clips.firstIndex(where: { $0.cam == cam }) else { return }
        change(&project.clips[i])
    }

    func setSound(_ change: (inout SoundSettings) -> Void) {
        let before = project.sound
        change(&project.sound)
        mix?.apply(project.sound, gainDB: project.mixGain ?? 4)
        remeasure(after: 1.5)
        // noise reduction changed: make the cleaned copy in the background
        for m in project.sound.mics {
            let old = before.mics.first { $0.cam == m.cam }?.denoise ?? 0
            if abs((m.denoise ?? 0) - old) > 0.001 { scheduleClean(cam: m.cam, level: m.denoise ?? 0) }
        }
    }

    private func scheduleClean(cam: Int, level: Double) {
        cleanTasks[cam]?.cancel()
        guard level > 0.02 else {
            cleaning.remove(cam)
            if playing { pause() }
            rebuildMix()
            return
        }
        guard let clip = project.clip(cam: cam), let audio = clip.audioFile else { return }
        if let made = clip.cleanLevel, abs(made - level) < 0.01, clip.cleanFile != nil {
            if playing { pause() }
            rebuildMix()
            return
        }
        cleaning.insert(cam)
        let input = store.url(project, audio)
        let name = "cam\(cam)-clean.caf"
        let tmp = store.url(project, "cam\(cam)-clean-partial.caf")
        let out = store.url(project, name)
        cleanTasks[cam] = Task.detached(priority: .userInitiated) { [weak self] in
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else { return }
            do {
                try Denoise.process(input: input, output: tmp, strength: level)
                guard !Task.isCancelled else { return }
                try? FileManager.default.removeItem(at: out)
                try FileManager.default.moveItem(at: tmp, to: out)
                await MainActor.run {
                    guard let self else { return }
                    self.setClipQuietly(cam: cam) { $0.cleanFile = name; $0.cleanLevel = level }
                    self.cleaning.remove(cam)
                    if self.playing { self.pause() }
                    self.rebuildMix()
                    self.remeasure(after: 0.3)
                }
            } catch {
                await MainActor.run { _ = self?.cleaning.remove(cam) }
            }
        }
    }

    func applyPreset(_ name: String) {
        setSound { s in
            s.preset = name
            switch name {
            case "Concert":
                s.lowCut = true; s.warmth = 0.15; s.presence = 0.15; s.air = 0.35; s.compress = 0.2
                s.reverb = .hall; s.reverbAmount = 0.4; s.room = 0.35
            case "Intimate":
                s.lowCut = true; s.warmth = 0.3; s.presence = 0.25; s.air = 0.15; s.compress = 0.35
                s.reverb = .studio; s.reverbAmount = 0.35; s.room = 0.15
            case "Church":
                s.lowCut = true; s.warmth = 0.1; s.presence = 0; s.air = 0.25; s.compress = 0.15
                s.reverb = .church; s.reverbAmount = 0.5; s.room = 0.45
            case "Voice":
                s.lowCut = true; s.warmth = 0; s.presence = 0.45; s.air = 0.2; s.compress = 0.55
                s.reverb = .none; s.room = 0.05
            default: // Natural
                s.lowCut = true; s.warmth = 0; s.presence = 0; s.air = 0; s.compress = 0.15
                s.reverb = .none; s.room = 0.3
            }
        }
    }

    /// Measures the real loudness of the current mix in the background, so the preview matches the export.
    private func remeasure(after delay: Double) {
        measureTask?.cancel()
        let store = self.store
        measureTask = Task.detached(priority: .utility) { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled, let self else { return }
            let p = await MainActor.run { self.project }
            guard p.prepared, let engine = try? MixEngine(project: p, store: store) else { return }
            engine.apply(p.sound, gainDB: 0)
            guard let loud = try? engine.render(from: p.start, to: p.end, to: nil), !Task.isCancelled else { return }
            let gain = max(-30, min(30, p.sound.target - loud))
            await MainActor.run {
                guard self.project.sound == p.sound else { return }
                self.project.mixGain = gain
                self.mix?.apply(self.project.sound, gainDB: gain)
            }
        }
    }

    // MARK: - Export

    func export(_ options: ExportOptions) {
        if playing { pause() }
        exportError = nil
        exportedURL = nil
        exportProgress = 0
        exportText = "Starting…"
        let p = project
        let store = self.store
        Task.detached(priority: .userInitiated) {
            do {
                let url = try await Exporter.export(project: p, store: store, options: options) { f, text in
                    DispatchQueue.main.async { self.exportProgress = f; self.exportText = text }
                }
                await MainActor.run {
                    self.exportedURL = url
                    self.exportProgress = nil
                    self.project.exportedAt = Date()
                }
            } catch {
                await MainActor.run {
                    self.exportError = error.localizedDescription
                    self.exportProgress = nil
                }
            }
        }
    }

    // MARK: - Saving

    private func scheduleSave() {
        saveItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.store.save(self.project)
        }
        saveItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: item)
    }

    func saveNow() {
        saveItem?.cancel()
        store.save(project)
        pause()
    }
}
