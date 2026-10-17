import AVFoundation
import UIKit
import CoreImage
import Accelerate

struct Lens: Identifiable, Hashable {
    let id: Int
    let label: String       // "0.5", "1", "2", "5"
    let factor: CGFloat     // device zoom factor
    let display: Double     // zoom as people know it (1 = main camera)
}

struct RecordedFile {
    let url: URL
    let firstFrameHost: Double   // local Clock seconds of the first frame
    let duration: Double
    let hasAudio: Bool
}

enum CaptureError: LocalizedError {
    case noCamera, writer(String)
    var errorDescription: String? {
        switch self {
        case .noCamera: return "No camera available."
        case .writer(let s): return s
        }
    }
}

/// Films with the best lens, records HEVC + uncompressed 24-bit sound, and sends small preview frames.
final class CameraEngine: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "tutti.session")
    private let captureQueue = DispatchQueue(label: "tutti.capture", qos: .userInteractive)
    private let previewQueue = DispatchQueue(label: "tutti.preview", qos: .utility)

    private(set) var device: AVCaptureDevice?
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private let videoOut = AVCaptureVideoDataOutput()
    private let audioOut = AVCaptureAudioDataOutput()
    private var coordinator: AVCaptureDevice.RotationCoordinator?
    private var rotationObservers: [NSKeyValueObservation] = []
    private var routeObserver: NSObjectProtocol?

    @Published private(set) var lenses: [Lens] = []
    @Published private(set) var zoomDisplay: Double = 1
    @Published private(set) var isDigitalZoom = false
    @Published private(set) var locked = false
    @Published private(set) var isRecording = false
    @Published private(set) var peak: Float = 0
    @Published private(set) var audioName = ""
    @Published private(set) var stereo = false
    @Published private(set) var running = false
    @Published private(set) var problem: String?
    @Published private(set) var inputGain: Float = 1
    @Published private(set) var inputGainSettable = false

    private(set) var settings = CaptureSettings()
    private var wideFactor: CGFloat = 1
    private var maxZoomFactor: CGFloat = 1
    private var lensList: [Lens] = []      // sessionQueue copy of `lenses`

    /// JPEG preview + its local host time. Called on a background queue.
    var onPreviewFrame: ((Data, Double) -> Void)?
    var previewFPS: Double = 10
    var previewLongSide: CGFloat = 640
    var previewQuality: CGFloat = 0.6

    // recording state — only touched on captureQueue
    private var writer: AVAssetWriter?
    private var vIn: AVAssetWriterInput?
    private var aIn: AVAssetWriterInput?
    private var pendingURL: URL?
    private var startHost = Double.infinity
    private var stopHost = Double.infinity
    private var firstPTS: CMTime?
    private var lastPTS = CMTime.zero
    private var finishing = false
    private var audioFormat: CMFormatDescription?
    private var recordRotation = 0
    private var completion: ((Result<RecordedFile, Error>) -> Void)?
    private(set) var droppedFrames = 0
    private var peakHold: Float = 0
    private var lastPeakPublish = 0.0
    private var lastPreview = 0.0
    private var previewBusy = false
    private var captureAngle: CGFloat = 0
    private lazy var ci = CIContext(options: [.cacheIntermediates: false])

    override init() {
        super.init()
        routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.sessionQueue.async { self?.configureAudioRoute() }
        }
    }

    deinit {
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
    }

    // MARK: - Setup

    func start(settings: CaptureSettings) {
        sessionQueue.async {
            self.configureAudioSession()
            self.apply(settings)
            if !self.session.isRunning { self.session.startRunning() }
            DispatchQueue.main.async { self.running = self.session.isRunning }
        }
    }

    func stopRunning() {
        sessionQueue.async {
            if self.session.isRunning { self.session.stopRunning() }
            DispatchQueue.main.async { self.running = false }
        }
    }

    func update(settings: CaptureSettings) {
        sessionQueue.async {
            guard settings != self.settings else { return }
            if self.writer != nil { return }   // never change format while recording
            self.apply(settings)
        }
    }

    private func apply(_ s: CaptureSettings) {
        let changeCamera = device == nil || s.front != settings.front
        settings = s
        session.beginConfiguration()
        session.automaticallyConfiguresApplicationAudioSession = false
        session.sessionPreset = .inputPriority

        if changeCamera {
            if let v = videoInput { session.removeInput(v); videoInput = nil }
            guard let dev = Self.bestDevice(front: s.front), let input = try? AVCaptureDeviceInput(device: dev), session.canAddInput(input) else {
                session.commitConfiguration()
                DispatchQueue.main.async { self.problem = "This device has no camera Tutti can use." }
                return
            }
            session.addInput(input)
            videoInput = input
            device = dev
        }
        if audioInput == nil, let mic = AVCaptureDevice.default(for: .audio), let input = try? AVCaptureDeviceInput(device: mic), session.canAddInput(input) {
            session.addInput(input)
            audioInput = input
        }
        if !session.outputs.contains(videoOut), session.canAddOutput(videoOut) {
            videoOut.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
            videoOut.alwaysDiscardsLateVideoFrames = false
            videoOut.setSampleBufferDelegate(self, queue: captureQueue)
            session.addOutput(videoOut)
        }
        if !session.outputs.contains(audioOut), session.canAddOutput(audioOut) {
            audioOut.setSampleBufferDelegate(self, queue: captureQueue)
            session.addOutput(audioOut)
        }
        if let dev = device { configureFormat(dev, s) }
        if let conn = videoOut.connection(with: .video) {
            if conn.isVideoStabilizationSupported {
                conn.preferredVideoStabilizationMode = s.stabilization ? .standard : .off
            }
            if conn.isVideoMirroringSupported { conn.isVideoMirrored = false }
        }
        session.commitConfiguration()

        if changeCamera, let dev = device {
            DispatchQueue.main.async { self.makeCoordinator(device: dev, layer: self.previewLayer) }
        }
        if let dev = device {
            let lenses = computeLenses(dev)
            lensList = lenses
            let start = lenses.first(where: { $0.display == 1 })?.factor ?? dev.videoZoomFactor
            setFactor(start, ramp: false)
            DispatchQueue.main.async { self.lenses = lenses }
        }
    }

    static func bestDevice(front: Bool) -> AVCaptureDevice? {
        if front { return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) }
        let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
        let found = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back).devices
        for t in types { if let d = found.first(where: { $0.deviceType == t }) { return d } }
        return AVCaptureDevice.default(for: .video)
    }

    private func configureFormat(_ d: AVCaptureDevice, _ s: CaptureSettings) {
        let fps = Double(s.fps)
        func fits(_ f: AVCaptureDevice.Format, _ w: Int32, _ h: Int32) -> Bool {
            let dims = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
            guard dims.width == w, dims.height == h else { return false }
            guard sub == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange || sub == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange else { return false }
            return f.videoSupportedFrameRateRanges.contains { $0.minFrameRate <= fps + 0.01 && $0.maxFrameRate >= fps - 0.01 }
        }
        func score(_ f: AVCaptureDevice.Format) -> Double {
            var sc = 0.0
            if CMFormatDescriptionGetMediaSubType(f.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange { sc += 4 }
            if f.supportedColorSpaces.contains(.sRGB) { sc += 2 }
            if f.isVideoBinned { sc -= 3 }
            if f.isVideoStabilizationModeSupported(.standard) { sc += 0.5 }
            // prefer the format whose top speed is closest to what we need (less sensor cropping, cooler)
            let maxRate = f.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? fps
            sc -= (maxRate - fps) / 100
            return sc
        }
        let wanted: [(Int32, Int32)] = s.uhd ? [(3840, 2160), (1920, 1080)] : [(1920, 1080), (1280, 720)]
        var chosen: AVCaptureDevice.Format?
        for (w, h) in wanted {
            chosen = d.formats.filter { fits($0, w, h) }.max { score($0) < score($1) }
            if chosen != nil { break }
        }
        guard let format = chosen else { return }
        do {
            try d.lockForConfiguration()
            d.activeFormat = format
            let dur = CMTime(value: 1, timescale: CMTimeScale(s.fps))
            d.activeVideoMinFrameDuration = dur
            d.activeVideoMaxFrameDuration = dur
            if format.supportedColorSpaces.contains(.sRGB) { d.activeColorSpace = .sRGB }
            if format.isVideoHDRSupported {
                d.automaticallyAdjustsVideoHDREnabled = false
                d.isVideoHDREnabled = false
            }
            if d.isSmoothAutoFocusSupported { d.isSmoothAutoFocusEnabled = true }
            if d.isLowLightBoostSupported { d.automaticallyEnablesLowLightBoostWhenAvailable = false }
            d.unlockForConfiguration()
        } catch {}
    }

    // MARK: - Sound

    private func configureAudioSession() {
        let s = AVAudioSession.sharedInstance()
        // .measurement: no automatic gain, no voice processing — the honest sound of the room, right for music.
        try? s.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothA2DP, .mixWithOthers])
        try? s.setPreferredSampleRate(48_000)
        try? s.setActive(true)
        configureAudioRoute()
    }

    private func configureAudioRoute() {
        let s = AVAudioSession.sharedInstance()
        let inputs = s.availableInputs ?? []
        // An external microphone (USB, Lightning, headset) always wins over the built-in one.
        let external = inputs.first { $0.portType != .builtInMic }
        var isStereo = false
        if let ext = external {
            try? s.setPreferredInput(ext)
        } else if let builtIn = inputs.first(where: { $0.portType == .builtInMic }) {
            try? s.setPreferredInput(builtIn)
            // Stereo from the built-in microphones where the device supports it.
            if let source = builtIn.dataSources?.first(where: { ($0.supportedPolarPatterns ?? []).contains(.stereo) }) {
                try? source.setPreferredPolarPattern(.stereo)
                try? builtIn.setPreferredDataSource(source)
                try? s.setPreferredInputOrientation(.landscapeLeft)
                isStereo = source.selectedPolarPattern == .stereo
            }
        }
        let name = s.currentRoute.inputs.first?.portName ?? "Microphone"
        let settable = s.isInputGainSettable
        let gain = s.inputGain
        DispatchQueue.main.async {
            self.audioName = name
            self.stereo = isStereo
            self.inputGainSettable = settable
            self.inputGain = gain
        }
    }

    func setInputGain(_ g: Float) {
        let s = AVAudioSession.sharedInstance()
        guard s.isInputGainSettable else { return }
        try? s.setInputGain(max(0, min(1, g)))
        inputGain = s.inputGain
    }

    // MARK: - Lenses and zoom

    private func computeLenses(_ d: AVCaptureDevice) -> [Lens] {
        let switchOver = d.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        let hasUltra = d.constituentDevices.contains { $0.deviceType == .builtInUltraWideCamera }
        let hasTele = d.constituentDevices.contains { $0.deviceType == .builtInTelephotoCamera }
        let wide: CGFloat = hasUltra ? (switchOver.first ?? 1) : 1
        wideFactor = wide
        var list: [Lens] = []
        if hasUltra { list.append(Lens(id: 0, label: "0.5", factor: 1, display: Double(1 / wide))) }
        list.append(Lens(id: 1, label: "1", factor: wide, display: 1))
        var teleFactor: CGFloat?
        if hasTele {
            if hasUltra, switchOver.count > 1 { teleFactor = switchOver[1] }
            else if !hasUltra { teleFactor = switchOver.first }
        }
        let teleDisplay = teleFactor.map { Double($0 / wide) }
        // 2× from the centre of the main sensor: full quality on 48 MP sensors and still sharp in 1080p.
        if teleDisplay == nil || abs((teleDisplay ?? 0) - 2) > 0.3 {
            list.append(Lens(id: 2, label: "2", factor: wide * 2, display: 2))
        }
        if let tf = teleFactor, let td = teleDisplay {
            let label = td.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(td)) : String(format: "%.1f", td)
            list.append(Lens(id: 3, label: label, factor: tf, display: td))
        }
        let maxLens = list.map(\.factor).max() ?? wide
        // never go further than 2× past the longest lens — beyond that the picture falls apart
        maxZoomFactor = min(d.maxAvailableVideoZoomFactor, maxLens * 2)
        return list.filter { $0.factor <= d.maxAvailableVideoZoomFactor + 0.01 && $0.factor >= d.minAvailableVideoZoomFactor - 0.01 }
    }

    var zoomRange: ClosedRange<Double> {
        let lo = lenses.map(\.display).min() ?? 1
        let hi = Double(maxZoomFactor / max(wideFactor, 0.01))
        return lo...max(lo + 0.01, hi)
    }

    /// Zoom as people know it: 0.5, 1, 2, 5…
    /// `speed`: how fast a smooth zoom travels, in doublings per second (0.3 slow … 4 fast).
    func setZoom(display: Double, ramp: Bool = true, speed: Double = 3) {
        sessionQueue.async { self.setFactor(CGFloat(display) * self.wideFactor, ramp: ramp, rate: Float(speed)) }
    }

    private func setFactor(_ f: CGFloat, ramp: Bool, rate: Float = 3) {
        guard let d = device else { return }
        let factor = max(d.minAvailableVideoZoomFactor, min(f, maxZoomFactor > 1 ? maxZoomFactor : d.maxAvailableVideoZoomFactor))
        do {
            try d.lockForConfiguration()
            if ramp { d.ramp(toVideoZoomFactor: factor, withRate: max(0.1, rate)) } else { d.videoZoomFactor = factor }
            d.unlockForConfiguration()
        } catch { return }
        let display = Double(factor / wideFactor)
        let optical = lensList.contains { abs($0.factor - factor) < 0.02 }
        DispatchQueue.main.async {
            self.zoomDisplay = display
            self.isDigitalZoom = !optical
        }
    }

    // MARK: - Exposure, white balance, focus

    var currentKelvin: Double {
        guard let d = device else { return 0 }
        let v = d.temperatureAndTintValues(for: d.deviceWhiteBalanceGains)
        return Double(v.temperature)
    }

    /// Lock exposure (with a flicker-free shutter), white balance and focus so the picture never pumps.
    func lockLook(_ lock: Bool, kelvin: Double?) {
        sessionQueue.async {
            guard let d = self.device else { return }
            do { try d.lockForConfiguration() } catch { return }
            defer { d.unlockForConfiguration() }
            if lock {
                let fps = Double(self.settings.fps)
                var shutter = self.settings.antiFlicker50 ? (fps <= 50 ? 1.0 / 50 : 1.0 / 100) : 1.0 / (2 * fps)
                let fmt = d.activeFormat
                shutter = max(shutter, fmt.minExposureDuration.seconds)
                shutter = min(shutter, fmt.maxExposureDuration.seconds, 1 / fps)
                let iso = Float(Double(d.iso) * d.exposureDuration.seconds / shutter)
                let clamped = max(fmt.minISO, min(fmt.maxISO, iso))
                if d.isExposureModeSupported(.custom) {
                    d.setExposureModeCustom(duration: CMTime(seconds: shutter, preferredTimescale: 1_000_000), iso: clamped, completionHandler: nil)
                } else if d.isExposureModeSupported(.locked) {
                    d.exposureMode = .locked
                }
                if d.isWhiteBalanceModeSupported(.locked) {
                    if let k = kelvin, k > 1500 {
                        let g = d.deviceWhiteBalanceGains(for: AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(temperature: Float(k), tint: 0))
                        let m = d.maxWhiteBalanceGain
                        let safe = AVCaptureDevice.WhiteBalanceGains(redGain: max(1, min(m, g.redGain)),
                                                                     greenGain: max(1, min(m, g.greenGain)),
                                                                     blueGain: max(1, min(m, g.blueGain)))
                        d.setWhiteBalanceModeLocked(with: safe, completionHandler: nil)
                    } else {
                        d.whiteBalanceMode = .locked
                    }
                }
                if d.isFocusModeSupported(.locked) { d.focusMode = .locked }
            } else {
                if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
                if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
                if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
            }
            DispatchQueue.main.async { self.locked = lock }
        }
    }

    /// Tap to focus and expose on a point (device coordinates 0…1).
    func focus(at point: CGPoint) {
        sessionQueue.async {
            guard let d = self.device else { return }
            do { try d.lockForConfiguration() } catch { return }
            if d.isFocusPointOfInterestSupported {
                d.focusPointOfInterest = point
                d.focusMode = self.locked ? .autoFocus : .continuousAutoFocus
            }
            if !self.locked, d.isExposurePointOfInterestSupported {
                d.exposurePointOfInterest = point
                d.exposureMode = .continuousAutoExposure
            }
            d.unlockForConfiguration()
        }
    }

    // MARK: - Orientation

    private weak var previewLayer: AVCaptureVideoPreviewLayer?

    func attach(previewLayer layer: AVCaptureVideoPreviewLayer) {
        previewLayer = layer
        if let d = device { makeCoordinator(device: d, layer: layer) }
    }

    private func makeCoordinator(device: AVCaptureDevice, layer: AVCaptureVideoPreviewLayer?) {
        rotationObservers.removeAll()
        let rc = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: layer)
        coordinator = rc
        let setPreview: (AVCaptureDevice.RotationCoordinator) -> Void = { rc in
            if let conn = layer?.connection, conn.isVideoRotationAngleSupported(rc.videoRotationAngleForHorizonLevelPreview) {
                conn.videoRotationAngle = rc.videoRotationAngleForHorizonLevelPreview
            }
        }
        setPreview(rc)
        let angle = rc.videoRotationAngleForHorizonLevelCapture
        captureQueue.async { self.captureAngle = angle }
        rotationObservers.append(rc.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { rc, _ in
            DispatchQueue.main.async { setPreview(rc) }
        })
        rotationObservers.append(rc.observe(\.videoRotationAngleForHorizonLevelCapture, options: [.new]) { [weak self] rc, _ in
            let a = rc.videoRotationAngleForHorizonLevelCapture
            self?.captureQueue.async { self?.captureAngle = a }
        })
    }

    // MARK: - Recording

    /// Starts writing at the first frame on or after `atHost` (local Clock seconds).
    func startRecording(to url: URL, atHost: Double, completion: @escaping (Result<RecordedFile, Error>) -> Void) {
        captureQueue.async {
            guard self.writer == nil, self.pendingURL == nil else { return }
            try? FileManager.default.removeItem(at: url)
            self.pendingURL = url
            self.startHost = atHost
            self.stopHost = .infinity
            self.firstPTS = nil
            self.finishing = false
            self.droppedFrames = 0
            self.completion = completion
            self.recordRotation = Int((self.captureAngle / 90).rounded()) * 90 % 360
            DispatchQueue.main.async { self.isRecording = true }
        }
    }

    /// Stops at the first frame on or after `atHost` (or right away).
    func stopRecording(atHost: Double? = nil) {
        captureQueue.async {
            if self.writer == nil {
                // never started (no frames yet)
                if self.pendingURL != nil {
                    self.pendingURL = nil
                    let done = self.completion
                    self.completion = nil
                    DispatchQueue.main.async {
                        self.isRecording = false
                        done?(.failure(CaptureError.writer("The camera had not started yet.")))
                    }
                }
                return
            }
            self.stopHost = atHost ?? Clock.now
            // safety: if frames stop arriving, finish anyway
            self.captureQueue.asyncAfter(deadline: .now() + 1.5) { if self.writer != nil { self.finishWriter() } }
        }
    }

    private func hostSeconds(_ pts: CMTime) -> Double {
        let clock = session.synchronizationClock ?? CMClockGetHostTimeClock()
        return CMSyncConvertTime(pts, from: clock, to: CMClockGetHostTimeClock()).seconds
    }

    private func beginWriter(firstFrame sb: CMSampleBuffer, pts: CMTime) {
        guard let url = pendingURL, let fd = CMSampleBufferGetFormatDescription(sb) else { return }
        pendingURL = nil
        do {
            let w = try AVAssetWriter(outputURL: url, fileType: .mov)
            let dims = CMVideoFormatDescriptionGetDimensions(fd)
            let fps = settings.fps
            let pixels = Double(dims.width) * Double(dims.height)
            // generous bitrates (above the built-in Camera app) — the edit is rendered from these files
            let bitrate = Int((pixels >= 3840 * 2160 ? 50_000_000 : 20_000_000) * max(1, Double(fps) / 30).squareRoot())
            let compression: [String: Any] = [
                AVVideoAverageBitRateKey: bitrate,
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoMaxKeyFrameIntervalKey: fps,
                AVVideoAllowFrameReorderingKey: true,
            ]
            let vs: [String: Any] = [
                AVVideoCodecKey: AVVideoCodecType.hevc,
                AVVideoWidthKey: Int(dims.width),
                AVVideoHeightKey: Int(dims.height),
                AVVideoCompressionPropertiesKey: compression,
                AVVideoColorPropertiesKey: [
                    AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                    AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                    AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
                ],
            ]
            let v = AVAssetWriterInput(mediaType: .video, outputSettings: vs)
            v.expectsMediaDataInRealTime = true
            v.transform = CGAffineTransform(rotationAngle: CGFloat(recordRotation) * .pi / 180)
            guard w.canAdd(v) else { throw CaptureError.writer("Can't record video in this format.") }
            w.add(v)

            if let afd = audioFormat, let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(afd)?.pointee {
                let ch = Int(min(2, max(1, asbd.mChannelsPerFrame)))
                var layout = AudioChannelLayout()
                layout.mChannelLayoutTag = ch == 2 ? kAudioChannelLayoutTag_Stereo : kAudioChannelLayoutTag_Mono
                let layoutData = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
                let aset: [String: Any] = [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVSampleRateKey: asbd.mSampleRate > 0 ? asbd.mSampleRate : 48_000,
                    AVNumberOfChannelsKey: ch,
                    AVLinearPCMBitDepthKey: 24,
                    AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false,
                    AVLinearPCMIsNonInterleaved: false,
                    AVChannelLayoutKey: layoutData,
                ]
                let a = AVAssetWriterInput(mediaType: .audio, outputSettings: aset)
                a.expectsMediaDataInRealTime = true
                if w.canAdd(a) { w.add(a); aIn = a }
            }
            guard w.startWriting() else { throw w.error ?? CaptureError.writer("Could not start recording.") }
            w.startSession(atSourceTime: pts)
            writer = w
            vIn = v
            firstPTS = pts
            lastPTS = pts
        } catch {
            let done = completion
            completion = nil
            DispatchQueue.main.async {
                self.isRecording = false
                done?(.failure(error))
            }
        }
    }

    private func finishWriter() {
        guard let w = writer, !finishing, let first = firstPTS else { return }
        finishing = true
        let frame = CMTime(value: 1, timescale: CMTimeScale(settings.fps))
        let end = lastPTS + frame
        vIn?.markAsFinished()
        aIn?.markAsFinished()
        w.endSession(atSourceTime: end)
        let url = w.outputURL
        let firstHost = hostSeconds(first)
        let duration = (end - first).seconds
        let hasAudio = aIn != nil
        let done = completion
        completion = nil
        w.finishWriting {
            self.captureQueue.async {
                self.writer = nil
                self.vIn = nil
                self.aIn = nil
                self.firstPTS = nil
                self.finishing = false
                let ok = w.status == .completed
                let err = w.error
                DispatchQueue.main.async {
                    self.isRecording = false
                    if ok {
                        done?(.success(RecordedFile(url: url, firstFrameHost: firstHost, duration: duration, hasAudio: hasAudio)))
                    } else {
                        done?(.failure(err ?? CaptureError.writer("The recording could not be saved.")))
                    }
                }
            }
        }
    }

    // MARK: - Preview frames

    private func sendPreview(_ pb: CVPixelBuffer, host: Double) {
        guard let cb = onPreviewFrame else { return }
        let rotation = Int((captureAngle / 90).rounded()) * 90 % 360
        previewBusy = true
        previewQueue.async {
            autoreleasepool {
                var img = CIImage(cvPixelBuffer: pb).oriented(orientation(for: rotation))
                let scale = min(1, self.previewLongSide / max(img.extent.width, img.extent.height))
                img = img.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1.0])
                let cs = CGColorSpace(name: CGColorSpace.sRGB)!
                let q = kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption
                if let jpeg = self.ci.jpegRepresentation(of: img, colorSpace: cs, options: [q: self.previewQuality]) {
                    cb(jpeg, host)
                }
            }
            self.captureQueue.async { self.previewBusy = false }
        }
    }

    // MARK: - Levels

    private func measurePeak(_ sb: CMSampleBuffer) -> Float {
        guard let fd = CMSampleBufferGetFormatDescription(sb),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd)?.pointee else { return 0 }
        let abl = AudioBufferList.allocate(maximumBuffers: 8)
        defer { free(abl.unsafeMutablePointer) }
        var block: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sb, bufferListSizeNeededOut: nil, bufferListOut: abl.unsafeMutablePointer,
            bufferListSize: AudioBufferList.sizeInBytes(maximumBuffers: 8),
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
        guard status == noErr else { return 0 }
        let isFloat = asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
        let bits = asbd.mBitsPerChannel
        var peak: Float = 0
        for buf in abl {
            guard let p = buf.mData else { continue }
            let bytes = Int(buf.mDataByteSize)
            if isFloat && bits == 32 {
                let n = bytes / 4
                var m: Float = 0
                vDSP_maxmgv(p.assumingMemoryBound(to: Float.self), 1, &m, vDSP_Length(n))
                peak = max(peak, m)
            } else if bits == 16 {
                let n = bytes / 2
                let s = p.assumingMemoryBound(to: Int16.self)
                var m: Int32 = 0
                for i in stride(from: 0, to: n, by: 2) { m = max(m, abs(Int32(s[i]))) }
                peak = max(peak, Float(m) / 32768)
            } else if bits == 32 {
                let n = bytes / 4
                let s = p.assumingMemoryBound(to: Int32.self)
                var m: Int64 = 0
                for i in stride(from: 0, to: n, by: 2) { m = max(m, abs(Int64(s[i]))) }
                peak = max(peak, Float(Double(m) / 2147483648))
            }
        }
        return peak
    }
}

func orientation(for rotation: Int) -> CGImagePropertyOrientation {
    switch ((rotation % 360) + 360) % 360 {
    case 90: return .right
    case 180: return .down
    case 270: return .left
    default: return .up
    }
}

extension CameraEngine: AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if output === videoOut { handleVideo(sampleBuffer) } else { handleAudio(sampleBuffer) }
    }

    func captureOutput(_ output: AVCaptureOutput, didDrop sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if output === videoOut, writer != nil { droppedFrames += 1 }
    }

    private func handleVideo(_ sb: CMSampleBuffer) {
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        let host = hostSeconds(pts)

        if !previewBusy, onPreviewFrame != nil, host - lastPreview >= 1 / previewFPS - 0.004, let pb = CMSampleBufferGetImageBuffer(sb) {
            lastPreview = host
            sendPreview(pb, host: host)
        }

        if pendingURL != nil, writer == nil, host >= startHost - 0.0005 {
            beginWriter(firstFrame: sb, pts: pts)
        }
        guard let w = writer, w.status == .writing, !finishing, let v = vIn else { return }
        if host >= stopHost {
            finishWriter()
            return
        }
        if v.isReadyForMoreMediaData {
            if v.append(sb) { lastPTS = pts } else { droppedFrames += 1 }
        } else {
            droppedFrames += 1
        }
    }

    private func handleAudio(_ sb: CMSampleBuffer) {
        if let fd = CMSampleBufferGetFormatDescription(sb) { audioFormat = fd }
        let p = measurePeak(sb)
        peakHold = max(peakHold * 0.92, p)
        let now = Clock.now
        if now - lastPeakPublish > 0.08 {
            lastPeakPublish = now
            let v = peakHold
            DispatchQueue.main.async { self.peak = v }
        }
        guard let w = writer, w.status == .writing, !finishing, let a = aIn, let first = firstPTS else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        let end = pts + CMSampleBufferGetDuration(sb)
        guard end > first else { return }
        if a.isReadyForMoreMediaData { a.append(sb) }
    }
}
