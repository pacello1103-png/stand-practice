import AVFoundation

/// The project as something AVFoundation can play and export: one video track per camera,
/// placed on the shared timeline, plus the program instructions (who is on screen, transitions).
final class Timeline {
    let composition = AVMutableComposition()
    private(set) var tracks: [Int: CMPersistentTrackID] = [:]
    private(set) var duration: Double = 0
    private(set) var audioTrack: AVMutableCompositionTrack?

    static let timescale: CMTimeScale = 60_000

    static func time(_ s: Double) -> CMTime { CMTime(seconds: s, preferredTimescale: timescale) }

    static func build(project p: Project, store: ProjectStore) async throws -> Timeline {
        let tl = Timeline()
        for c in p.videoClips {
            guard let f = c.file else { continue }
            let asset = AVURLAsset(url: store.url(p, f), options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
            guard let src = try await asset.loadTracks(withMediaType: .video).first else { continue }
            let range = try await src.load(.timeRange)
            guard let track = tl.composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
            var srcStart = range.start
            var at = c.start
            if at < 0 {
                srcStart = srcStart + time(-at)
                at = 0
            }
            let length = range.end - srcStart
            guard length.seconds > 0.05 else { continue }
            try track.insertTimeRange(CMTimeRange(start: srcStart, duration: length), of: src, at: time(at))
            tl.tracks[c.cam] = track.trackID
            tl.duration = max(tl.duration, at + length.seconds)
        }
        tl.duration = tl.composition.duration.seconds
        return tl
    }

    /// Adds the finished sound mix.
    func addAudio(_ url: URL) async throws {
        let asset = AVURLAsset(url: url)
        guard let src = try await asset.loadTracks(withMediaType: .audio).first else { return }
        let range = try await src.load(.timeRange)
        let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        let len = CMTimeMinimum(range.duration, Self.time(duration))
        try track?.insertTimeRange(CMTimeRange(start: range.start, duration: len), of: src, at: .zero)
        audioTrack = track
    }

    /// Until the mix is ready, the preview plays the main camera's own sound.
    func addRawAudio(project p: Project, store: ProjectStore) async {
        let main = p.sound.mics.first { $0.role == .main }?.cam
        guard let c = p.clips.first(where: { $0.cam == main && !$0.missing }) ?? p.videoClips.first, let f = c.file else { return }
        let asset = AVURLAsset(url: store.url(p, f))
        guard let src = try? await asset.loadTracks(withMediaType: .audio).first,
              let range = try? await src.load(.timeRange),
              let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { return }
        var srcStart = range.start
        var at = c.start
        if at < 0 { srcStart = srcStart + Self.time(-at); at = 0 }
        let len = CMTimeMinimum(range.end - srcStart, Self.time(max(0, duration - at)))
        guard len.seconds > 0.05 else { return }
        try? track.insertTimeRange(CMTimeRange(start: srcStart, duration: len), of: src, at: Self.time(at))
        audioTrack = track
    }

    /// The program: cuts and transitions as composition instructions.
    func videoComposition(project p: Project, size: CGSize, final: Bool) -> AVMutableVideoComposition {
        let plan = RenderPlan.make(project: p, size: size, final: final)
        let vc = AVMutableVideoComposition()
        vc.customVideoCompositorClass = ProgramCompositor.self
        vc.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, p.fps)))
        vc.renderSize = size
        vc.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        vc.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        vc.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
        vc.instructions = instructions(project: p, plan: plan)
        return vc
    }

    func instructions(project p: Project, plan: RenderPlan) -> [ProgramInstruction] {
        let total = duration
        let available = Set(tracks.keys)
        func track(_ cam: Int) -> CMPersistentTrackID { tracks[cam] ?? kCMPersistentTrackID_Invalid }
        let fallback = available.min() ?? 1

        // clean list of switches
        var cuts = p.cuts.filter { available.contains($0.cam) && $0.time < total }.sorted { $0.time < $1.time }
        if cuts.isEmpty || cuts[0].time > 0.0001 {
            cuts.insert(Cut(time: 0, cam: cuts.first?.cam ?? fallback), at: 0)
        }
        var program: [Cut] = []
        for c in cuts {
            if let last = program.last, last.cam == c.cam { continue }
            program.append(c)
        }

        // segments: (start, end, from, to?, kind)
        struct Seg { var s: Double; var e: Double; var from: Int; var to: Int?; var kind: TransitionKind }
        var segs: [Seg] = []
        var cursor = 0.0
        var current = program[0].cam
        for i in 1..<max(1, program.count) where program.count > 1 {
            let c = program[i]
            let nextTime = i + 1 < program.count ? program[i + 1].time : total
            let ts = max(c.time, cursor)
            let len = c.kind == .cut ? 0 : min(c.length, max(0, nextTime - ts) * 0.9)
            let te = min(total, ts + len)
            if ts > cursor { segs.append(Seg(s: cursor, e: ts, from: current, to: nil, kind: .cut)) }
            if te > ts { segs.append(Seg(s: ts, e: te, from: current, to: c.cam, kind: c.kind)) }
            cursor = max(cursor, te)
            current = c.cam
        }
        if total > cursor { segs.append(Seg(s: cursor, e: total, from: current, to: nil, kind: .cut)) }

        // exact, gap-free CMTime boundaries
        var out: [ProgramInstruction] = []
        for s in segs {
            let start = Self.time(s.s)
            let end = s.e >= total - 1e-9 ? composition.duration : Self.time(s.e)
            guard end > start else { continue }
            let range = CMTimeRange(start: start, end: end)
            if let to = s.to {
                out.append(ProgramInstruction(range: range, fromCam: s.from, fromTrack: track(s.from), toCam: to, toTrack: track(to), kind: s.kind, plan: plan))
            } else {
                out.append(ProgramInstruction(range: range, fromCam: s.from, fromTrack: track(s.from), plan: plan))
            }
        }
        if out.isEmpty {
            out.append(ProgramInstruction(range: CMTimeRange(start: .zero, end: total > 0 ? composition.duration : Self.time(0.1)), fromCam: fallback, fromTrack: track(fallback), plan: plan))
        }
        return out
    }
}
