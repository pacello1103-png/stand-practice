import AVFoundation
import Photos
import VideoToolbox
import UIKit

enum ExportQuality: String, CaseIterable, Identifiable {
    case high, master
    var id: String { rawValue }
    var label: String { self == .high ? "High (HEVC)" : "Master (ProRes)" }
    var detail: String {
        self == .high ? "Very high bitrate HEVC with 320 kbps sound. Plays everywhere."
                      : "ProRes 422 HQ with uncompressed 24‑bit sound, for further editing. Large files."
    }
}

struct ExportOptions: Equatable {
    var uhd = false
    var quality: ExportQuality = .high
}

enum Exporter {
    /// Two-pass loudness: measure the mix, then render it at the target loudness.
    static func renderMix(project p: Project, store: ProjectStore, to url: URL,
                          progress: @escaping (Double) -> Void) throws -> Double {
        let fade = min(1.2, (p.end - p.start) / 4)
        let fi = (p.fadeIn ?? false) ? fade : 0, fo = (p.fadeOut ?? false) ? fade : 0
        let measure = try MixEngine(project: p, store: store)
        measure.apply(p.sound, gainDB: 0)
        let loud = try measure.render(from: p.start, to: p.end, to: nil) { progress($0 * 0.5) } ?? p.sound.target
        let gain = max(-30, min(30, p.sound.target - loud))
        let final = try MixEngine(project: p, store: store)
        final.apply(p.sound, gainDB: gain)
        _ = try final.render(from: p.start, to: p.end, fadeIn: fi, fadeOut: fo, to: url) { progress(0.5 + $0 * 0.5) }
        return gain
    }

    static func videoBitrate(size: CGSize, fps: Int) -> Int {
        let pixels = Double(size.width * size.height)
        let base = pixels >= 3840 * 2160 * 0.9 ? 55_000_000.0 : (pixels >= 1920 * 1080 * 0.9 ? 22_000_000.0 : 12_000_000.0)
        return Int(base * max(1, Double(fps) / 30).squareRoot())
    }

    /// Renders the program frame by frame from the original camera files and writes it with a chosen bitrate.
    static func export(project p: Project, store: ProjectStore, options: ExportOptions,
                       progress: @escaping (Double, String) -> Void) async throws -> URL {
        let bg = await BackgroundWork.begin("Export")
        defer { BackgroundWork.end(bg) }

        let work = store.folder(p.id)
        let timeline = try await Timeline.build(project: p, store: store)
        guard timeline.duration > 0.1 else { throw CaptureError.writer("There is no video to export.") }

        let mixURL = work.appendingPathComponent("mix.caf")
        var hasMix = false
        if !p.audioClips.isEmpty {
            progress(0, "Mixing the sound…")
            _ = try await Task.detached(priority: .userInitiated) {
                try Exporter.renderMix(project: p, store: store, to: mixURL) { f in progress(f * 0.2, "Mixing the sound…") }
            }.value
            hasMix = true
        }

        let size = p.outputFormat.size(uhd: options.uhd)
        let vc = timeline.videoComposition(project: p, size: size, final: true)
        let range = CMTimeRange(start: Timeline.time(p.start), end: Timeline.time(min(p.end, timeline.duration)))

        // reader: the rendered program
        let reader = try AVAssetReader(asset: timeline.composition)
        reader.timeRange = range
        let vTracks = timeline.composition.tracks(withMediaType: .video)
        let vOut = AVAssetReaderVideoCompositionOutput(videoTracks: vTracks, videoSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
        ])
        vOut.videoComposition = vc
        vOut.alwaysCopiesSampleData = false
        guard reader.canAdd(vOut) else { throw CaptureError.writer("Can't render this video.") }
        reader.add(vOut)

        var aReader: AVAssetReader?
        var aOut: AVAssetReaderTrackOutput?
        if hasMix {
            let mixAsset = AVURLAsset(url: mixURL)
            if let t = try await mixAsset.loadTracks(withMediaType: .audio).first {
                let r = try AVAssetReader(asset: mixAsset)
                let o = AVAssetReaderTrackOutput(track: t, outputSettings: [
                    AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2,
                    AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsBigEndianKey: false,
                    AVLinearPCMIsNonInterleaved: false,
                ])
                if r.canAdd(o) { r.add(o); aReader = r; aOut = o }
            }
        }

        // writer
        let safeName = p.name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: ".")
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeName).mov")
        try? FileManager.default.removeItem(at: out)
        let writer = try AVAssetWriter(outputURL: out, fileType: .mov)
        writer.shouldOptimizeForNetworkUse = true

        let color: [String: Any] = [
            AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ]
        var vSettings: [String: Any] = [
            AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height), AVVideoColorPropertiesKey: color,
        ]
        let proRes = options.quality == .master && writer.canApply(outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.proRes422HQ, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height),
        ], forMediaType: .video)
        if proRes {
            vSettings[AVVideoCodecKey] = AVVideoCodecType.proRes422HQ
        } else {
            vSettings[AVVideoCodecKey] = AVVideoCodecType.hevc
            vSettings[AVVideoCompressionPropertiesKey] = [
                AVVideoAverageBitRateKey: videoBitrate(size: size, fps: p.fps) * (options.quality == .master ? 2 : 1),
                AVVideoExpectedSourceFrameRateKey: p.fps,
                AVVideoMaxKeyFrameIntervalKey: p.fps * 2,
                AVVideoAllowFrameReorderingKey: true,
                AVVideoProfileLevelKey: kVTProfileLevel_HEVC_Main_AutoLevel as String,
            ] as [String: Any]
        }
        let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: vSettings)
        vIn.expectsMediaDataInRealTime = false
        guard writer.canAdd(vIn) else { throw CaptureError.writer("This device can't export in that format.") }
        writer.add(vIn)

        var aIn: AVAssetWriterInput?
        if aOut != nil {
            var layout = AudioChannelLayout()
            layout.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo
            let layoutData = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
            let aSettings: [String: Any]
            if options.quality == .master {
                aSettings = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2,
                             AVLinearPCMBitDepthKey: 24, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
                             AVLinearPCMIsNonInterleaved: false, AVChannelLayoutKey: layoutData]
            } else {
                aSettings = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2,
                             AVEncoderBitRateKey: 320_000, AVChannelLayoutKey: layoutData]
            }
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: aSettings)
            a.expectsMediaDataInRealTime = false
            if writer.canAdd(a) { writer.add(a); aIn = a }
        }

        guard reader.startReading() else { throw reader.error ?? CaptureError.writer("Could not start rendering.") }
        if aIn != nil { aReader?.startReading() }
        guard writer.startWriting() else { throw writer.error ?? CaptureError.writer("Could not start writing.") }
        writer.startSession(atSourceTime: .zero)

        let total = range.duration.seconds
        let startTime = range.start
        progress(0.2, "Rendering the picture…")

        // feed both inputs; video times are moved so the film starts at zero
        let vQueue = DispatchQueue(label: "tutti.export.video")
        let aQueue = DispatchQueue(label: "tutti.export.audio")
        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                    let state = FeedState()
                    vIn.requestMediaDataWhenReady(on: vQueue) {
                        while vIn.isReadyForMoreMediaData && !state.finished {
                            guard reader.status == .reading, let sb = vOut.copyNextSampleBuffer() else {
                                vIn.markAsFinished()
                                state.finished = true
                                c.resume()
                                return
                            }
                            let pts = CMSampleBufferGetPresentationTimeStamp(sb) - startTime
                            var timing = CMSampleTimingInfo(duration: CMSampleBufferGetDuration(sb), presentationTimeStamp: pts, decodeTimeStamp: .invalid)
                            var moved: CMSampleBuffer?
                            CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sb, sampleTimingEntryCount: 1,
                                                                  sampleTimingArray: &timing, sampleBufferOut: &moved)
                            if let moved { vIn.append(moved) }
                            let f = pts.seconds / max(0.01, total)
                            if f - state.last > 0.005 {
                                state.last = f
                                progress(0.2 + 0.8 * min(1, f), "Rendering the picture…")
                            }
                        }
                    }
                }
            }
            if let aIn, let aOut, let aReader {
                group.addTask {
                    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                        let state = FeedState()
                        aIn.requestMediaDataWhenReady(on: aQueue) {
                            while aIn.isReadyForMoreMediaData && !state.finished {
                                guard aReader.status == .reading, let sb = aOut.copyNextSampleBuffer() else {
                                    aIn.markAsFinished()
                                    state.finished = true
                                    c.resume()
                                    return
                                }
                                aIn.append(sb)
                            }
                        }
                    }
                }
            }
        }

        if reader.status == .failed {
            writer.cancelWriting()
            throw reader.error ?? CaptureError.writer("Rendering failed.")
        }
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? CaptureError.writer("Export did not finish.") }
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

private final class FeedState: @unchecked Sendable {
    var finished = false
    var last = 0.0
}

/// Keeps long work (export, preparing, transfers) going for a while after you leave the app.
/// iOS pauses the app eventually; the work then continues where it stopped when you come back.
enum BackgroundWork {
    private final class Box: @unchecked Sendable { var id = UIBackgroundTaskIdentifier.invalid }

    @MainActor
    static func begin(_ name: String) -> UIBackgroundTaskIdentifier {
        let box = Box()
        box.id = UIApplication.shared.beginBackgroundTask(withName: name) {
            let id = box.id
            box.id = .invalid
            if id != .invalid { UIApplication.shared.endBackgroundTask(id) }
        }
        return box.id
    }

    static func end(_ id: UIBackgroundTaskIdentifier) {
        guard id != .invalid else { return }
        DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(id) }
    }
}
