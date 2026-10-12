import UIKit
import AVFoundation
import Vision
import CoreImage

/// The page scanner. A live view with the page outlined. When the page has been held still for
/// one second a ring fills and the page is captured by itself; the shutter button does it at once.
/// Each page is straightened (perspective) and saved as a JPEG; the web review then cleans it.
final class PageScanner: UIViewController, AVCapturePhotoCaptureDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {
    var onFinish: (([URL]) -> Void)?

    static var available: Bool {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
    }

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "stand.scan.session")
    private let videoQueue = DispatchQueue(label: "stand.scan.video")
    private let stillOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private lazy var preview = AVCaptureVideoPreviewLayer(session: session)

    private let outline = CAShapeLayer()
    private let ring = CAShapeLayer()
    private let flash = UIView()
    private let hint = UILabel()
    private let counter = UILabel()
    private let shutter = UIButton(type: .custom)
    private let closeButton = UIButton(type: .custom)
    private let doneButton = UIButton(type: .system)

    // detection state (main queue)
    private var quad: [CGPoint]?                 // page corners, upright, normalized, TL TR BR BL
    private var imageSize = CGSize(width: 3, height: 4)
    private var stableSince: CFTimeInterval?
    private var noPageSince: CFTimeInterval?
    private var lastCaptured: [CGPoint]?
    private var captureCooldown: CFTimeInterval = 0
    private var inFlight = false

    // detection runs on the video queue; these are only touched there
    private var lastFrame: CFTimeInterval = 0

    private let work = DispatchGroup()
    private var pages: [URL] = []

    private static let ciContext = CIContext()

    // MARK: view

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)

        outline.fillColor = UIColor.clear.cgColor
        outline.strokeColor = UIColor(red: 0.45, green: 0.95, blue: 0.65, alpha: 1).cgColor
        outline.lineWidth = 3
        outline.lineJoin = .round
        view.layer.addSublayer(outline)

        ring.frame = CGRect(x: 0, y: 0, width: 80, height: 80)
        ring.path = UIBezierPath(arcCenter: CGPoint(x: 40, y: 40), radius: 34, startAngle: -.pi / 2, endAngle: 1.5 * .pi, clockwise: true).cgPath
        ring.fillColor = UIColor.clear.cgColor
        ring.strokeColor = UIColor.white.cgColor
        ring.lineWidth = 5
        ring.lineCap = .round
        ring.strokeEnd = 0
        view.layer.addSublayer(ring)

        let symbol = UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold))
        closeButton.setImage(symbol, for: .normal)
        closeButton.tintColor = .white
        closeButton.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        closeButton.layer.cornerRadius = 20
        closeButton.accessibilityLabel = "Close scanner"
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(closeButton)

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneButton.tintColor = .white
        doneButton.isEnabled = false
        doneButton.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)
        view.addSubview(doneButton)

        hint.text = "Show a page to scan"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 15, weight: .semibold)
        hint.textAlignment = .center
        hint.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        hint.layer.cornerRadius = 14
        hint.clipsToBounds = true
        view.addSubview(hint)

        counter.textColor = .white
        counter.font = .systemFont(ofSize: 14, weight: .semibold)
        counter.textAlignment = .center
        counter.isHidden = true
        view.addSubview(counter)

        shutter.backgroundColor = .white
        shutter.layer.borderWidth = 5
        shutter.layer.borderColor = UIColor(white: 0.85, alpha: 1).cgColor
        shutter.accessibilityLabel = "Scan this page"
        shutter.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
        view.addSubview(shutter)

        flash.backgroundColor = .white
        flash.alpha = 0
        flash.isUserInteractionEnabled = false
        view.addSubview(flash)
    }

    override var prefersStatusBarHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview.frame = view.bounds
        let top = view.safeAreaInsets.top + 8
        let bottom = view.safeAreaInsets.bottom
        closeButton.frame = CGRect(x: 16, y: top, width: 40, height: 40)
        let dw = doneButton.sizeThatFits(.zero).width + 8
        doneButton.frame = CGRect(x: view.bounds.width - dw - 16, y: top, width: dw, height: 40)
        let hw = min(view.bounds.width - 140, 340)
        hint.frame = CGRect(x: (view.bounds.width - hw) / 2, y: top + 52, width: hw, height: 30)
        shutter.frame = CGRect(x: (view.bounds.width - 76) / 2, y: view.bounds.height - bottom - 40 - 76, width: 76, height: 76)
        shutter.layer.cornerRadius = 38
        counter.frame = CGRect(x: 0, y: shutter.frame.minY - 30, width: view.bounds.width, height: 22)
        flash.frame = view.bounds
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        AVCaptureDevice.requestAccess(for: .video) { ok in
            DispatchQueue.main.async {
                if ok { self.startSession() } else { self.fail("Stand needs the camera to scan pages. You can allow it in Settings.") }
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
    }

    // MARK: camera

    private func startSession() {
        sessionQueue.async {
            guard !self.session.isRunning, self.session.inputs.isEmpty else { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .photo
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                  let input = try? AVCaptureDeviceInput(device: device), self.session.canAddInput(input) else {
                self.session.commitConfiguration()
                DispatchQueue.main.async { self.fail("No camera was found.") }
                return
            }
            self.session.addInput(input)
            if self.session.canAddOutput(self.stillOutput) { self.session.addOutput(self.stillOutput) }
            self.videoOutput.alwaysDiscardsLateVideoFrames = true
            self.videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            self.videoOutput.setSampleBufferDelegate(self, queue: self.videoQueue)
            if self.session.canAddOutput(self.videoOutput) { self.session.addOutput(self.videoOutput) }
            self.session.commitConfiguration()

            if (try? device.lockForConfiguration()) != nil {
                if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
                if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
                device.unlockForConfiguration()
            }
            self.session.startRunning()
            DispatchQueue.main.async { self.setPreviewUpright() }
        }
    }

    private func setPreviewUpright() {
        guard let connection = preview.connection else { return }
        if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
        } else if connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
    }

    // MARK: live detection (video queue)

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard now - lastFrame > 0.2, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastFrame = now
        let w = CVPixelBufferGetWidth(pixels), h = CVPixelBufferGetHeight(pixels)

        let request = VNDetectDocumentSegmentationRequest()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .right, options: [:])
        try? handler.perform([request])

        var corners: [CGPoint]?
        if let page = request.results?.first, page.confidence > 0.5,
           page.boundingBox.width * page.boundingBox.height > 0.12 {
            corners = [page.topLeft, page.topRight, page.bottomRight, page.bottomLeft]
        }
        // upright image: the buffer is turned a quarter turn
        let upright = CGSize(width: h, height: w)
        DispatchQueue.main.async { self.track(corners, upright: upright, now: now) }
    }

    // MARK: steady-page logic (main queue)

    private func track(_ corners: [CGPoint]?, upright: CGSize, now: CFTimeInterval) {
        imageSize = upright
        guard let c = corners else {
            quad = nil
            stableSince = nil
            outline.path = nil
            ring.removeAnimation(forKey: "ring")
            ring.strokeEnd = 0
            if noPageSince == nil { noPageSince = now }
            if let gone = noPageSince, now - gone > 1 { lastCaptured = nil }
            setHint(inFlight ? nil : "Show a page to scan")
            return
        }
        noPageSince = nil

        let moved = quad.map { distance($0, c) } ?? 1
        quad = c

        let path = UIBezierPath()
        let points = c.map(toView)
        path.move(to: points[0])
        for p in points.dropFirst() { path.addLine(to: p) }
        path.close()
        let centre = CGPoint(x: points.map(\.x).reduce(0, +) / 4, y: points.map(\.y).reduce(0, +) / 4)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        outline.path = path.cgPath
        ring.position = centre
        CATransaction.commit()

        if moved > 0.02 || stableSince == nil {
            stableSince = now
            ring.removeAnimation(forKey: "ring")
            ring.strokeEnd = 0
            let grow = CABasicAnimation(keyPath: "strokeEnd")
            grow.fromValue = 0
            grow.toValue = 1
            grow.duration = 1.0
            grow.timingFunction = CAMediaTimingFunction(name: .linear)
            grow.fillMode = .forwards
            grow.isRemovedOnCompletion = false
            ring.add(grow, forKey: "ring")
        }

        let steady = now - (stableSince ?? now)
        let isNewPage = lastCaptured.map { distance($0, c) > 0.06 } ?? true
        if steady >= 1.0, now > captureCooldown, isNewPage, !inFlight {
            lastCaptured = c
            captureCooldown = now + 1.5
            shoot()
            return
        }
        if !isNewPage && !inFlight {
            setHint("Got it. Turn the page for the next one")
        } else {
            setHint(steady > 0.25 ? "Hold still…" : "Page found")
        }
    }

    private func setHint(_ text: String?) {
        guard let text else { return }
        if hint.text != text { hint.text = text }
    }

    // MARK: capture

    @objc private func shutterTapped() {
        shoot()
    }

    private func shoot() {
        guard !inFlight, session.isRunning else { return }
        inFlight = true
        work.enter()
        flashNow()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        stillOutput.capturePhoto(with: AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg]), delegate: self)
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let data = error == nil ? photo.fileDataRepresentation() : nil
        DispatchQueue.global(qos: .userInitiated).async {
            let url = data.flatMap { PageScanner.straighten($0) }
            DispatchQueue.main.async {
                self.inFlight = false
                if let url {
                    self.pages.append(url)
                    self.counter.isHidden = false
                    self.counter.text = self.pages.count == 1 ? "1 page" : "\(self.pages.count) pages"
                    self.doneButton.isEnabled = true
                    self.setHint("Got it. Turn the page for the next one")
                }
                self.work.leave()
            }
        }
    }

    /// Straightens the page (perspective), keeps it sharp and writes a JPEG into the incoming folder.
    private static func straighten(_ data: Data) -> URL? {
        guard var image = CIImage(data: data, options: [.applyOrientationProperty: true]) else { return nil }
        let box = image.extent
        let request = VNDetectDocumentSegmentationRequest()
        try? VNImageRequestHandler(ciImage: image, options: [:]).perform([request])
        if let page = request.results?.first, page.confidence > 0.3,
           let filter = CIFilter(name: "CIPerspectiveCorrection") {
            func at(_ p: CGPoint) -> CIVector {
                CIVector(x: box.minX + p.x * box.width, y: box.minY + p.y * box.height)
            }
            filter.setValue(image, forKey: kCIInputImageKey)
            filter.setValue(at(page.topLeft), forKey: "inputTopLeft")
            filter.setValue(at(page.topRight), forKey: "inputTopRight")
            filter.setValue(at(page.bottomLeft), forKey: "inputBottomLeft")
            filter.setValue(at(page.bottomRight), forKey: "inputBottomRight")
            if let out = filter.outputImage { image = out }
        }
        let longest = max(image.extent.width, image.extent.height)
        let k = min(1, 2400 / longest)
        if k < 1 { image = image.transformed(by: CGAffineTransform(scaleX: k, y: k)) }
        guard let jpeg = ciContext.jpegRepresentation(
            of: image,
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.9]
        ) else { return nil }
        let url = incomingDir.appendingPathComponent(UUID().uuidString + "-scan.jpg")
        do { try jpeg.write(to: url); return url } catch { return nil }
    }

    private func flashNow() {
        flash.layer.removeAllAnimations()
        flash.alpha = 0.6
        UIView.animate(withDuration: 0.35) { self.flash.alpha = 0 }
    }

    // MARK: leaving

    @objc private func closeTapped() {
        if pages.isEmpty {
            finish(keep: false)
            return
        }
        let alert = UIAlertController(title: "Leave the scanner?",
                                      message: "The \(pages.count) scanned page\(pages.count == 1 ? "" : "s") will be thrown away.",
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Keep scanning", style: .cancel))
        alert.addAction(UIAlertAction(title: "Discard", style: .destructive) { _ in self.finish(keep: false) })
        present(alert, animated: true)
    }

    @objc private func doneTapped() {
        doneButton.isEnabled = false
        // wait for a capture that is still being straightened
        work.notify(queue: .main) { self.finish(keep: true) }
    }

    private func finish(keep: Bool) {
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
        let result = keep ? pages : []
        if !keep { pages.forEach { try? FileManager.default.removeItem(at: $0) } }
        dismiss(animated: true) {
            if keep && !result.isEmpty { self.onFinish?(result) }
        }
    }

    private func fail(_ message: String) {
        let alert = UIAlertController(title: "Scanner", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in self.finish(keep: false) })
        present(alert, animated: true)
    }

    // MARK: geometry

    /// Upright normalized point (origin bottom-left) to a point on screen, matching the aspect-fill preview.
    private func toView(_ n: CGPoint) -> CGPoint {
        let b = view.bounds.size
        let s = max(b.width / imageSize.width, b.height / imageSize.height)
        let dw = imageSize.width * s, dh = imageSize.height * s
        return CGPoint(x: (b.width - dw) / 2 + n.x * dw, y: (b.height - dh) / 2 + (1 - n.y) * dh)
    }

    private func distance(_ a: [CGPoint], _ b: [CGPoint]) -> CGFloat {
        zip(a, b).map { p in hypot(p.0.x - p.1.x, p.0.y - p.1.y) }.max() ?? 1
    }
}
