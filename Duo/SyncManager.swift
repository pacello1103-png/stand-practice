import Foundation
import MultipeerConnectivity
import UIKit

struct StartPlan {
    var openAt: Double   // local Clock seconds
    var cueAt: Double    // local Clock seconds
    var link: String
}

private struct Message: Codable {
    var type: String
    var t1: Double?
    var t2: Double?
    var openAt: Double?
    var cueAt: Double?
    var link: String?
}

/// Finds the other device, keeps both clocks matched, and shares the start moment.
final class SyncManager: NSObject, ObservableObject {
    static let serviceType = "duo-sync"

    @Published private(set) var connectedNames: [String] = []
    @Published var movieLink: String {
        didSet {
            UserDefaults.standard.set(movieLink, forKey: "movieLink")
            if !applyingRemote { send(Message(type: "link", link: movieLink)) }
        }
    }

    var onStart: ((StartPlan) -> Void)?

    private var applyingRemote = false
    private let myPeer: MCPeerID
    private let session: MCSession
    private let advertiser: MCNearbyServiceAdvertiser
    private let browser: MCNearbyServiceBrowser
    /// Per peer: recent (round trip, their clock minus mine) samples.
    private var samples: [String: [(rtt: Double, offset: Double)]] = [:]
    private var resyncTimer: Timer?

    override init() {
        let kind = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        let tag = String(UUID().uuidString.prefix(4))
        myPeer = MCPeerID(displayName: "\(kind)·\(tag)")
        session = MCSession(peer: myPeer, securityIdentity: nil, encryptionPreference: .required)
        advertiser = MCNearbyServiceAdvertiser(peer: myPeer, discoveryInfo: nil, serviceType: Self.serviceType)
        browser = MCNearbyServiceBrowser(peer: myPeer, serviceType: Self.serviceType)
        movieLink = UserDefaults.standard.string(forKey: "movieLink") ?? ""
        super.init()
        session.delegate = self
        advertiser.delegate = self
        browser.delegate = self
    }

    func begin() {
        advertiser.startAdvertisingPeer()
        browser.startBrowsingForPeers()
        resyncTimer?.invalidate()
        resyncTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            self?.pingBurst()
        }
    }

    func pause() {
        advertiser.stopAdvertisingPeer()
        browser.stopBrowsingForPeers()
    }

    var isConnected: Bool { !session.connectedPeers.isEmpty }

    /// Starts on every connected device. Times are sent in this device's clock.
    func startEverywhere(delay: Double) {
        let openAt = Clock.now + (isConnected ? 1.2 : 0.4)
        let cueAt = openAt + delay
        send(Message(type: "start", openAt: openAt, cueAt: cueAt, link: movieLink))
        onStart?(StartPlan(openAt: openAt, cueAt: cueAt, link: movieLink))
    }

    // MARK: - Clock sync

    private func pingBurst() {
        guard isConnected else { return }
        for i in 0..<12 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.08) { [weak self] in
                self?.send(Message(type: "ping", t1: Clock.now))
            }
        }
    }

    private func offset(for peer: MCPeerID) -> Double {
        guard let list = samples[peer.displayName], let best = list.min(by: { $0.rtt < $1.rtt }) else { return 0 }
        return best.offset
    }

    // MARK: - Sending

    private func send(_ message: Message, to peers: [MCPeerID]? = nil) {
        let targets = peers ?? session.connectedPeers
        guard !targets.isEmpty, let data = try? JSONEncoder().encode(message) else { return }
        try? session.send(data, toPeers: targets, with: .reliable)
    }

    private func handle(_ message: Message, from peer: MCPeerID) {
        let receivedAt = Clock.now
        switch message.type {
        case "ping":
            send(Message(type: "pong", t1: message.t1, t2: Clock.now), to: [peer])
        case "pong":
            guard let t1 = message.t1, let t2 = message.t2 else { return }
            let rtt = receivedAt - t1
            let off = t2 - (t1 + receivedAt) / 2
            DispatchQueue.main.async {
                var list = self.samples[peer.displayName] ?? []
                list.append((rtt, off))
                if list.count > 24 { list.removeFirst(list.count - 24) }
                self.samples[peer.displayName] = list
            }
        case "link":
            DispatchQueue.main.async {
                self.applyingRemote = true
                self.movieLink = message.link ?? ""
                self.applyingRemote = false
            }
        case "hello":
            DispatchQueue.main.async {
                if self.movieLink.isEmpty, let link = message.link, !link.isEmpty {
                    self.applyingRemote = true
                    self.movieLink = link
                    self.applyingRemote = false
                }
            }
        case "start":
            guard let open = message.openAt, let cue = message.cueAt else { return }
            DispatchQueue.main.async {
                let off = self.offset(for: peer)
                let link = message.link ?? self.movieLink
                if link != self.movieLink {
                    self.applyingRemote = true
                    self.movieLink = link
                    self.applyingRemote = false
                }
                self.onStart?(StartPlan(openAt: open - off, cueAt: cue - off, link: link))
            }
        default:
            break
        }
    }

    private func refreshNames() {
        let names = session.connectedPeers.map { $0.displayName.components(separatedBy: "·").first ?? $0.displayName }
        DispatchQueue.main.async { self.connectedNames = names }
    }
}

extension SyncManager: MCSessionDelegate {
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        refreshNames()
        if state == .connected {
            DispatchQueue.main.async {
                self.send(Message(type: "hello", link: self.movieLink), to: [peerID])
                self.pingBurst()
            }
        }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard let message = try? JSONDecoder().decode(Message.self, from: data) else { return }
        handle(message, from: peerID)
    }

    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

extension SyncManager: MCNearbyServiceAdvertiserDelegate {
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        invitationHandler(true, session)
    }
}

extension SyncManager: MCNearbyServiceBrowserDelegate {
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        // Only one side invites, so the two devices don't double-connect.
        guard myPeer.displayName < peerID.displayName, !session.connectedPeers.contains(peerID) else { return }
        browser.invitePeer(peerID, to: session, withContext: nil, timeout: 15)
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        refreshNames()
    }
}
