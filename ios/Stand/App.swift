import UIKit
import WebKit
import AVFoundation
import ARKit
import VisionKit

// Stand for iPad: a native shell around the web app in ../www.
// The page is served from the app bundle through a custom URL scheme (stand://app/)
// so ES modules, workers, IndexedDB, microphone and camera all work offline.
// Native extras: catching PDFs while browsing IMSLP, "Open in Stand" from Files,
// the document scanner, and turning pages by winking (face tracking).

let incomingDir: URL = {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Incoming", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}()

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        UIApplication.shared.isIdleTimerDisabled = true   // the screen stays on while you practise
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        if let url = launchOptions?[.url] as? URL { (window.rootViewController as? WebViewController)?.receive(fileAt: url) }
        return true
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        // Plays through the speaker even with the silent switch on, and allows recording.
        try? session.setCategory(.playAndRecord, mode: .default,
                                 options: [.defaultToSpeaker, .allowBluetoothA2DP, .allowAirPlay, .mixWithOthers])
        try? session.setActive(true)
    }

    // "Open in Stand" from Files, Mail or Safari downloads.
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        (window?.rootViewController as? WebViewController)?.receive(fileAt: url)
        return true
    }

    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return .all
    }
}

// Serves files from the bundled "www" folder, and incoming files from the cache folder.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL = Bundle.main.resourceURL!.appendingPathComponent("www", isDirectory: true)

    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json", "webmanifest": "application/manifest+json",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "heic": "image/heic", "svg": "image/svg+xml", "pdf": "application/pdf",
        "bcmap": "application/octet-stream", "pfb": "application/octet-stream", "ttf": "font/ttf", "otf": "font/otf",
        "woff2": "font/woff2", "wasm": "application/wasm",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let base: URL
        let rel: String
        if path.hasPrefix("/__incoming/") {
            base = incomingDir; rel = String(path.dropFirst("/__incoming/".count))
        } else {
            base = root; rel = String(path.dropFirst())
        }
        let file = base.appendingPathComponent(rel).standardizedFileURL
        guard file.path.hasPrefix(base.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            let notFound = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(notFound)
            task.didReceive(Data())
            task.didFinish()
            return
        }
        let mime = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class WebViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, VNDocumentCameraViewControllerDelegate {
    private var webView: WKWebView!
    private var pageReady = false
    private var pending: [[String: Any]] = []
    private let face = FaceTurner()

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "stand")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        for name in ["standShare", "standOpen", "standDone", "standFace", "standScan"] {
            config.userContentController.add(self, name: name)
        }
        let caps = "window.standCaps = { native: true, face: \(FaceTurner.supported), scan: \(VNDocumentCameraViewController.isSupported) };"
        config.userContentController.addUserScript(WKUserScript(source: caps, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        view = webView

        face.onEvent = { [weak self] event in self?.send("standFaceEvent", event) }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Ask for the microphone and camera before the page starts, so the tuner,
        // recorder and video recorder work on the first tap.
        AVAudioSession.sharedInstance().requestRecordPermission { _ in
            AVCaptureDevice.requestAccess(for: .video) { _ in
                DispatchQueue.main.async {
                    self.webView.load(URLRequest(url: URL(string: "stand://app/index.html")!))
                }
            }
        }
        cleanIncoming()
    }

    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    // MARK: talking to the page
    private func send(_ function: String, _ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.\(function) && window.\(function)(\(json))", completionHandler: nil)
    }
    private func deliver(_ msg: [String: Any]) {
        if pageReady { send("standIncoming", msg) } else { pending.append(msg) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        let queued = pending; pending = []
        // give the page a moment to set itself up
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { queued.forEach { self.send("standIncoming", $0) } }
    }

    // MARK: incoming files
    func receive(fileAt url: URL) {
        let secured = url.startAccessingSecurityScopedResource()
        defer { if secured { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        let dest = incomingDir.appendingPathComponent(UUID().uuidString + "-" + name)
        do {
            if FileManager.default.fileExists(atPath: dest.path) { try FileManager.default.removeItem(at: dest) }
            try FileManager.default.copyItem(at: url, to: dest)
        } catch { return }
        deliver(["path": "/__incoming/" + dest.lastPathComponent, "name": name])
    }
    private func cleanIncoming() {
        let files = (try? FileManager.default.contentsOfDirectory(at: incomingDir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        for f in files {
            let date = (try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date.distantPast
            if Date().timeIntervalSince(date) > 3600 { try? FileManager.default.removeItem(at: f) }
        }
    }

    // MARK: messages from the page
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body as? [String: Any] ?? [:]
        switch message.name {
        case "standShare":
            guard let name = body["name"] as? String, let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { return }
            let safe = name.replacingOccurrences(of: "/", with: "-")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
            do { try data.write(to: url, options: .atomic) } catch { return }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let pop = sheet.popoverPresentationController {
                pop.sourceView = view
                pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            present(sheet, animated: true)
        case "standOpen":
            guard let s = body["url"] as? String, let url = URL(string: s) else { return }
            let meta: [String: Any] = ["title": body["title"] as? String ?? "", "composer": body["composer"] as? String ?? ""]
            let browser = IMSLPBrowser(url: url) { [weak self] file, name in
                self?.deliver(["path": "/__incoming/" + file.lastPathComponent, "name": name, "meta": meta])
            }
            let nav = UINavigationController(rootViewController: browser)
            nav.modalPresentationStyle = .pageSheet
            present(nav, animated: true)
        case "standDone":
            if let p = body["path"] as? String, p.hasPrefix("/__incoming/") {
                try? FileManager.default.removeItem(at: incomingDir.appendingPathComponent(String(p.dropFirst("/__incoming/".count))))
            }
        case "standFace":
            face.sensitivity = Float(body["sensitivity"] as? Double ?? 0.55)
            face.test = body["test"] as? Bool ?? false
            if body["on"] as? Bool == true { face.start() } else { face.stop() }
        case "standScan":
            guard VNDocumentCameraViewController.isSupported else { return }
            let scanner = VNDocumentCameraViewController()
            scanner.delegate = self
            present(scanner, animated: true)
        default: break
        }
    }

    // MARK: document scanner
    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        var paths: [String] = []
        for i in 0..<scan.pageCount {
            let image = Self.downscale(scan.imageOfPage(at: i), maxSide: 2400)
            guard let data = image.jpegData(compressionQuality: 0.85) else { continue }
            let name = UUID().uuidString + "-scan\(i + 1).jpg"
            if (try? data.write(to: incomingDir.appendingPathComponent(name))) != nil { paths.append("/__incoming/" + name) }
        }
        let f = DateFormatter(); f.dateFormat = "d MMM yyyy HH.mm"
        controller.dismiss(animated: true) {
            if !paths.isEmpty { self.deliver(["paths": paths, "name": "Scan " + f.string(from: Date()) + ".jpg"]) }
        }
    }
    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { controller.dismiss(animated: true) }
    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { controller.dismiss(animated: true) }
    static func downscale(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let size = image.size
        let k = min(1, maxSide / max(size.width, size.height))
        if k >= 1 { return image }
        let target = CGSize(width: size.width * k, height: size.height * k)
        let format = UIGraphicsImageRendererFormat.default(); format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
    }

    // MARK: web view
    // Microphone and camera for the page: the app already has the system permission.
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let mic = AVAudioSession.sharedInstance().recordPermission == .granted
        let cam = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        switch type {
        case .microphone: decisionHandler(mic ? .grant : .prompt)
        case .camera: decisionHandler(cam ? .grant : .prompt)
        default: decisionHandler(mic && cam ? .grant : .prompt)
        }
    }

    // Links meant for a new tab (IMSLP pages, shops) open in Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased(),
           !["stand", "about", "blob", "data"].contains(scheme),
           navigationAction.targetFrame?.isMainFrame ?? true {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // Reload if the web content process is ever terminated in the background.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        webView.reload()
    }
}

// MARK: - IMSLP browser that catches the PDF
// You browse IMSLP normally (and accept their terms yourself); when a PDF arrives,
// it is saved and handed to Stand, and the sheet closes.
final class IMSLPBrowser: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let start: URL
    private let onFile: (URL, String) -> Void
    private var web: WKWebView!
    private let status = UILabel()
    private var dest: URL?
    private var fileName = "score.pdf"

    init(url: URL, onFile: @escaping (URL, String) -> Void) {
        self.start = url; self.onFile = onFile
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "IMSLP"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(close))
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        status.text = "Accept IMSLP’s terms if asked. The score is added to Stand as soon as the PDF arrives."
        status.font = .preferredFont(forTextStyle: .footnote)
        status.textColor = .secondaryLabel
        status.numberOfLines = 0
        status.textAlignment = .center
        status.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(status); view.addSubview(web)
        NSLayoutConstraint.activate([
            status.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            web.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 8),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        web.load(URLRequest(url: start))
    }
    @objc private func close() { dismiss(animated: true) }

    private func isPDF(_ response: URLResponse) -> Bool {
        let mime = (response.mimeType ?? "").lowercased()
        return mime == "application/pdf" || mime == "application/x-pdf" || (response.url?.pathExtension.lowercased() == "pdf" && mime != "text/html")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if isPDF(navigationResponse.response) { decisionHandler(.download) } else { decisionHandler(.allow) }
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
        status.text = "Downloading…"
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
        status.text = "Downloading…"
    }
    // Links that open a new window stay in this sheet.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        webView.load(navigationAction.request)
        return nil
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        fileName = suggestedFilename.isEmpty ? "score.pdf" : suggestedFilename
        if !fileName.lowercased().hasSuffix(".pdf") { fileName += ".pdf" }
        let url = incomingDir.appendingPathComponent(UUID().uuidString + "-" + fileName)
        dest = url
        completionHandler(url)
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let dest = dest else { return }
        let name = fileName
        DispatchQueue.main.async {
            self.dismiss(animated: true) { self.onFile(dest, name) }
        }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        DispatchQueue.main.async { self.status.text = "The download failed. Tap the download link again." }
    }
}

// MARK: - Turning pages by winking
// Uses ARKit face tracking (front camera, nothing is recorded). A wink is one eye closed while
// the other stays open for a short moment; a normal blink closes both and is ignored.
final class FaceTurner: NSObject, ARSessionDelegate {
    static var supported: Bool { ARFaceTrackingConfiguration.isSupported }
    private let session = ARSession()
    var onEvent: (([String: Any]) -> Void)?
    var sensitivity: Float = 0.55
    var test = false
    private(set) var running = false
    private var candidate: (eye: String, since: TimeInterval)?
    private var locked = false
    private var lastFire: TimeInterval = 0
    private var lastLevels: TimeInterval = 0

    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = DispatchQueue(label: "stand.face")
    }
    func start() {
        guard Self.supported, !running else { return }
        let config = ARFaceTrackingConfiguration()
        config.isLightEstimationEnabled = false
        config.maximumNumberOfTrackedFaces = 1
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        running = true
    }
    func stop() {
        guard running else { return }
        session.pause()
        running = false
        candidate = nil
        locked = false
    }
    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let face = anchors.compactMap({ $0 as? ARFaceAnchor }).first, face.isTracked else { return }
        let left = face.blendShapes[.eyeBlinkLeft]?.floatValue ?? 0
        let right = face.blendShapes[.eyeBlinkRight]?.floatValue ?? 0
        let now = CACurrentMediaTime()
        if test && now - lastLevels > 0.07 {
            lastLevels = now
            emit(["type": "levels", "l": Double(left), "r": Double(right)])
        }
        let closed = max(0.3, min(0.85, 1.15 - sensitivity))   // higher sensitivity = less closing needed
        let open = max(0.12, closed - 0.32)
        if locked {
            if left < open && right < open { locked = false }
            return
        }
        var eye: String?
        if right > closed && left < open { eye = "right" } else if left > closed && right < open { eye = "left" }
        guard let e = eye else { candidate = nil; return }
        if let c = candidate, c.eye == e {
            if now - c.since > 0.14 && now - lastFire > 0.6 {
                lastFire = now; locked = true; candidate = nil
                emit(["type": "wink", "eye": e])
            }
        } else {
            candidate = (e, now)
        }
    }
    func session(_ session: ARSession, didFailWithError error: Error) {
        running = false
        emit(["type": "unsupported"])
    }
    private func emit(_ message: [String: Any]) {
        DispatchQueue.main.async { self.onEvent?(message) }
    }
}
