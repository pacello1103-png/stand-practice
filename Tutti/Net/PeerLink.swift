import Foundation
import MultipeerConnectivity
import UIKit

enum DeviceName {
    private static let key = "deviceName"
    private static let tagKey = "deviceTag"

    static var tag: String {
        if let t = UserDefaults.standard.string(forKey: tagKey) { return t }
        let letters = Array("ABCDEFGHJKLMNPQRSTUVWXYZ")
        let t = String((0..<3).map { _ in letters.randomElement()! })
        UserDefaults.standard.set(t, forKey: tagKey)
        return t
    }

    static var kind: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }

    static var current: String {
        get {
            let s = UserDefaults.standard.string(forKey: key)?.trimmingCharacters(in: .whitespaces) ?? ""
            return s.isEmpty ? "\(kind) \(tag)" : s
        }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
}

/// Nearby connection between the director and the cameras (Wi‑Fi or peer-to-peer Wi‑Fi, no router needed).
/// Cameras advertise, the director finds and invites them.
final class PeerLink: NSObject {
    enum Role { case director, camera }
    static let service = "tutti-cams"

    let role: Role
    let me: MCPeerID
    let session: MCSession
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var running = false

    /// Called on the main queue. The third value is the local Clock time the message arrived.
    var onMessage: ((WireMsg, MCPeerID, Double) -> Void)?
    /// Preview frame (JPEG) with its capture time on the director clock. Called on a background queue.
    var onFrame: ((Data, Double, MCPeerID) -> Void)?
    var onState: ((MCPeerID, MCSessionState) -> Void)?
    var onResourceStart: ((String, MCPeerID, Progress) -> Void)?
    /// Called on the networking queue: move the file before returning, it is deleted afterwards.
    var onResourceDone: ((String, MCPeerID, URL?, Error?) -> Void)?

    init(role: Role) {
        self.role = role
        var name = DeviceName.current
        while name.utf8.count > 60 { name.removeLast() }
        me = MCPeerID(displayName: name.isEmpty ? "Tutti" : name)
        session = MCSession(peer: me, securityIdentity: nil, encryptionPreference: .required)
        super.init()
        session.delegate = self
    }

    func start() {
        guard !running else { return }
        running = true
        switch role {
        case .camera:
            let a = MCNearbyServiceAdvertiser(peer: me, discoveryInfo: ["role": "camera"], serviceType: Self.service)
            a.delegate = self
            a.startAdvertisingPeer()
            advertiser = a
        case .director:
            let b = MCNearbyServiceBrowser(peer: me, serviceType: Self.service)
            b.delegate = self
            b.startBrowsingForPeers()
            browser = b
        }
    }

    func stop() {
        running = false
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        advertiser = nil
        browser = nil
        session.disconnect()
    }

    /// Restart discovery (after coming back from the background, for example).
    func refresh() {
        guard running else { return }
        switch role {
        case .camera:
            advertiser?.stopAdvertisingPeer()
            advertiser?.startAdvertisingPeer()
        case .director:
            browser?.stopBrowsingForPeers()
            browser?.startBrowsingForPeers()
        }
    }

    var connected: [MCPeerID] { session.connectedPeers }

    func send(_ msg: WireMsg, to peers: [MCPeerID]? = nil, reliable: Bool = true) {
        let targets = peers ?? session.connectedPeers
        guard !targets.isEmpty, let json = try? JSONEncoder().encode(msg) else { return }
        var data = Data([0])
        data.append(json)
        try? session.send(data, toPeers: targets, with: reliable ? .reliable : .unreliable)
    }

    func sendFrame(_ jpeg: Data, time: Double, to peer: MCPeerID) {
        var data = Data([1])
        var bits = time.bitPattern.bigEndian
        withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
        data.append(jpeg)
        try? session.send(data, toPeers: [peer], with: .unreliable)
    }

    @discardableResult
    func sendFile(_ url: URL, name: String, to peer: MCPeerID, done: @escaping (Error?) -> Void) -> Progress? {
        session.sendResource(at: url, withName: name, toPeer: peer) { error in
            DispatchQueue.main.async { done(error) }
        }
    }

    private func handle(_ data: Data, from peer: MCPeerID) {
        let receivedAt = Clock.now
        guard let kind = data.first else { return }
        if kind == 0 {
            guard let msg = try? JSONDecoder().decode(WireMsg.self, from: data.subdata(in: 1..<data.count)) else { return }
            // Answer clock pings right here, off the main queue, so the round trip stays short and even.
            if msg.t == Msg.ping, role == .director {
                send(WireMsg(t: Msg.pong, t1: msg.t1, t2: Clock.now), to: [peer])
                return
            }
            DispatchQueue.main.async { self.onMessage?(msg, peer, receivedAt) }
        } else if kind == 1, data.count > 9 {
            var bits: UInt64 = 0
            _ = withUnsafeMutableBytes(of: &bits) { data.copyBytes(to: $0, from: 1..<9) }
            let t = Double(bitPattern: UInt64(bigEndian: bits))
            onFrame?(data.subdata(in: 9..<data.count), t, peer)
        }
    }
}

extension PeerLink: MCSessionDelegate {
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        DispatchQueue.main.async { self.onState?(peerID, state) }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        handle(data, from: peerID)
    }

    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}

    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {
        DispatchQueue.main.async { self.onResourceStart?(resourceName, peerID, progress) }
    }

    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {
        onResourceDone?(resourceName, peerID, localURL, error)
    }
}

extension PeerLink: MCNearbyServiceAdvertiserDelegate {
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        // A camera follows one director at a time.
        let busy = !session.connectedPeers.isEmpty && !session.connectedPeers.contains(peerID)
        invitationHandler(!busy, session)
    }

    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {}
}

extension PeerLink: MCNearbyServiceBrowserDelegate {
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        guard info?["role"] == "camera", !session.connectedPeers.contains(peerID) else { return }
        browser.invitePeer(peerID, to: session, withContext: nil, timeout: 20)
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {}
}
