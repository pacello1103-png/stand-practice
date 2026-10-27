// StandNativeExtras.swift
// The direct link between the iPad and the iPhone apps (MultipeerConnectivity: the way AirDrop finds
// devices — same Wi-Fi, or just nearby over Apple's peer-to-peer Wi-Fi; no internet, no codes).
// Everything the camera link and the practice sharing need goes through it:
//   • small messages (JSON strings), reliable
//   • live preview frames (JPEG), sent one at a time (the next one goes when the iPad has shown the last)
//   • whole files (the finished video), with progress
// The web app checks window.standCaps.peer and falls back to its own internet route when it is missing.
//
// Setup: StandNativeExtras.shared.install(on: webView) right after the WKWebView is created, and
// NSBonjourServices = ["_stand-link._tcp", "_stand-link._udp"] in Info.plist (NSLocalNetworkUsageDescription
// is already there).

import Foundation
import UIKit
import WebKit
import MultipeerConnectivity

final class StandNativeExtras: NSObject {
    static let shared = StandNativeExtras()

    private weak var webView: WKWebView?
    private let serviceType = "stand-link"          // must match NSBonjourServices
    private let token = UUID().uuidString           // decides which side invites (only one does)
    private var peerID: MCPeerID?
    private var session: MCSession?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var invited = [MCPeerID: Date]()
    private var displayName = "Stand"
    private var lastInvitation = Date.distantPast

    // files being written from the page, then sent
    private var outFiles = [String: (url: URL, handle: FileHandle, meta: [String: Any])]()
    private var progressObservers = [String: NSKeyValueObservation]()

    func install(on webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "standPeer")
        ucc.add(WeakScriptHandler(self), name: "standPeer")
        let caps = "window.standCaps = Object.assign(window.standCaps || {}, { peer: 3 });"   // 3: file pieces are acknowledged
        ucc.addUserScript(WKUserScript(source: caps, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.evaluateJavaScript(caps, completionHandler: nil)
        // reminders for the practice plan (StandReminders.swift)
        StandReminders.shared.install(on: webView)
        // sound and microphone after the background, a call or an audio reset (StandAudioKeeper.swift)
        StandAudioKeeper.shared.install(on: webView)
        NotificationCenter.default.addObserver(self, selector: #selector(appActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    // MARK: - JavaScript helpers

    private func js(_ source: String) {
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript(source, completionHandler: nil) }
    }
    private func jsValue(_ v: Any?) -> String {
        guard let v = v, let data = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]),
              let out = String(data: data, encoding: .utf8) else { return "null" }
        return out
    }

    // MARK: - Messages from the page

    private func handle(_ op: String, _ body: [String: Any]) {
        switch op {
        case "start":
            startPeer(name: (body["name"] as? String) ?? UIDevice.current.name)
        case "stop":
            stopPeer()
        case "send":
            guard let str = body["data"] as? String, let data = ("J" + str).data(using: .utf8) else { return }
            send(data, mode: .reliable)
        case "frame":
            // a JPEG preview frame, base64
            guard let b64 = body["data"] as? String, let jpeg = Data(base64Encoded: b64) else { return }
            var data = Data([UInt8(ascii: "F")]); data.append(jpeg)
            send(data, mode: .reliable)
        case "fileBegin":
            guard let id = body["id"] as? String else { return }
            let ext = ((body["ext"] as? String) ?? "bin").filter { $0.isLetter || $0.isNumber }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("out-" + id + "." + ext)
            FileManager.default.createFile(atPath: url.path, contents: nil)
            guard let h = try? FileHandle(forWritingTo: url) else { reportFile(id, error: "Could not prepare the file."); return }
            outFiles[id] = (url, h, (body["meta"] as? [String: Any]) ?? [:])
        case "fileChunk":
            guard let id = body["id"] as? String, let f = outFiles[id], let b64 = body["data"] as? String, let d = Data(base64Encoded: b64) else { return }
            f.handle.write(d)
            // the page sends the next piece only when this one is written (a long video never piles up in memory)
            js("window.standPeerChunkOk && window.standPeerChunkOk(\(jsValue(id)))")
        case "fileEnd":
            guard let id = body["id"] as? String, let f = outFiles.removeValue(forKey: id) else { return }
            try? f.handle.close()
            sendFile(id: id, url: f.url, meta: f.meta)
        default:
            break
        }
    }

    private func send(_ data: Data, mode: MCSessionSendDataMode) {
        guard let s = session, !s.connectedPeers.isEmpty else { return }
        do { try s.send(data, toPeers: s.connectedPeers, with: mode) } catch { }
    }

    private func sendFile(id: String, url: URL, meta: [String: Any]) {
        guard let s = session, let peer = s.connectedPeers.first else { reportFile(id, error: "The iPad is not connected."); return }
        var m = meta; m["id"] = id; m["ext"] = url.pathExtension
        let name = jsValue(m)
        let progress = s.sendResource(at: url, withName: name, toPeer: peer) { [weak self] error in
            DispatchQueue.main.async {
                self?.progressObservers.removeValue(forKey: id)
                try? FileManager.default.removeItem(at: url)
                if let e = error { self?.reportFile(id, error: e.localizedDescription) }
                else { self?.js("window.standPeerSent && window.standPeerSent(\(self?.jsValue(id) ?? "null"), null)") }
            }
        }
        if let p = progress {
            progressObservers[id] = p.observe(\.fractionCompleted, options: [.new]) { [weak self] p, _ in
                let f = p.fractionCompleted
                self?.js("window.standPeerProgress && window.standPeerProgress(\(self?.jsValue(id) ?? "null"), \(f), 'out')")
            }
        }
    }
    private func reportFile(_ id: String, error: String) {
        js("window.standPeerSent && window.standPeerSent(\(jsValue(id)), \(jsValue(error)))")
    }

    // MARK: - The link

    private func startPeer(name: String) {
        displayName = String(name.prefix(50))
        if session != nil { reportPeers(); restartDiscovery(); return }
        let id = Self.savedPeerID(displayName)
        // (always encrypted, the same on both sides: "optional" made the two sometimes argue and drop)
        let s = MCSession(peer: id, securityIdentity: nil, encryptionPreference: .required)
        s.delegate = self
        peerID = id
        session = s
        let adv = MCNearbyServiceAdvertiser(peer: id, discoveryInfo: ["app": "stand", "t": token], serviceType: serviceType)
        adv.delegate = self
        advertiser = adv
        let br = MCNearbyServiceBrowser(peer: id, serviceType: serviceType)
        br.delegate = self
        browser = br
        adv.startAdvertisingPeer()
        br.startBrowsingForPeers()
    }

    // The same identity every time (Apple's advice): a new one each start left the other device
    // seeing an old "ghost" of this one, and the two then failed to connect, or dropped.
    private static func savedPeerID(_ name: String) -> MCPeerID {
        let d = UserDefaults.standard
        if let data = d.data(forKey: "standPeerID"), d.string(forKey: "standPeerName") == name,
           let id = try? NSKeyedUnarchiver.unarchivedObject(ofClass: MCPeerID.self, from: data) { return id }
        let id = MCPeerID(displayName: name)
        if let data = try? NSKeyedArchiver.archivedData(withRootObject: id, requiringSecureCoding: true) {
            d.set(data, forKey: "standPeerID"); d.set(name, forKey: "standPeerName")
        }
        return id
    }

    private func stopPeer() {
        advertiser?.stopAdvertisingPeer(); advertiser = nil
        browser?.stopBrowsingForPeers(); browser = nil
        session?.disconnect(); session = nil
        invited.removeAll()
        reportPeers()
    }

    // looking again makes the other device show up again (after a drop, or coming back to the app)
    private func restartDiscovery() {
        DispatchQueue.main.async {
            self.invited = self.invited.filter { Date().timeIntervalSince($0.value) < 20 }
            self.browser?.stopBrowsingForPeers()
            self.advertiser?.stopAdvertisingPeer()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                self.advertiser?.startAdvertisingPeer()
                self.browser?.startBrowsingForPeers()
            }
        }
    }

    private func reportPeers() {
        let s = session
        let n = s?.connectedPeers.count ?? 0
        let names = s?.connectedPeers.map { $0.displayName } ?? []
        js("window.standPeerState && window.standPeerState(\(n), \(jsValue(names)))")
    }

    @objc private func appBackground() {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
    }
    @objc private func appActive() {
        guard session != nil else { return }
        restartDiscovery()
    }
}

// MARK: - WKScriptMessageHandler

extension StandNativeExtras: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        if message.name == "standPeer" { handle(op, body) }
    }
}

/// Keeps WKUserContentController from holding StandNativeExtras strongly.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

// MARK: - MCSessionDelegate

extension StandNativeExtras: MCSessionDelegate {
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        reportPeers()
        if state == .notConnected {
            DispatchQueue.main.async { self.invited.removeValue(forKey: peerID) }
            // find each other again by itself
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                guard let self = self, self.session === session, session.connectedPeers.isEmpty else { return }
                self.restartDiscovery()
            }
        }
    }
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard let kind = data.first else { return }
        if kind == UInt8(ascii: "J") {
            guard let str = String(data: data.dropFirst(), encoding: .utf8) else { return }
            js("window.standPeerMessage && window.standPeerMessage(\(jsValue(str)))")
        } else if kind == UInt8(ascii: "F") {
            let b64 = data.dropFirst().base64EncodedString()
            js("window.standPeerFrame && window.standPeerFrame('\(b64)')")
        }
    }
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {
        let meta = (try? JSONSerialization.jsonObject(with: Data(resourceName.utf8))) as? [String: Any] ?? [:]
        let id = (meta["id"] as? String) ?? ""
        DispatchQueue.main.async {
            self.progressObservers["in-" + id] = progress.observe(\.fractionCompleted, options: [.new]) { [weak self] p, _ in
                self?.js("window.standPeerProgress && window.standPeerProgress(\(self?.jsValue(id) ?? "null"), \(p.fractionCompleted), 'in')")
            }
        }
    }
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {
        var meta = (try? JSONSerialization.jsonObject(with: Data(resourceName.utf8))) as? [String: Any] ?? [:]
        let id = (meta["id"] as? String) ?? UUID().uuidString
        DispatchQueue.main.async { self.progressObservers.removeValue(forKey: "in-" + id) }
        guard error == nil, let src = localURL else {
            js("window.standPeerFile && window.standPeerFile(\(jsValue(meta)), null, \(jsValue(error?.localizedDescription ?? "failed")))")
            return
        }
        let ext = ((meta["ext"] as? String) ?? "mp4").filter { $0.isLetter || $0.isNumber }
        let dest = incomingDir.appendingPathComponent("link-" + id + "." + (ext.isEmpty ? "mp4" : ext))
        try? FileManager.default.removeItem(at: dest)
        do { try FileManager.default.moveItem(at: src, to: dest) } catch {
            do { try FileManager.default.copyItem(at: src, to: dest) } catch {
                js("window.standPeerFile && window.standPeerFile(\(jsValue(meta)), null, \(jsValue(error.localizedDescription)))")
                return
            }
        }
        meta["size"] = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? NSNumber)?.intValue ?? 0
        js("window.standPeerFile && window.standPeerFile(\(jsValue(meta)), \(jsValue("/__incoming/" + dest.lastPathComponent)), null)")
    }
}

// MARK: - Advertiser / browser

extension StandNativeExtras: MCNearbyServiceAdvertiserDelegate {
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID,
                    withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        // only Stand invites (the context says so); one link at a time
        let ok = context.flatMap { String(data: $0, encoding: .utf8) } == "stand"
        DispatchQueue.main.async { self.lastInvitation = Date() }
        invitationHandler(ok && session != nil, session)
    }
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        js("window.standPeerError && window.standPeerError(\(jsValue(error.localizedDescription)))")
    }
}

extension StandNativeExtras: MCNearbyServiceBrowserDelegate {
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        guard info?["app"] == "stand", let s = session else { return }
        // only one of the two invites the other (the one with the smaller token); but when that one
        // cannot see this device (it happens: one side finds the other first), this one invites
        // after a few seconds instead
        guard let theirs = info?["t"] else { return }
        if token > theirs {
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
                guard let self = self, let s2 = self.session, s2 === s, !s2.connectedPeers.contains(peerID) else { return }
                if Date().timeIntervalSince(self.lastInvitation) < 8 { return }
                if let at = self.invited[peerID], Date().timeIntervalSince(at) < 15 { return }
                self.invited[peerID] = Date()
                browser.invitePeer(peerID, to: s2, withContext: "stand".data(using: .utf8), timeout: 12)
            }
            return
        }
        DispatchQueue.main.async {
            if let at = self.invited[peerID], Date().timeIntervalSince(at) < 15 { return }
            guard !s.connectedPeers.contains(peerID) else { return }
            self.invited[peerID] = Date()
            browser.invitePeer(peerID, to: s, withContext: "stand".data(using: .utf8), timeout: 15)
        }
    }
    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        DispatchQueue.main.async { self.invited.removeValue(forKey: peerID) }
    }
    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        js("window.standPeerError && window.standPeerError(\(jsValue(error.localizedDescription)))")
    }
}
