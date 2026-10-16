import Foundation
import MultipeerConnectivity
import UIKit

/// This device as one of the cameras: follows the director, records, then sends its clip.
final class CameraModel: ObservableObject {
    let engine = CameraEngine()
    let link = PeerLink(role: .camera)
    let clock = ClockSync()

    @Published private(set) var director: MCPeerID?
    @Published private(set) var cam = 0
    @Published private(set) var onAir = false
    @Published private(set) var syncMs: Double = -1
    @Published private(set) var recordingSince: Double?
    @Published private(set) var sendProgress: Double?
    @Published private(set) var message: String?
    @Published var dimmed = false

    private var settings = CaptureSettings()
    private var timers: [Timer] = []
    private var pingBurstLeft = 0
    private var lastClip: (info: ClipInfo, url: URL)?
    private var sending: Progress?
    private var progressTimer: Timer?

    init() {
        link.onMessage = { [weak self] m, p, at in self?.handle(m, from: p, receivedAt: at) }
        link.onState = { [weak self] peer, state in self?.peerChanged(peer, state) }
        engine.onPreviewFrame = { [weak self] jpeg, host in
            guard let self, let d = self.directorPeer else { return }
            self.link.sendFrame(jpeg, time: host + self.clock.offset, to: d)
        }
    }

    // Read from the capture queue; keep a plain copy that does not need the main thread.
    private var directorPeer: MCPeerID?

    func begin() {
        UIDevice.current.isBatteryMonitoringEnabled = true
        engine.start(settings: settings)
        link.start()
        timers.forEach { $0.invalidate() }
        timers = [
            Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.sendStatus() },
            Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { [weak self] _ in self?.pingBurst() },
        ]
    }

    func end() {
        timers.forEach { $0.invalidate() }
        timers = []
        if engine.isRecording { engine.stopRecording() }
        link.stop()
        engine.stopRunning()
    }

    // MARK: - Network

    private func peerChanged(_ peer: MCPeerID, _ state: MCSessionState) {
        switch state {
        case .connected:
            director = peer
            directorPeer = peer
            clock.reset()
            link.send(WireMsg(t: Msg.hello, name: DeviceName.current), to: [peer])
            pingBurst()
        case .notConnected:
            if director == peer {
                director = nil
                directorPeer = nil
                cam = 0
                onAir = false
                syncMs = -1
            }
        default:
            break
        }
    }

    private func pingBurst() {
        guard let d = directorPeer else { return }
        for i in 0..<10 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.06) { [weak self] in
                self?.link.send(WireMsg(t: Msg.ping, t1: Clock.now), to: [d])
            }
        }
    }

    private func handle(_ m: WireMsg, from peer: MCPeerID, receivedAt: Double) {
        switch m.t {
        case Msg.pong:
            if let t1 = m.t1, let t2 = m.t2 {
                clock.add(sent: t1, remote: t2, received: receivedAt)
                syncMs = clock.precisionMs
            }
        case Msg.assign:
            cam = m.cam ?? cam
        case Msg.settings:
            if let s = m.settings {
                settings = s
                engine.update(settings: s)
            }
        case Msg.record:
            guard let session = m.session, let at = m.at else { return }
            startRecording(session: session, atDirectorTime: at)
        case Msg.stop:
            let at = m.at.map { $0 - clock.offset }
            engine.stopRecording(atHost: at)
        case Msg.zoom:
            if let z = m.zoom { engine.setZoom(display: z) }
        case Msg.lock:
            engine.lockLook(m.lock ?? false, kelvin: m.kelvin)
        case Msg.tally:
            onAir = (m.program ?? 0) == cam && cam > 0
        case Msg.resend:
            if let last = lastClip, last.info.session == m.session { sendClip(last.info, url: last.url) }
        default:
            break
        }
    }

    private func sendStatus() {
        guard let d = directorPeer else { return }
        var s = CamStatus()
        s.battery = UIDevice.current.batteryLevel
        s.freeGB = Self.freeSpaceGB()
        s.recording = engine.isRecording
        s.peak = engine.peak
        s.zoom = engine.zoomDisplay
        s.digital = engine.isDigitalZoom
        s.lenses = engine.lenses.map(\.display)
        s.locked = engine.locked
        s.kelvin = engine.currentKelvin
        s.syncMs = clock.precisionMs.isFinite ? clock.precisionMs : -1
        s.dropped = engine.droppedFrames
        s.audioName = engine.audioName
        s.stereo = engine.stereo
        s.model = DeviceName.kind
        link.send(WireMsg(t: Msg.status, status: s), to: [d], reliable: false)
    }

    static func freeSpaceGB() -> Double {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        let v = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return Double(v?.volumeAvailableCapacityForImportantUsage ?? 0) / 1_000_000_000
    }

    // MARK: - Recording

    static var takesFolder: URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Camera takes", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func startRecording(session: String, atDirectorTime at: Double) {
        let camNo = cam
        let url = Self.takesFolder.appendingPathComponent("\(session) cam\(camNo).mov")
        let localStart = at - clock.offset
        message = nil
        recordingSince = Date().timeIntervalSince1970
        engine.startRecording(to: url, atHost: localStart) { [weak self] result in
            guard let self else { return }
            self.recordingSince = nil
            switch result {
            case .success(let file):
                let bytes = (try? FileManager.default.attributesOfItem(atPath: file.url.path)[.size] as? NSNumber)?.int64Value ?? 0
                let info = ClipInfo(session: session, cam: camNo, start: file.firstFrameHost + self.clock.offset,
                                    duration: file.duration, bytes: bytes, device: DeviceName.current,
                                    hasAudio: file.hasAudio, audioName: self.engine.audioName)
                self.lastClip = (info, file.url)
                self.sendClip(info, url: file.url)
            case .failure(let error):
                self.message = error.localizedDescription
                if let d = self.directorPeer {
                    self.link.send(WireMsg(t: Msg.error, text: error.localizedDescription), to: [d])
                }
            }
        }
    }

    private func sendClip(_ info: ClipInfo, url: URL) {
        guard let d = directorPeer else {
            message = "Saved on this device. It will be sent when the director asks again."
            return
        }
        link.send(WireMsg(t: Msg.clip, clip: info), to: [d])
        sendProgress = 0
        let name = "tutti|\(info.session)|\(info.cam)"
        sending = link.sendFile(url, name: name, to: d) { [weak self] error in
            guard let self else { return }
            self.progressTimer?.invalidate()
            self.sendProgress = nil
            self.sending = nil
            self.message = error == nil ? "Sent to the director." : "Sending failed — the take is kept on this device."
        }
        progressTimer?.invalidate()
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            guard let self, let p = self.sending else { return }
            self.sendProgress = p.fractionCompleted
        }
    }
}
