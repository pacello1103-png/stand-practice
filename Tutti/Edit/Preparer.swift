import AVFoundation

/// After a recording (or import): prepares the sound, lines everything up by listening,
/// and measures each camera's look. Runs once per project.
enum Preparer {
    static func run(_ input: Project, store: ProjectStore, progress: @escaping (Double, String) -> Void) async -> Project {
        var p = input
        let clips = p.clips.filter { !$0.missing && $0.file != nil }
        let steps = Double(max(1, clips.count * 2 + 1))
        var done = 0.0
        func step(_ text: String) { progress(min(0.99, done / steps), text); done += 1 }

        // 1. video facts + sound copies
        var lows: [Int: [Float]] = [:]
        for c in clips {
            guard let i = p.clips.firstIndex(where: { $0.id == c.id }), let f = c.file else { continue }
            step("Reading camera \(c.cam)…")
            let url = store.url(p, f)
            let asset = AVURLAsset(url: url)
            if let v = try? await asset.loadTracks(withMediaType: .video).first {
                if let size = try? await v.load(.naturalSize) {
                    p.clips[i].width = Int(abs(size.width))
                    p.clips[i].height = Int(abs(size.height))
                }
                if let tr = try? await v.load(.preferredTransform) {
                    let deg = Int((atan2(Double(tr.b), Double(tr.a)) * 180 / .pi).rounded())
                    p.clips[i].rotation = ((Int((Double(deg) / 90).rounded()) * 90) % 360 + 360) % 360
                }
                if let r = try? await v.load(.timeRange) { p.clips[i].duration = r.duration.seconds }
                p.clips[i].hasVideo = true
            } else {
                p.clips[i].hasVideo = false
                if let d = try? await asset.load(.duration) { p.clips[i].duration = d.seconds }
            }
            let audioName = "cam\(c.cam)-sound.caf"
            if let prepared = try? await AudioPrep.prepare(from: url, to: store.url(p, audioName)) {
                p.clips[i].hasAudio = true
                p.clips[i].audioFile = audioName
                p.clips[i].loudness = prepared.loudness
                let peaks = "cam\(c.cam).peaks"
                AudioPrep.savePeaks(prepared.peaks, to: store.url(p, peaks))
                p.clips[i].peaksFile = peaks
                lows[c.cam] = prepared.low
                if !p.clips[i].hasVideo { p.clips[i].duration = prepared.duration }
            } else {
                p.clips[i].hasAudio = false
            }
        }

        // default sound routing: the best microphone is main, the rest are room
        if p.sound.mics.isEmpty {
            let withSound = p.clips.filter { $0.hasAudio && $0.audioFile != nil }
            let main = mainMicGuess(withSound)
            p.sound.mics = withSound.map { MicSetting(cam: $0.cam, role: $0.cam == main ? .main : .room) }
        }

        // 2. sync by sound
        step("Lining up the sound…")
        let mainCam = p.sound.mics.first { $0.role == .main }?.cam ?? p.clips.first(where: { $0.hasAudio })?.cam
        if let mainCam, let ref = p.clips.first(where: { $0.cam == mainCam }), let refLow = lows[mainCam] {
            for i in p.clips.indices where p.clips[i].cam != mainCam {
                guard let low = lows[p.clips[i].cam], let file = p.clips[i].audioFile, let refFile = ref.audioFile else { continue }
                align(&p.clips[i], ref: ref, refLow: refLow, low: low, refURL: store.url(p, refFile), url: store.url(p, file), wide: p.imported)
            }
        }

        // 3. look
        if let refCam = p.cams.contains(p.picture.reference) ? p.picture.reference : p.cams.first {
            var samples: [Int: [LookMatch.Sample]] = [:]
            for c in p.videoClips {
                step("Measuring the picture of camera \(c.cam)…")
                samples[c.cam] = await LookMatch.analyze(url: store.url(p, c.file!), duration: c.duration)
            }
            p.picture.reference = refCam
            for i in p.clips.indices where p.clips[i].hasVideo && !p.clips[i].missing {
                let cam = p.clips[i].cam
                p.clips[i].auto = LookMatch.match(cam: samples[cam] ?? [], ref: samples[refCam] ?? [], isReference: cam == refCam)
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
