import UIKit
import WebKit
import AVFoundation

// Stand for iPad: a native shell around the web app in ../www.
// The page is served from the app bundle through a custom URL scheme (stand://app/)
// so ES modules, workers, IndexedDB, microphone and camera all work offline.

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
        return true
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        // Plays through the speaker even with the silent switch on, and allows recording.
        try? session.setCategory(.playAndRecord, mode: .default,
                                 options: [.defaultToSpeaker, .allowBluetoothA2DP, .allowAirPlay])
        try? session.setActive(true)
    }

    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return .all
    }
}

// Serves files from the bundled "www" folder.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL = Bundle.main.resourceURL!.appendingPathComponent("www", isDirectory: true)

    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json", "webmanifest": "application/manifest+json",
        "png": "image/png", "jpg": "image/jpeg", "svg": "image/svg+xml", "pdf": "application/pdf",
        "bcmap": "application/octet-stream", "pfb": "application/octet-stream", "ttf": "font/ttf", "otf": "font/otf",
        "wasm": "application/wasm",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
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

final class WebViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "stand")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.userContentController.add(self, name: "standShare")
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
    }

    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

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

    // Links meant for a new tab (IMSLP downloads, IMSLP pages) open in Safari.
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

    // window.webkit.messageHandlers.standShare.postMessage({ name, data: base64 })
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "standShare",
              let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              let b64 = body["data"] as? String,
              let data = Data(base64Encoded: b64) else { return }
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
    }

    // Reload if the web content process is ever terminated in the background.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
