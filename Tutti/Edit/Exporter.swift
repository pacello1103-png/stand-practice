import AVFoundation
import Photos

struct ExportOptions: Equatable {
    var uhd = false
    var maxQuality = false
}

enum Exporter {
    /// Two-pass loudness: measure the mix, then render it at the target loudness.
    static func renderMix(project p: Project, store: ProjectStore, to url: URL, duration: Double,
                          progress: @escaping (Double) -> Void) throws -> Double {
        let measure = try MixEngine(project: p, store: store)
        measure.apply(p.sound, gainDB: 0)
        let loud = try measure.render(duration: duration, to: nil) { progress($0 * 0.5) } ?? p.sound.target
        let gain = max(-30, min(30, p.sound.target - loud))
        let final = try MixEngine(project: p, store: store)
        final.apply(p.sound, gainDB: gain)
        _ = try final.render(duration: duration, to: url) { progress(0.5 + $0 * 0.5) }
        return gain
    }

    static func export(project p: Project, store: ProjectStore, options: ExportOptions,
                       progress: @escaping (Double, String) -> Void) async throws -> URL {
        let work = store.folder(p.id)
        let timeline = try await Timeline.build(project: p, store: store)
        let duration = timeline.duration
        guard duration > 0.1 else { throw CaptureError.writer("There is no video to export.") }

        let mixURL = work.appendingPathComponent("mix.caf")
        var hasMix = false
        if !p.audioClips.isEmpty {
            progress(0, "Mixing the sound…")
            _ = try await Task.detached(priority: .userInitiated) {
                try Exporter.renderMix(project: p, store: store, to: mixURL, duration: duration) { f in progress(f * 0.3, "Mixing the sound…") }
            }.value
            hasMix = true
        }
        if hasMix { try await timeline.addAudio(mixURL) }

        let size = Timeline.renderSize(uhd: options.uhd)
        let vc = timeline.videoComposition(project: p, size: size)
        let preset: String
        if options.maxQuality {
            preset = AVAssetExportPresetHighestQuality
        } else {
            preset = options.uhd ? AVAssetExportPresetHEVC3840x2160 : AVAssetExportPresetHEVC1920x1080
        }
        guard let session = AVAssetExportSession(asset: timeline.composition, presetName: preset) else {
            throw CaptureError.writer("This device can't export in that format.")
        }
        let safeName = p.name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: ".")
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeName).mov")
        try? FileManager.default.removeItem(at: out)
        session.outputURL = out
        session.outputFileType = .mov
        session.videoComposition = vc
        session.shouldOptimizeForNetworkUse = true

        progress(0.3, "Rendering the video…")
        let timer = Timer(timeInterval: 0.25, repeats: true) { _ in
            progress(0.3 + Double(session.progress) * 0.7, "Rendering the video…")
        }
        RunLoop.main.add(timer, forMode: .common)
        defer { timer.invalidate() }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { c.resume() }
        }
        if session.status != .completed {
            throw session.error ?? CaptureError.writer("Export did not finish.")
        }
        progress(1, "Done")
        return out
    }

    static func saveToPhotos(_ url: URL) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw CaptureError.writer("Tutti may not add to Photos. Allow it in Settings.") }
        try await PHPhotoLibrary.shared().performChanges {
            let req = PHAssetCreationRequest.forAsset()
            req.addResource(with: .video, fileURL: url, options: nil)
        }
    }
}
