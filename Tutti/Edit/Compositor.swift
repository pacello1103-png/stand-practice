import AVFoundation
import CoreImage
import Metal
import simd

/// Everything the renderer needs about one camera. Immutable, so it is safe on render threads.
struct CamRender {
    var rotation: Int
    var fills: Bool
    var framing: Framing
    var moves: [FramingKey]
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

    func framing(at t: Double) -> Framing {
        moves.isEmpty ? framing : Framing.at(t - clipStart, base: framing, moves: moves)
    }
}

final class RenderPlan {
    let size: CGSize
    let cams: [Int: CamRender]
    let picture: PictureSettings
    let final: Bool               // full quality (export) or fast (preview)
    let fadeIn: ClosedRange<Double>?
    let fadeOut: ClosedRange<Double>?

    init(size: CGSize, cams: [Int: CamRender], picture: PictureSettings, final: Bool,
         fadeIn: ClosedRange<Double>?, fadeOut: ClosedRange<Double>?) {
        self.size = size
        self.cams = cams
        self.picture = picture
        self.final = final
        self.fadeIn = fadeIn
        self.fadeOut = fadeOut
    }

    static func make(project p: Project, size: CGSize, final: Bool) -> RenderPlan {
        var cams: [Int: CamRender] = [:]
        let pic = p.picture
        let format = p.outputFormat
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
            gains.x *= 1 + 0.10 * c.look.warmth
            gains.z *= 1 - 0.10 * c.look.warmth
            gains.y *= 1 - 0.07 * c.look.tint
            cams[c.cam] = CamRender(rotation: c.rotation, fills: c.fills(format), framing: c.framing, moves: c.moves ?? [],
                                    gains: gains, exposure: exposure, steadyTimes: times, steadyGains: steady, clipStart: c.start)
        }
        let len = min(1.2, (p.end - p.start) / 4)
        let fi: ClosedRange<Double>? = (p.fadeIn ?? false) ? p.start...(p.start + len) : nil
        let fo: ClosedRange<Double>? = (p.fadeOut ?? false) ? (p.end - len)...p.end : nil
        return RenderPlan(size: size, cams: cams, picture: pic, final: final, fadeIn: fi, fadeOut: fo)
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

/// Renders the program: framing, fit/fill, look matching, transitions and fades.
/// The export path uses Lanczos scaling and detail recovery; the preview path is lighter so playback stays smooth.
final class ProgramCompositor: NSObject, AVVideoCompositing {
    private static let context: CIContext = {
        if let device = MTLCreateSystemDefaultDevice() {
            return CIContext(mtlDevice: device, options: [.cacheIntermediates: false, .name: "Tutti"])
        }
        return CIContext(options: [.cacheIntermediates: false])
    }()
    private static let outputSpace = CGColorSpace(name: CGColorSpace.itur_709) ?? CGColorSpaceCreateDeviceRGB()
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
                Self.context.render(image, to: out, bounds: rect, colorSpace: Self.outputSpace)
                CVBufferSetAttachment(out, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
                CVBufferSetAttachment(out, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
                CVBufferSetAttachment(out, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
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
            p = p * p * (3 - 2 * p)
            result = blend(a, b, p: p, kind: ins.kind, rect: rect)
        }
        result = finish(result, plan: plan, t: t)
        return result.composited(over: black).cropped(to: rect)
    }

    private static func scaled(_ img: CIImage, by s: CGFloat, final: Bool) -> CIImage {
        if final {
            return img.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: s, kCIInputAspectRatioKey: 1.0])
        }
        return img.samplingLinear().transformed(by: CGAffineTransform(scaleX: s, y: s))
    }

    private static func shot(cam: Int, track: CMPersistentTrackID, request: AVAsynchronousVideoCompositionRequest, t: Double, plan: RenderPlan) -> CIImage? {
        guard let pb = request.sourceFrame(byTrackID: track), let c = plan.cams[cam] else { return nil }
        let out = plan.size
        let outRect = CGRect(origin: .zero, size: out)
        var src = CIImage(cvPixelBuffer: pb).oriented(orientation(for: c.rotation))
        src = src.transformed(by: CGAffineTransform(translationX: -src.extent.minX, y: -src.extent.minY))
        let sw = src.extent.width, sh = src.extent.height
        guard sw > 0, sh > 0 else { return nil }

        // look: colour match and exposure (Core Image works in linear light)
        let g = c.gains * (c.exposure * c.steady(at: t))
        if abs(g.x - 1) > 0.002 || abs(g.y - 1) > 0.002 || abs(g.z - 1) > 0.002 {
            src = src.applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: CGFloat(g.x), y: 0, z: 0, w: 0),
                "inputGVector": CIVector(x: 0, y: CGFloat(g.y), z: 0, w: 0),
                "inputBVector": CIVector(x: 0, y: 0, z: CGFloat(g.z), w: 0),
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            ])
        }

        let fr = c.framing(at: t)
        let zoom = CGFloat(max(1, fr.zoom))
        let base = c.fills ? max(out.width / sw, out.height / sh) : min(out.width / sw, out.height / sh)
        let scale = base * zoom
        let w = sw * scale, h = sh * scale
        let ctr = fr.center
        var tx = out.width / 2 - CGFloat(ctr.x) * w
        var ty = out.height / 2 - h * (1 - CGFloat(ctr.y))
        tx = w >= out.width ? min(0, max(out.width - w, tx)) : (out.width - w) / 2
        ty = h >= out.height ? min(0, max(out.height - h, ty)) : (out.height - h) / 2

        var img = scaled(src.clampedToExtent(), by: scale, final: plan.final)
            .transformed(by: CGAffineTransform(translationX: tx, y: ty))

        // Recover crispness lost when a shot is enlarged (zoomed in, or a small source in a big film).
        let enlargement = max(0, Double(scale) - 1.03)
        let sharp = min(0.9, plan.picture.detail * 0.6 + enlargement * 0.35)
        if sharp > 0.02 {
            img = img.applyingFilter("CISharpenLuminance", parameters: [
                kCIInputSharpnessKey: sharp, kCIInputRadiusKey: 1.0 + min(1.5, enlargement) * 0.9,
            ])
        }

        if c.fills || (w >= out.width - 1 && h >= out.height - 1) {
            return img.cropped(to: outRect)
        }
        // Fit: the whole picture, on a soft, darkened copy of itself (no black bars).
        let picture = img.cropped(to: CGRect(x: tx, y: ty, width: w, height: h).intersection(outRect))
        let fillScale = max(out.width / sw, out.height / sh) / 8
        let small = src.clampedToExtent().samplingLinear().transformed(by: CGAffineTransform(scaleX: fillScale, y: fillScale))
        let blurred = small.applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 6])
            .transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let bw = sw * fillScale * 8, bh = sh * fillScale * 8
        let bg = blurred.transformed(by: CGAffineTransform(translationX: (out.width - bw) / 2, y: (out.height - bh) / 2))
            .applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: -0.9])
            .applyingFilter("CIColorControls", parameters: [kCIInputBrightnessKey: 0, kCIInputSaturationKey: 0.85, kCIInputContrastKey: 0.92])
            .cropped(to: outRect)
        return picture.composited(over: bg)
    }

    private static func finish(_ image: CIImage, plan: RenderPlan, t: Double) -> CIImage {
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
        var fade = 1.0
        if let r = plan.fadeIn, t < r.upperBound { fade = min(fade, max(0, (t - r.lowerBound) / max(0.01, r.upperBound - r.lowerBound))) }
        if let r = plan.fadeOut, t > r.lowerBound { fade = min(fade, max(0, (r.upperBound - t) / max(0.01, r.upperBound - r.lowerBound))) }
        if fade < 0.999 {
            let k = CGFloat(fade * fade)
            img = img.applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: k, y: 0, z: 0, w: 0),
                "inputGVector": CIVector(x: 0, y: k, z: 0, w: 0),
                "inputBVector": CIVector(x: 0, y: 0, z: k, w: 0),
                "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            ])
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
            let r = sin(Double.pi * p) * 28 * Double(max(rect.width, rect.height) / 1920)
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
