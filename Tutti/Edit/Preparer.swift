import AVFoundation

/// After a recording (or import): prepares the sound, lines everything up by listening,
/// and measures each camera's look. Runs once per project.
enum Preparer {
    private struct Facts: Sendable {
        var id: UUID
        var width = 0, height = 0, rotation = 0
        var duration: Double?
        var hasVideo = false
        var audio: PreparedAudio?
        var audioName = "", peaksName = ""
        var look: [LookMatch.Sample] = []
    }

    /// Everything about one clip, read in one go (runs for all clips at the same time).
    private static func read(_ c: Clip, url: URL, store: ProjectStore, project p: Project) async -> Facts {
        var f = Facts(id: c.id)
        let asset = AVURLAsset(url: url)
        if let v = try? await asset.loadTracks(withMediaType: .video).first {
            if let size = try? await v.load(.naturalSize) {
                f.width = Int(abs(size.width))
                f.height = Int(abs(size.height))
            }
            if let tr = try? await v.load(.preferredTransform) {
                let deg = Int((atan2(Double(tr.b), Double(tr.a)) * 180 / .pi).rounded())
                f.rotation = ((Int((Double(deg) / 90).rounded()) * 90) % 360 + 360) % 360
            }
            if let r = try? await v.load(.timeRange) { f.duration = r.duration.seconds }
            f.hasVideo = true
        } else if let d = try? await asset.load(.duration) {
            f.duration = d.seconds
        }
        let hasVideo = f.hasVideo
        let length = f.duration ?? c.duration
        async let look: [LookMatch.Sample] = hasVideo ? LookMatch.analyze(url: url, duration: length) : []
        f.audioName = "cam\(c.cam)-sound.caf"
        f.peaksName = "cam\(c.cam).peaks"
        let audioURL = store.url(p, f.audioName)
        f.audio = try? await Task.detached(priority: .userInitiated) { try await AudioPrep.prepare(from: url, to: audioURL) }.value
        if let a = f.audio { AudioPrep.savePeaks(a.peaks, to: store.url(p, f.peaksName)) }
        f.look = await look
        return f
    }

    static func run(_ input: Project, store: ProjectStore, progress: @escaping (Double, String) -> Void) async -> Project {
        let bg = await BackgroundWork.begin("Prepare")
        defer { BackgroundWork.end(bg) }
        var p = input
        let clips = p.clips.filter { !$0.missing && $0.file != nil }
        progress(0.02, "Reading \(clips.count) camera\(clips.count == 1 ? "" : "s")…")

        // 1. video facts, sound copies and picture measurements — all clips in parallel
        var facts: [UUID: Facts] = [:]
        let snapshot = p
        await withTaskGroup(of: Facts.self) { group in
            for c in clips {
                let url = store.url(snapshot, c.file!)
                group.addTask { await read(c, url: url, store: store, project: snapshot) }
            }
            var done = 0
            for await f in group {
                facts[f.id] = f
                done += 1
                progress(0.05 + 0.8 * Double(done) / Double(max(1, clips.count)), "Read \(done) of \(clips.count)…")
            }
        }
        var lows: [Int: [Float]] = [:]
        var looks: [Int: [LookMatch.Sample]] = [:]
        for i in p.clips.indices {
            guard let f = facts[p.clips[i].id] else { continue }
            if f.hasVideo {
                p.clips[i].width = f.width
                p.clips[i].height = f.height
                p.clips[i].rotation = f.rotation
            }
            p.clips[i].hasVideo = f.hasVideo
            if let d = f.duration { p.clips[i].duration = d }
            if let a = f.audio {
                p.clips[i].hasAudio = true
                p.clips[i].audioFile = f.audioName
                p.clips[i].peaksFile = f.peaksName
                p.clips[i].loudness = a.loudness
                lows[p.clips[i].cam] = a.low
                if !f.hasVideo { p.clips[i].duration = a.duration }
            } else {
                p.clips[i].hasAudio = false
            }
            looks[p.clips[i].cam] = f.look
        }

        // default sound routing: the best microphone is main, the rest are room
        if p.sound.mics.isEmpty {
            let withSound = p.clips.filter { $0.hasAudio && $0.audioFile != nil }
            let main = mainMicGuess(withSound)
            p.sound.mics = withSound.map { MicSetting(cam: $0.cam, role: $0.cam == main ? .main : .room) }
        }

        // 2. sync by sound
        progress(0.9, "Lining up the sound…")
        let mainCam = p.sound.mics.first { $0.role == .main }?.cam ?? p.clips.first(where: { $0.hasAudio })?.cam
        if let mainCam, let ref = p.clips.first(where: { $0.cam == mainCam }), let refLow = lows[mainCam] {
            for i in p.clips.indices where p.clips[i].cam != mainCam {
                guard let low = lows[p.clips[i].cam], let file = p.clips[i].audioFile, let refFile = ref.audioFile else { continue }
                align(&p.clips[i], ref: ref, refLow: refLow, low: low, refURL: store.url(p, refFile), url: store.url(p, file), wide: p.imported)
            }
        }

        // 3. look
        if let refCam = p.cams.contains(p.picture.reference) ? p.picture.reference : p.cams.first {
            p.picture.reference = refCam
            for i in p.clips.indices where p.clips[i].hasVideo && !p.clips[i].missing {
                let cam = p.clips[i].cam
                p.clips[i].auto = LookMatch.match(cam: looks[cam] ?? [], ref: looks[refCam] ?? [], isReference: cam == refCam)
            }
        }

        if p.cuts.isEmpty, let first = p.cams.first { p.cuts = [Cut(time: 0, cam: first)] }
        p.prepared = true
        progress(1, "Ready")
        return p
    }

    /// The microphone most likely to be the "good" one: an external mic, else the loudest clean one.
    private static func mainMicGuess(_ clips: [Clip]) -> Int? {
        if let ext = clips.first(where: { !$0.audioName.isEmpty && !$0.audioName.lowercased().contains("microphone") && !$0.audioName.lowercased().contains("mikrofon") }) {
            return ext.cam
        }
        return clips.max { ($0.loudness ?? -99) < ($1.loudness ?? -99) }?.cam ?? clips.first?.cam
    }

    /// Finds how far `clip` is from `ref` by listening, at the start and near the end (for drift).
    private static func align(_ clip: inout Clip, ref: Clip, refLow: [Float], low: [Float], refURL: URL, url: URL, wide: Bool) {
        let lr = AudioPrep.lowRate
        // the stretch both microphones heard, on the current timeline
        let overlapStart = max(ref.start, clip.start) + 0.5
        let overlapEnd = min(ref.start + ref.duration, clip.start + clip.duration) - 0.5
        let window = wide ? 60.0 : 30.0
        let maxLag = wide ? Int(lr * 50) : Int(lr * 0.6)

        func measure(at t0: Double, shift: Double) -> (shift: Double, conf: Double)? {
            let a0 = Int((t0 - ref.start) * lr)
            let b0 = Int((t0 - clip.start - shift) * lr)
            let n = Int(window * lr)
            guard a0 >= 0, b0 >= 0, a0 < refLow.count, b0 < low.count else { return nil }
            let a = Array(refLow[a0..<min(refLow.count, a0 + n)])
            let b = Array(low[b0..<min(low.count, b0 + n)])
            guard let m = SoundSync.coarse(ref: a, other: b, maxLag: maxLag), m.confidence > 7 else { return nil }
            var s = shift + Double(m.lag) / lr
            // sample-accurate at 48 kHz
            let sr = AudioPrep.rate
            let center = t0 + window / 2
            let fa = Int((center - ref.start) * sr)
            let fb = Int((center - clip.start - s) * sr)
            if let ra = AudioPrep.readMono(refURL, from: fa - 48_000, count: 96_000),
               let rb = AudioPrep.readMono(url, from: fb - 48_000, count: 96_000), ra.count == rb.count {
                let k = SoundSync.fine(ref: ra, other: rb, maxLag: 24)
                s += Double(k) / sr
            }
            return (s, m.confidence)
        }

        let startT = wide ? max(0.5, overlapStart) : overlapStart
        guard overlapEnd - startT > 3 || wide else { return }
        guard let first = measure(at: startT, shift: 0) else {
            clip.syncNote = "Kept the camera clocks (no clear sound to match)"
            return
        }
        var shift = first.shift
        var drift = 0.0
        let span = overlapEnd - startT
        if span > 90, let second = measure(at: overlapEnd - window - 1, shift: shift) {
            let t1 = startT + window / 2, t2 = overlapEnd - window / 2 - 1
            let d = (second.shift - first.shift) / max(1, t2 - t1)
            if abs(d) < 0.0005 {
                drift = d
                // shift at the very start of the clip
                shift = first.shift - d * (t1 - clip.start - first.shift)
            }
        }
        let movesPicture = wide || abs(shift) > 0.06
        if movesPicture {
            clip.start += shift
            clip.audioShift = 0
        } else {
            clip.audioShift = shift
        }
        clip.drift = drift
        let ms = shift * 1000
        var note = String(format: "Lined up by sound (%+.1f ms)", ms)
        if drift != 0 { note += String(format: ", drift %.0f ppm corrected", drift * 1_000_000) }
        clip.syncNote = note
    }
}
