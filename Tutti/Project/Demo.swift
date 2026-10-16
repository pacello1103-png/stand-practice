import AVFoundation
import UIKit
import CoreGraphics
import CoreImage

/// Synthetic three-camera recording, used for screenshots and as a quick way to try the editor
/// without filming. Camera 2's sound is late on purpose and camera 3 is darker and bluer,
/// so syncing and look matching have real work to do.
enum Demo {
    static let colors: [UIColor] = [UIColor(red: 0.20, green: 0.16, blue: 0.12, alpha: 1),
                                    UIColor(red: 0.12, green: 0.18, blue: 0.16, alpha: 1),
                                    UIColor(red: 0.13, green: 0.15, blue: 0.22, alpha: 1)]

    static func makeProject(store: ProjectStore) async throws -> Project {
        var p = Project(name: "Demo — Trio in the hall")
        p.fps = 25
        p.imported = false
        let offsets = [0.0, 0.12, -0.04]           // sound arrives late / early (seconds)
        let brightness = [1.0, 1.0, 0.62]
        let tint = [1.0, 1.0, 1.25]
        for i in 0..<3 {
            let url = store.url(p, "cam\(i + 1).mov")
            try await writeClip(url: url, cam: i + 1, seconds: 14, soundOffset: offsets[i], brightness: brightness[i], blue: tint[i])
            p.clips.append(Clip(cam: i + 1, device: ["iPad", "iPhone A", "iPhone B"][i], file: "cam\(i + 1).mov",
                                start: Double(i) * 0.02, duration: 14, audioName: i == 0 ? "USB Audio" : "iPhone Microphone"))
        }
        // camera 2: the director zoomed in on the player and then glided back out
        p.clips[1].moves = [FramingKey(time: 3.6, framing: Framing(zoom: 1.6, center: CGPoint(x: 0.5, y: 0.45)), duration: 2),
                            FramingKey(time: 6.0, framing: Framing(), duration: 1.5)]
        p.cuts = [Cut(time: 0, cam: 1),
                  Cut(time: 3.2, cam: 2, kind: .dissolve, length: 0.8),
                  Cut(time: 6.5, cam: 3, kind: .push, length: 0.6),
                  Cut(time: 9.8, cam: 1, kind: .dip, length: 0.8)]
        store.save(p)
        return p
    }

    /// The "music": a melody with clear note onsets, the same for every microphone.
    private static func music(_ t: Double) -> Float {
        guard t >= 0 else { return 0 }
        let notes: [Double] = [220, 247, 262, 294, 330, 294, 262, 247]
        let beat = 0.5
        let k = Int(t / beat)
        let local = t - Double(k) * beat
        let f = notes[k % notes.count]
        let env = exp(-local * 5) * 0.8 + 0.1
        var s = sin(2 * Double.pi * f * t) * 0.5 + sin(2 * Double.pi * f * 2 * t) * 0.2 + sin(2 * Double.pi * f * 3 * t) * 0.08
        // a short "click" of the bow at each note
        if local < 0.004 { s += Double((k * 7919 % 13)) / 13 - 0.5 }
        return Float(s * env * 0.6)
    }

    private static func writeClip(url: URL, cam: Int, seconds: Double, soundOffset: Double, brightness: Double, blue: Double) async throws {
        try? FileManager.default.removeItem(at: url)
        let w = 1280, h = 720, fps = 25
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let v = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
        ])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: v, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h,
        ])
        writer.add(v)
        let sr = 48_000.0
        var layout = AudioChannelLayout()
        layout.mChannelLayoutTag = kAudioChannelLayoutTag_Mono
        let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sr, AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
            AVChannelLayoutKey: Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size),
        ])
        writer.add(a)
        guard writer.startWriting() else { throw writer.error ?? CaptureError.writer("demo") }
        writer.startSession(atSourceTime: .zero)

        // video and sound interleaved, frame by frame (the writer waits for both)
        let frames = Int(seconds * Double(fps))
        let base = colors[(cam - 1) % colors.count]
        let total = Int(seconds * sr)
        let perFrame = Int(sr) / fps
        let level: Float = cam == 1 ? 1 : 0.45
        var pos = 0
        for i in 0..<frames {
            var spins = 0
            while !v.isReadyForMoreMediaData && spins < 2000 { try await Task.sleep(nanoseconds: 1_000_000); spins += 1 }
            if let pool = adaptor.pixelBufferPool {
                var pbOut: CVPixelBuffer?
                CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pbOut)
                if let pb = pbOut {
                    draw(into: pb, cam: cam, t: Double(i) / Double(fps), base: base, brightness: brightness, blue: blue)
                    adaptor.append(pb, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: CMTimeScale(fps)))
                }
            }
            let end = i == frames - 1 ? total : min(total, (i + 1) * perFrame)
            if end > pos {
                spins = 0
                while !a.isReadyForMoreMediaData && spins < 2000 { try await Task.sleep(nanoseconds: 1_000_000); spins += 1 }
                var samples = [Int16](repeating: 0, count: end - pos)
                for j in 0..<samples.count {
                    let t = Double(pos + j) / sr - soundOffset
                    var s = music(t) * level
                    if cam != 1 { s += Float.random(in: -0.01...0.01) }   // room noise
                    samples[j] = Int16(max(-1, min(1, s)) * 32_000)
                }
                if let sb = makeAudioSample(samples, at: pos, sr: sr) { a.append(sb) }
                pos = end
            }
        }
        v.markAsFinished()
        a.markAsFinished()
        await writer.finishWriting()
        if writer.status != .completed { throw writer.error ?? CaptureError.writer("demo") }
    }

    private static func makeAudioSample(_ s: [Int16], at pos: Int, sr: Double) -> CMSampleBuffer? {
        var asbd = AudioStreamBasicDescription(mSampleRate: sr, mFormatID: kAudioFormatLinearPCM,
                                               mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
                                               mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1,
                                               mBitsPerChannel: 16, mReserved: 0)
        var fmt: CMAudioFormatDescription?
        guard CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0,
                                             magicCookie: nil, extensions: nil, formatDescriptionOut: &fmt) == noErr, let fmt else { return nil }
        let bytes = s.count * 2
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil,
                                                 customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: 0,
                                                 blockBufferOut: &block) == noErr, let block else { return nil }
        _ = s.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes) }
        var sb: CMSampleBuffer?
        let pts = CMTime(value: CMTimeValue(pos), timescale: CMTimeScale(sr))
        guard CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block, formatDescription: fmt,
                                                                   sampleCount: s.count, presentationTimeStamp: pts,
                                                                   packetDescriptions: nil, sampleBufferOut: &sb) == noErr else { return nil }
        return sb
    }

    private static func draw(into pb: CVPixelBuffer, cam: Int, t: Double, base: UIColor, brightness: Double, blue: Double) {
        CVPixelBufferLockBaseAddress(pb, [])
        defer { CVPixelBufferUnlockBaseAddress(pb, []) }
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
        guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb), width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: CVPixelBufferGetBytesPerRow(pb), space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return }
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, al: CGFloat = 0
        base.getRed(&r, green: &g, blue: &b, alpha: &al)
        let k = CGFloat(brightness)
        func col(_ x: CGFloat, _ y: CGFloat, _ z: CGFloat) -> CGColor {
            CGColor(red: min(1, x * k), green: min(1, y * k), blue: min(1, z * k * CGFloat(blue)), alpha: 1)
        }
        ctx.setFillColor(col(r, g, b))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        // stage floor and a warm spotlight
        ctx.setFillColor(col(r * 1.6, g * 1.5, b * 1.4))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h / 4))
        let cx = CGFloat(w) / 2 + CGFloat(sin(t * 0.8)) * CGFloat(w) * (cam == 2 ? 0.25 : 0.15)
        let spot = CGRect(x: cx - 170, y: CGFloat(h) * 0.22, width: 340, height: 340)
        ctx.setFillColor(col(0.95, 0.80, 0.55))
        ctx.fillEllipse(in: spot)
        // a "player": head and body
        ctx.setFillColor(col(0.25, 0.20, 0.18))
        ctx.fillEllipse(in: CGRect(x: cx - 34, y: spot.midY + 40, width: 68, height: 68))
        ctx.fill(CGRect(x: cx - 55, y: spot.minY + 30, width: 110, height: 120))
        // pastel arcs like the app icon, for colour reference
        let pastel: [(CGFloat, CGFloat, CGFloat)] = [(0.95, 0.65, 0.35), (0.95, 0.82, 0.43), (0.59, 0.81, 0.51), (0.52, 0.71, 0.95), (0.70, 0.60, 0.94)]
        for (i, p) in pastel.enumerated() {
            ctx.setFillColor(col(p.0, p.1, p.2))
            ctx.fill(CGRect(x: 60 + i * 46, y: h - 120, width: 36, height: 60))
        }
        // label
        let label = "CAM \(cam)" as NSString
        UIGraphicsPushContext(ctx)
        ctx.saveGState()
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: 1, y: -1)
        label.draw(at: CGPoint(x: CGFloat(w) - 260, y: 40), withAttributes: [
            .font: UIFont.systemFont(ofSize: 54, weight: .heavy),
            .foregroundColor: UIColor(white: CGFloat(0.9 * brightness), alpha: 1),
        ])
        ctx.restoreGState()
        UIGraphicsPopContext()
    }

    // MARK: - Launch arguments (screenshots in CI)

    static func handleLaunch(store: ProjectStore, router: Router) {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-demo"), i + 1 < args.count else { return }
        let mode = args[i + 1]
        switch mode {
        case "director":
            router.screen = .director
        case "editor", "export", "sound", "picture":
            Task {
                let p: Project
                if let existing = store.projects.first(where: { $0.name.hasPrefix("Demo") }) { p = existing }
                else {
                    do { p = try await Demo.makeProject(store: store) }
                    catch {
                        let f = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("demo-error.txt")
                        try? "\(error)".write(to: f, atomically: true, encoding: .utf8)
                        return
                    }
                }
                await MainActor.run {
                    router.demoTab = mode
                    router.screen = .editor(p.id)
                }
            }
        default:
            break
        }
    }

    /// Fake cameras for the director screenshot.
    static func previewImage(cam: Int) -> UIImage {
        let size = CGSize(width: 480, height: 270)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            let pb: CVPixelBuffer? = {
                var out: CVPixelBuffer?
                CVPixelBufferCreate(nil, 1280, 720, kCVPixelFormatType_32BGRA, nil, &out)
                return out
            }()
            if let pb {
                draw(into: pb, cam: cam, t: Double(cam) * 1.3, base: colors[(cam - 1) % colors.count], brightness: 1, blue: 1)
                let ci = CIImage(cvPixelBuffer: pb)
                if let cg = CIContext().createCGImage(ci, from: ci.extent) {
                    UIImage(cgImage: cg).draw(in: CGRect(origin: .zero, size: size))
                }
            }
            _ = ctx
        }
    }
}
