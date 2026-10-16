import AVFoundation
import CoreImage
import simd

/// Everything the renderer needs about one camera. Immutable, so it is safe on render threads.
struct CamRender {
    var rotation: Int
    var framing: Framing
    var gains: SIMD3<Double>      // auto colour match × manual warmth/tint
    var exposure: Double          // auto × manual
    var steadyTimes: [Double]
    var steadyGains: [Double]
    var clipStart: Double

    func steady(at t: Double) -> Double {
        let local = t - clipStart
        guard let first = steadyTimes.first, let last = steadyTimes.last, steadyGains.count == steadyTimes.count else { return 1 }
        if local <= first { return steadyGains.first ?? 1 }
        if local >= last { return steadyGains.last ?? 1 }
        var i = 0
        while i < steadyTimes.count - 1 && steadyTimes[i + 1] < local { i += 1 }
        let t0 = steadyTimes[i], t1 = steadyTimes[i + 1]
        let f = (local - t0) / max(1e-6, t1 - t0)
        return steadyGains[i] * (1 - f) + steadyGains[i + 1] * f
    }
}

final class RenderPlan {
    let size: CGSize
    let cams: [Int: CamRender]
    let picture: PictureSettings

    init(size: CGSize, cams: [Int: CamRender], picture: PictureSettings) {
        self.size = size
        self.cams = cams
        self.picture = picture
    }

    static func make(project p: Project, size: CGSize) -> RenderPlan {
        var cams: [Int: CamRender] = [:]
        let pic = p.picture
        for c in p.videoClips {
            var gains = SIMD3<Double>(1, 1, 1)
            var exposure = pow(2, c.look.exposure)
            var times: [Double] = [], steady: [Double] = []
            if pic.matchLook, let a = c.auto {
                let k = pic.strength
                if a.gains.count == 3 {
                    gains = SIMD3(1 + (a.gains[0] - 1) * k, 1 + (a.gains[1] - 1) * k, 1 + (a.gains[2] - 1) * k)
                }
                exposure *= 1 + (a.exposure - 1) * k
                if pic.steady {
                    times = a.steadyTimes
                    steady = a.steadyGains.map { 1 + ($0 - 1) * k }
                }
            }
            // manual warmth / tint
            gains.x *= 1 + 0.10 * c.look.warmth
            gains.z *= 1 - 0.10 * c.look.warmth
            gains.y *= 1 - 0.07 * c.look.tint
            cams[c.cam] = CamRender(rotation: c.rotation, framing: c.framing, gains: gains, exposure: exposure,
                                    steadyTimes: times, steadyGains: steady, clipStart: c.start)
        }
        return RenderPlan(size: size, cams: cams, picture: pic)
    }
}

/// One stretch of the program: either one camera, or a transition from one camera to another.
final class ProgramInstruction: NSObject, AVVideoCompositionInstructionProtocol {
    let timeRange: CMTimeRange
    let enablePostProcessing = false
    let containsTweening = true
    let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID: CMPersistentTrackID = kCMPersistentTrackID_Invalid

    let fromCam: Int
    let fromTrack: CMPersistentTrackID
    let toCam: Int?
    let toTrack: CMPersistentTrackID?
    let kind: TransitionKind
    let plan: RenderPlan

    init(range: CMTimeRange, fromCam: Int, fromTrack: CMPersistentTrackID, toCam: Int? = nil, toTrack: CMPersistentTrackID? = nil,
         kind: TransitionKind = .cut, plan: RenderPlan) {
        timeRange = range
        self.fromCam = fromCam
        self.fromTrack = fromTrack
        self.toCam = toCam
        self.toTrack = toTrack
        self.kind = kind
        self.plan = plan
        var ids: [NSValue] = []
        if fromTrack != kCMPersistentTrackID_Invalid { ids.append(NSNumber(value: fromTrack)) }
        if let toTrack, toTrack != kCMPersistentTrackID_Invalid { ids.append(NSNumber(value: toTrack)) }
        requiredSourceTrackIDs = ids
        super.init()
    }
}

/// Renders the program: framing with high-quality scaling, detail recovery for zoomed shots,
/// look matching, and the transitions.
final class ProgramCompositor: NSObject, AVVideoCompositing {
    private static let context = CIContext(options: [.cacheIntermediates: false])
    private let queue = DispatchQueue(label: "tutti.compositor", qos: .userInitiated)
    private var cancelled = false

    var sourcePixelBufferAttributes: [String: Any]? {
        [kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                                                       kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                                                       kCVPixelFormatType_32BGRA],
         kCVPixelBufferMetalCompatibilityKey as String: true]
    }

    var requiredPixelBufferAttributesForRenderContext: [String: Any] {
        [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
         kCVPixelBufferMetalCompatibilityKey as String: true]
    }

    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

    func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        queue.async {
            if self.cancelled { request.finishCancelledRequest(); return }
            autoreleasepool {
                guard let ins = request.videoCompositionInstruction as? ProgramInstruction,
                      let out = request.renderContext.newPixelBuffer() else {
                    request.finish(with: NSError(domain: "Tutti", code: 1))
                    return
                }
                let image = Self.render(ins, request: request)
                let rect = CGRect(origin: .zero, size: ins.plan.size)
                let cs = CGColorSpace(name: CGColorSpace.itur_709) ?? CGColorSpaceCreateDeviceRGB()
                Self.context.render(image, to: out, bounds: rect, colorSpace: cs)
                request.finish(withComposedVideoFrame: out)
            }
        }
    }

    func cancelAllPendingVideoCompositionRequests() {
        cancelled = true
        queue.async { self.cancelled = false }
    }

    // MARK: - Rendering

    static func render(_ ins: ProgramInstruction, request: AVAsynchronousVideoCompositionRequest) -> CIImage {
        let plan = ins.plan
        let rect = CGRect(origin: .zero, size: plan.size)
        let t = request.compositionTime.seconds
        let black = CIImage(color: .black).cropped(to: rect)
        let a = shot(cam: ins.fromCam, track: ins.fromTrack, request: request, t: t, plan: plan) ?? black
        var result = a
        if let toCam = ins.toCam, let toTrack = ins.toTrack {
            let b = shot(cam: toCam, track: toTrack, request: request, t: t, plan: plan) ?? black
            let start = ins.timeRange.start.seconds
            let len = max(0.001, ins.timeRange.duration.seconds)
            var p = max(0, min(1, (t - start) / len))
            p = p * p * (3 - 2 * p)    // ease in and out
            result = blend(a, b, p: p, kind: ins.kind, rect: rect)
        }
        result = finish(result, plan: plan)
        return result.composited(over: black).cropped(to: rect)
    }

    private static func shot(cam: Int, track: CMPersistentTrackID, request: AVAsynchronousVideoCompositionRequest, t: Double, plan: RenderPlan) -> CIImage? {
        guard let pb = request.sourceFrame(byTrackID: track), let c = plan.cams[cam] else { return nil }
        let out = plan.size
        var img = CIImage(cvPixelBuffer: pb).oriented(orientation(for: c.rotation))
        img = img.transformed(by: CGAffineTransform(translationX: -img.extent.minX, y: -img.extent.minY))
        let src = img.extent.size
        guard src.width > 0, src.height > 0 else { return nil }

        // fill the frame, then the camera's own framing (zoom + position)
        let zoom = CGFloat(max(1, c.framing.zoom))
        let scale = max(out.width / src.width, out.height / src.height) * zoom
        let w = src.width * scale, h = src.height * scale
        let spareX = (w - out.width) / 2, spareY = (h - out.height) / 2
        let tx = (out.width - w) / 2 - CGFloat(c.framing.x) * spareX
        let ty = (out.height - h) / 2 + CGFloat(c.framing.y) * spareY

        // Lanczos keeps fine detail when scaling (much better than the default bilinear)
        img = img.clampedToExtent()
            .applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1.0])
            .transformed(by: CGAffineTransform(translationX: tx, y: ty))
            .cropped(to: CGRect(origin: .zero, size: out))

        // Recover crispness lost when a shot is enlarged (zoomed in, or 1080p source in a 4K program).
        let enlargement = max(0, Double(scale) - 1)
        let sharp = min(1.4, plan.picture.detail * 0.5 + enlargement * 0.45)
        if sharp > 0.02 {
            let radius = 1.2 + min(1.5, enlargement) * 0.8
            img = img.applyingFilter("CISharpenLuminance", parameters: [kCIInputSharpnessKey: sharp, kCIInputRadiusKey: radius])
                .cropped(to: CGRect(origin: .zero, size: out))
        }

        // look: colour match and exposure, in linear light
        let g = c.gains * (c.exposure * c.steady(at: t))
        if abs(g.x - 1) > 0.002 || abs(g.y - 1) > 0.002 || abs(g.z - 1) > 0.002 {
            img = img.applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: CGFloat(g.x), y: 0, z: 0, w: 0),
                "inputGVector": CIVector(x: 0, y: CGFloat(g.y), z: 0, w: 0),
                "inputBVector": CIVector(x: 0, y: 0, z: CGFloat(g.z), w: 0),
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            ])
        }
        return img
    }

    private static func finish(_ image: CIImage, plan: RenderPlan) -> CIImage {
        var img = image
        let p = plan.picture
        if abs(p.contrast - 1) > 0.005 || abs(p.saturation - 1) > 0.005 {
            img = img.applyingFilter("CIColorControls", parameters: [
                kCIInputSaturationKey: p.saturation, kCIInputContrastKey: p.contrast, kCIInputBrightnessKey: 0,
            ])
        }
        if abs(p.vibrance) > 0.005 {
            img = img.applyingFilter("CIVibrance", parameters: ["inputAmount": p.vibrance])
        }
        return img
    }

    private static func blend(_ a: CIImage, _ b: CIImage, p: Double, kind: TransitionKind, rect: CGRect) -> CIImage {
        let black = CIImage(color: .black).cropped(to: rect)
        func dissolve(_ x: CIImage, _ y: CIImage, _ t: Double) -> CIImage {
            x.applyingFilter("CIDissolveTransition", parameters: [kCIInputTargetImageKey: y, kCIInputTimeKey: t])
        }
        switch kind {
        case .cut:
            return p < 0.5 ? a : b
        case .dissolve:
            return dissolve(a, b, p)
        case .dip:
            return p < 0.5 ? dissolve(a, black, p * 2) : dissolve(black, b, (p - 0.5) * 2)
        case .wipe:
            let feather = rect.width * 0.12
            let edge = CGFloat(p) * (rect.width + feather) - feather
            let mask = CIImage.linearGradient(from: CGPoint(x: edge, y: 0), to: CGPoint(x: edge + feather, y: 0),
                                              color0: .white, color1: .black).cropped(to: rect)
            return b.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: a, kCIInputMaskImageKey: mask])
        case .push:
            let dx = CGFloat(p) * rect.width
            let out = a.transformed(by: CGAffineTransform(translationX: -dx, y: 0))
            let inn = b.transformed(by: CGAffineTransform(translationX: rect.width - dx, y: 0))
            return inn.composited(over: out).cropped(to: rect)
        case .blur:
            let r = sin(Double.pi * p) * 28 * Double(rect.width / 1920)
            func soft(_ x: CIImage) -> CIImage {
                r < 0.3 ? x : x.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: r]).cropped(to: rect)
            }
            return dissolve(soft(a), soft(b), p)
        }
    }
}

private extension CIImage {
    static func linearGradient(from p0: CGPoint, to p1: CGPoint, color0: CIColor, color1: CIColor) -> CIImage {
        let f = CIFilter(name: "CILinearGradient", parameters: [
            "inputPoint0": CIVector(cgPoint: p0), "inputPoint1": CIVector(cgPoint: p1),
            "inputColor0": color0, "inputColor1": color1,
        ])
        return f?.outputImage ?? CIImage(color: color1)
    }
}
