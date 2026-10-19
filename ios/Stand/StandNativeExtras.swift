// StandNativeExtras.swift
// Two small native services for the Stand web app:
//
//  1. standCloud  – iCloud key-value storage (NSUbiquitousKeyValueStore). Practice time follows the
//                   user to their other devices with the same Apple ID. No account, no server.
//  2. standPeer   – a direct link between nearby iPads and iPhones (MultipeerConnectivity: same
//                   Wi-Fi, or just nearby over Apple's peer-to-peer Wi-Fi). Used to find each other
//                   for the iPhone camera and practice sharing, without codes or the internet.
//
// Setup (once, in Xcode):
//  • Add this file to the Stand target.
//  • Right after the WKWebView is created:   StandNativeExtras.shared.install(on: webView)
//  • Signing & Capabilities → + iCloud → tick "Key-value storage".
//  • Info.plist → NSBonjourServices (Array): "_stand-link._tcp", "_stand-link._udp"
//    (NSLocalNetworkUsageDescription is already there.)
//
// The web app checks window.standCaps.cloud / window.standCaps.peer and falls back to its own
// (internet) way when these are missing, so nothing breaks if a step is skipped.

import Foundation
import UIKit
import WebKit
import MultipeerConnectivity

final class StandNativeExtras: NSObject {
    static let shared = StandNativeExtras()

    private weak var webView: WKWebView?
    private let kvs = NSUbiquitousKeyValueStore.default

    // MultipeerConnectivity
    private let serviceType = "stand-link"          // must match NSBonjourServices
    private let token = UUID().uuidString           // decides which side invites (only one does)
    private var peerID: MCPeerID?
    private var session: MCSession?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var invited = Set<MCPeerID>()

    func install(on webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "standCloud")
        ucc.removeScriptMessageHandler(forName: "standPeer")
        ucc.add(WeakScriptHandler(self), name: "standCloud")
        ucc.add(WeakScriptHandler(self), name: "standPeer")
        let caps = "window.standCaps = Object.assign(window.standCaps || {}, { cloud: true, peer: true });"
        ucc.addUserScript(WKUserScript(source: caps, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.evaluateJavaScript(caps, completionHandler: nil)

        NotificationCenter.default.addObserver(self, selector: #selector(cloudChanged(_:)),
                                               name: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: kvs)
        NotificationCenter.default.addObserver(self, selector: #selector(appActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appBackground),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
        kvs.synchronize()
    }

    // MARK: - JavaScript helpers

    private func js(_ source: String) {
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript(source, completionHandler: nil) }
    }
    private func jsString(_ s: String?) -> String {
        guard let s = s,
              let data = try? JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed]),
              let out = String(data: data, encoding: .utf8) else { return "null" }
        return out
    }
    private func jsArray(_ a: [String]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: a, options: []),
              let out = String(data: data, encoding: .utf8) else { return "[]" }
        return out
    }

    // MARK: - iCloud key-value storage

    private func handleCloud(_ op: String, _ body: [String: Any]) {
        let key = (body["key"] as? String) ?? ""
        guard !key.isEmpty else { return }
        switch op {
        case "set":
            if let v = body["value"] as? String {
                kvs.set(v, forKey: key)
                kvs.synchronize()
            }
        case "get":
            kvs.synchronize()
            js("window.standCloudValue && window.standCloudValue(\(jsString(key)), \(jsString(kvs.string(forKey: key))))")
        case "remove":
            kvs.removeObject(forKey: key)
            kvs.synchronize()
        default:
            break
        }
    }

    @objc private func cloudChanged(_ note: Notification) {
        let keys = (note.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String]) ?? []
        js("window.standCloudChanged && window.standCloudChanged(\(jsArray(keys)))")
    }

    // MARK: - Direct link (MultipeerConnectivity)

    private func handlePeer(_ op: String, _ body: [String: Any]) {
        switch op {
        case "start":
            startPeer(name: (body["name"] as? String) ?? UIDevice.current.name)
        case "stop":
            stopPeer()
        case "send":
            guard let s = session, !s.connectedPeers.isEmpty,
                  let str = body["data"] as? String, let data = str.data(using: .utf8) else { return }
            try? s.send(data, toPeers: s.connectedPeers, with: .reliable)
        default:
            break
        }
    }

    private func startPeer(name: String) {
        if session != nil { reportPeers(); return }
        let id = MCPeerID(displayName: String(name.prefix(60)))
        let s = MCSession(peer: id, securityIdentity: nil, encryptionPreference: .required)
        s.delegate = self
        peerID = id
        session = s
        let adv = MCNearbyServiceAdvertiser(peer: id, discoveryInfo: ["app": "stand", "t": token], serviceType: serviceType)
        adv.delegate = self
        adv.startAdvertisingPeer()
        advertiser = adv
        let br = MCNearbyServiceBrowser(peer: id, serviceType: serviceType)
        br.delegate = self
        br.startBrowsingForPeers()
        browser = br
    }

    private func stopPeer() {
        advertiser?.stopAdvertisingPeer(); advertiser = nil
        browser?.stopBrowsingForPeers(); browser = nil
        session?.disconnect(); session = nil
        invited.removeAll()
        reportPeers()
    }

    private func reportPeers() {
        let n = session?.connectedPeers.count ?? 0
        js("window.standPeerState && window.standPeerState(\(n))")
    }

    // iOS stops the link in the background; it starts again when the app comes back
    @objc private func appBackground() {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
    }
    @objc private func appActive() {
        guard session != nil else { return }
        invited.removeAll()
        advertiser?.startAdvertisingPeer()
        browser?.startBrowsingForPeers()
    }
}

// MARK: - WKScriptMessageHandler

extension StandNativeExtras: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        if message.name == "standCloud" { handleCloud(op, body) }
        else if message.name == "standPeer" { handlePeer(op, body) }
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
        if state == .notConnected { DispatchQueue.main.async { self.invited.remove(peerID) } }
        reportPeers()
    }
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard let str = String(data: data, encoding: .utf8) else { return }
        js("window.standPeerMessage && window.standPeerMessage(\(jsString(str)))")
    }
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

// MARK: - Advertiser / browser

extension StandNativeExtras: MCNearbyServiceAdvertiserDelegate {
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID,
                    withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        invitationHandler(session != nil, session)
    }
}

extension StandNativeExtras: MCNearbyServiceBrowserDelegate {
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        guard info?["app"] == "stand", let s = session else { return }
        // only one of the two invites the other (the one with the smaller token)
        guard let theirs = info?["t"], token < theirs else { return }
        DispatchQueue.main.async {
            guard !self.invited.contains(peerID), !s.connectedPeers.contains(peerID) else { return }
            self.invited.insert(peerID)
            browser.invitePeer(peerID, to: s, withContext: nil, timeout: 20)
        }
    }
    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        DispatchQueue.main.async { self.invited.remove(peerID) }
    }
}
