import Foundation
import MultipeerConnectivity
import UIKit
import SwiftUI

/// One camera as the director sees it.
final class RemoteCam: ObservableObject, Identifiable {
    let id: String            // peer name, or "local"
    var peer: MCPeerID?
    let isLocal: Bool
    @Published var index: Int
    @Published var name: String
    @Published var connected = true
    @Published var image: UIImage?
    @Published var status = CamStatus()
    @Published var transfer: Double?
    @Published var clip: ClipInfo?
    @Published var received = false
    @Published var failed: String?
    var frameTime: Double = 0          // director clock time of the shown frame
    var decoding = false

    // virtual camera operator
    @Published var target = Framing()            // where the current move ends
    var moveFrom = Framing()
    var moveStart = 0.0                          // director clock
    var moveDuration = 0.0
    var moves: [FramingKey] = []
    var recordBase = Framing()

    /// Framing right now (mid-move if one is running).
    func framing(at now: Double) -> Framing {
        guard moveDuration > 0, now < moveStart + moveDuration else { return target }
        return Framing.blend(moveFrom, target, max(0, (now - moveStart) / moveDuration))
    }
    var moving: Bool { moveDuration > 0 && Clock.now < moveStart + moveDuration }

    init(id: String, peer: MCPeerID?, index: Int, name: String, isLocal: Bool = false) {
        self.id = id
        self.peer = peer
        self.index = index
        self.name = name
        self.isLocal = isLocal
    }
}

/// The iPad (or iPhone) in charge: sees every camera, switches live, starts and stops everyone together.
final class DirectorModel: ObservableObject {
    enum Phase: Equatable { case ready, recording, collecting, done(UUID) }

    let link = PeerLink(role: .director)
    let store: ProjectStore
    private(set) var localEngine: CameraEngine?

    @Published private(set) var cams: [RemoteCam] = []
    @Published var settings = CaptureSettings() {
        didSet {
            guard settings != oldValue else { return }
            UserDefaults.standard.set(try? JSONEncoder().encode(settings), forKey: "captureSettings")
            link.send(WireMsg(t: Msg.settings, settings: settings))
            localEngine?.update(settings: settings)
        }
    }
    @Published private(set) var program = 1
    @Published var transition: TransitionKind = .cut
    @Published var transitionLength = 0.6
    @Published private(set) var phase: Phase = .ready
    @Published private(set) var recordStart: Double = 0
    @Published private(set) var lookLocked = false
    @Published private(set) var cutCount = 0
    @Published var useThisDevice = false { didSet { if useThisDevice != oldValue { toggleLocal() } } }
    @Published var notice: String?
    @Published var controlled: RemoteCam?        // camera open in the operator panel
    @Published var moveSpeed = 2.0               // seconds per framing move

    private(set) var cuts: [Cut] = []
    private var sessionID = ""
    private var projectID: UUID?
    private var collectTimer: Timer?
    private let decodeQueue = DispatchQueue(label: "tutti.decode", qos: .userInitiated, attributes: .concurrent)

    init(store: ProjectStore) {
        self.store = store
        if let data = UserDefaults.standard.data(forKey: "captureSettings"), let s = try? JSONDecoder().decode(CaptureSettings.self, from: data) {
            settings = s
        }
        link.onState = { [weak self] peer, state in self?.peerChanged(peer, state) }
        link.onMessage = { [weak self] m, peer, _ in self?.handle(m, from: peer) }
        link.onFrame = { [weak self] jpeg, t, peer in self?.frame(jpeg, time: t, from: peer) }
        link.onResourceStart = { [weak self] name, peer, progress in self?.resourceStarted(name, peer, progress) }
        link.onResourceDone = { [weak self] name, peer, url, error in self?.resourceDone(name, peer, url, error) }
    }

    func begin() {
        link.start()
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    func end() {
        if phase == .recording { stop() }
        link.stop()
        localEngine?.stopRunning()
    }

    var isRecording: Bool { phase == .recording }
    var connectedCams: [RemoteCam] { cams.filter { $0.connected } }

    // MARK: - Cameras

    private func nextIndex() -> Int {
        var i = 1
        while cams.contains(where: { $0.index == i }) { i += 1 }
        return i
    }

    private func peerChanged(_ peer: MCPeerID, _ state: MCSessionState) {
        let key = peer.displayName
        switch state {
        case .connected:
            if let c = cams.first(where: { $0.id == key }) {
                c.peer = peer
                c.connected = true
                if phase == .collecting && !c.received { c.failed = nil }
            } else {
                let c = RemoteCam(id: key, peer: peer, index: nextIndex(), name: key)
                cams.append(c)
                cams.sort { $0.index < $1.index }
                if cams.count == 1 { program = c.index }
            }
            if let c = cams.first(where: { $0.id == key }) {
                link.send(WireMsg(t: Msg.assign, cam: c.index), to: [peer])
                link.send(WireMsg(t: Msg.settings, settings: settings), to: [peer])
                link.send(WireMsg(t: Msg.tally, program: program), to: [peer])
                if lookLocked { link.send(WireMsg(t: Msg.lock, lock: true, kelvin: sharedKelvin()), to: [peer]) }
            }
            objectWillChange.send()
        case .notConnected:
            if let c = cams.first(where: { $0.id == key }) {
                c.connected = false
                // while collecting, a camera that drops out is waited for: it re-sends when it is back
                if phase == .ready && !c.isLocal {
                    // forget it after a while if it does not come back
                    DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
                        guard let self, self.phase == .ready, !c.connected else { return }
                        self.cams.removeAll { $0 === c }
                    }
                }
            }
            objectWillChange.send()
            checkCollected()
        default:
            break
        }
    }

    private func handle(_ m: WireMsg, from peer: MCPeerID) {
        guard let c = cams.first(where: { $0.id == peer.displayName }) else { return }
        switch m.t {
        case Msg.status:
            if let s = m.status { c.status = s }
        case Msg.hello:
            if let n = m.name { c.name = n }
        case Msg.clip:
            if let info = m.clip, info.session == sessionID { c.clip = info }
        case Msg.error:
            if phase == .collecting || phase == .recording { c.failed = m.text ?? "Recording failed" }
            notice = "\(c.name): \(m.text ?? "problem")"
            checkCollected()
        default:
            break
        }
    }

    private func frame(_ jpeg: Data, time: Double, from peer: MCPeerID) {
        DispatchQueue.main.async {
            guard let c = self.cams.first(where: { $0.id == peer.displayName }), !c.decoding else { return }
            c.decoding = true
            self.decodeQueue.async {
                let img = UIImage(data: jpeg)?.preparingForDisplay()
                DispatchQueue.main.async {
                    c.decoding = false
                    if let img, time >= c.frameTime {
                        c.image = img
                        c.frameTime = time
                    }
                }
            }
        }
    }

    private func toggleLocal() {
        if useThisDevice {
            let engine = CameraEngine()
            localEngine = engine
            let c = RemoteCam(id: "local", peer: nil, index: nextIndex(), name: "This \(DeviceName.kind)", isLocal: true)
            cams.append(c)
            cams.sort { $0.index < $1.index }
            engine.previewFPS = 15
            engine.previewLongSide = 1280
            engine.previewQuality = 0.75
            engine.onPreviewFrame = { [weak self, weak c, weak engine] jpeg, host in
                guard let self, let c, let engine else { return }
                self.decodeQueue.async {
                    let img = UIImage(data: jpeg)?.preparingForDisplay()
                    DispatchQueue.main.async {
                        c.image = img
                        c.frameTime = host
                        c.status.peak = engine.peak
                        c.status.zoom = engine.zoomDisplay
                        c.status.lenses = engine.lenses.map(\.display)
                        c.status.digital = engine.isDigitalZoom
                        c.status.battery = UIDevice.current.batteryLevel
                        c.status.locked = engine.locked
                        c.status.audioName = engine.audioName
                        c.status.kelvin = engine.currentKelvin
                    }
                }
            }
            engine.start(settings: settings)
            if lookLocked { engine.lockLook(true, kelvin: sharedKelvin()) }
        } else {
            localEngine?.stopRunning()
            localEngine = nil
            cams.removeAll { $0.isLocal }
        }
    }

    func zoom(_ c: RemoteCam, to display: Double) {
        if c.isLocal { localEngine?.setZoom(display: display) }
        else if let p = c.peer { link.send(WireMsg(t: Msg.zoom, zoom: display), to: [p]) }
        c.status.zoom = display
    }

    /// Lens zoom with a chosen speed (doublings per second).
    func lensZoom(_ c: RemoteCam, to display: Double, speed: Double) {
        if c.isLocal { localEngine?.setZoom(display: display, speed: speed) }
        else if let p = c.peer { link.send(WireMsg(t: Msg.zoom, zoom: display, speed: speed), to: [p]) }
        c.status.zoom = display
    }

    /// A smooth virtual camera move: reframe inside the full picture (zoom in on a subject, pan left/right…).
    /// Recorded as keyframes and rendered later from the full-quality file.
    func frame(_ c: RemoteCam, to f: Framing, duration: Double? = nil) {
        let now = Clock.now
        let d = max(0, duration ?? moveSpeed)
        c.moveFrom = c.framing(at: now)
        c.moveStart = now
        c.moveDuration = d
        c.target = f
        if phase == .recording {
            c.moves.append(FramingKey(time: max(0, now - recordStart), framing: f, duration: d))
        }
        if let p = c.peer { link.send(WireMsg(t: Msg.frame, frame: f, duration: d), to: [p]) }
        objectWillChange.send()
    }

    /// Centre on a point of the picture (0…1, y down) and zoom by a factor of the current zoom.
    func aim(_ c: RemoteCam, at point: CGPoint, zoomBy k: Double) {
        let now = c.framing(at: Clock.now)
        frame(c, to: Framing(zoom: now.zoom * k, center: point))
    }

    func pan(_ c: RemoteCam, dx: Double, dy: Double) {
        let now = c.framing(at: Clock.now)
        let ctr = now.center
        frame(c, to: Framing(zoom: now.zoom, center: CGPoint(x: ctr.x + dx, y: ctr.y + dy)))
    }

    func moveCam(_ c: RemoteCam, to index: Int) {
        guard phase == .ready, index != c.index else { return }
        if let other = cams.first(where: { $0.index == index }) { other.index = c.index; if let p = other.peer { link.send(WireMsg(t: Msg.assign, cam: other.index), to: [p]) } }
        c.index = index
        if let p = c.peer { link.send(WireMsg(t: Msg.assign, cam: index), to: [p]) }
        cams.sort { $0.index < $1.index }
        sendTally()
    }

    // MARK: - Look

    private func sharedKelvin() -> Double? {
        var ks = cams.filter { $0.connected }.map(\.status.kelvin).filter { $0 > 1500 }
        if let e = localEngine { ks.append(e.currentKelvin) }
        ks = ks.filter { $0 > 1500 }.sorted()
        guard !ks.isEmpty else { return nil }
        return ks[ks.count / 2]
    }

    /// Same white balance on every camera, flicker-free shutter, exposure and focus held still.
    func toggleLook() {
        lookLocked.toggle()
        let k = lookLocked ? sharedKelvin() : nil
        link.send(WireMsg(t: Msg.lock, lock: lookLocked, kelvin: k))
        localEngine?.lockLook(lookLocked, kelvin: k)
    }

    // MARK: - Live switching

    func take(_ cam: Int) {
        guard cam != program, cams.contains(where: { $0.index == cam }) else { return }
        if phase == .recording {
            // cut where the director saw it: subtract how old the preview picture is
            let shown = cams.first { $0.index == cam }?.frameTime ?? Clock.now
            let latency = max(0, min(0.4, Clock.now - shown))
            let t = max(0.05, Clock.now - recordStart - latency)
            cuts.append(Cut(time: t, cam: cam, kind: transition, length: transition == .cut ? 0 : transitionLength))
            cutCount = cuts.count - 1
        }
        program = cam
        sendTally()
    }

    private func sendTally() {
        link.send(WireMsg(t: Msg.tally, program: program))
    }

    // MARK: - Record

    func record() {
        guard phase == .ready, !cams.filter({ $0.connected }).isEmpty else { return }
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        sessionID = f.string(from: Date())
        let id = UUID()
        projectID = id
        let start = Clock.now + 1.0
        recordStart = start
        if !cams.contains(where: { $0.index == program && $0.connected }) { program = connectedCams.first?.index ?? 1 }
        cuts = [Cut(time: 0, cam: program, kind: .cut, length: 0)]
        cutCount = 0
        for c in cams {
            c.recordBase = c.framing(at: start)
            c.moves = []
            c.clip = nil
            c.received = false
            c.failed = c.connected ? nil : "Not connected"
            c.transfer = nil
        }
        link.send(WireMsg(t: Msg.record, at: start, session: sessionID))
        sendTally()
        if let engine = localEngine, let c = cams.first(where: { $0.isLocal }) {
            let url = store.folder(id).appendingPathComponent("cam\(c.index).mov")
            let session = sessionID
            engine.startRecording(to: url, atHost: start) { [weak self, weak c] result in
                guard let self, let c else { return }
                switch result {
                case .success(let file):
                    c.clip = ClipInfo(session: session, cam: c.index, start: file.firstFrameHost, duration: file.duration,
                                      bytes: 0, device: c.name, hasAudio: file.hasAudio, audioName: engine.audioName)
                    c.received = true
                case .failure(let e):
                    c.failed = e.localizedDescription
                }
                self.checkCollected()
            }
        }
        withAnimation { phase = .recording }
    }

    func stop() {
        guard phase == .recording else { return }
        let at = Clock.now + 0.05
        link.send(WireMsg(t: Msg.stop, at: at))
        localEngine?.stopRecording(atHost: at)
        withAnimation { phase = .collecting }
        collectTimer?.invalidate()
        collectTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.objectWillChange.send() }
    }

    var elapsed: Double { phase == .recording ? max(0, Clock.now - recordStart) : 0 }

    // MARK: - Collecting the clips

    private var progresses: [String: Progress] = [:]
    private var progressTimer: Timer?

    private func resourceStarted(_ name: String, _ peer: MCPeerID, _ progress: Progress) {
        progresses[peer.displayName] = progress
        if progressTimer == nil {
            progressTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                guard let self else { return }
                for (key, p) in self.progresses {
                    self.cams.first { $0.id == key }?.transfer = p.fractionCompleted
                }
            }
        }
    }

    private func resourceDone(_ name: String, _ peer: MCPeerID, _ url: URL?, _ error: Error?) {
        // runs on the networking queue: move the file now
        let parts = name.split(separator: "|").map(String.init)
        var moved: URL?
        var camNo = 0
        if error == nil, let url, parts.count == 3, parts[0] == "tutti", let n = Int(parts[2]) {
            camNo = n
            let session = parts[1]
            let id = DispatchQueue.main.sync { self.sessionID == session ? self.projectID : nil }
            if let id {
                let dest = store.folder(id).appendingPathComponent("cam\(n).mov")
                try? FileManager.default.removeItem(at: dest)
                do { try FileManager.default.moveItem(at: url, to: dest); moved = dest } catch {}
            }
        }
        DispatchQueue.main.async {
            self.progresses[peer.displayName] = nil
            guard let c = self.cams.first(where: { $0.id == peer.displayName }) else { return }
            if moved != nil {
                c.received = true
                c.transfer = 1
                c.failed = nil
                if c.index != camNo, var info = c.clip { info.cam = camNo; c.clip = info }
            } else {
                c.failed = error?.localizedDescription ?? "Transfer failed"
            }
            self.checkCollected()
        }
    }

    func askAgain(_ c: RemoteCam) {
        guard let p = c.peer, c.connected else { return }
        c.failed = nil
        c.transfer = 0
        link.send(WireMsg(t: Msg.resend, session: sessionID), to: [p])
    }

    private func checkCollected() {
        guard phase == .collecting else { return }
        let waiting = cams.filter { $0.clip?.session == sessionID || $0.connected }.filter { !$0.received && $0.failed == nil }
        if waiting.isEmpty { finish() }
    }

    /// Make the project with whatever arrived.
    func finish() {
        guard phase == .collecting, let id = projectID else { return }
        collectTimer?.invalidate()
        progressTimer?.invalidate()
        progressTimer = nil
        var clips: [Clip] = []
        for c in cams {
            let file = "cam\(c.index).mov"
            let exists = FileManager.default.fileExists(atPath: store.folder(id).appendingPathComponent(file).path)
            if let info = c.clip, c.received, exists {
                var clip = Clip(cam: c.index, device: info.device, file: file, start: info.start - recordStart,
                                duration: info.duration, hasAudio: info.hasAudio, audioName: info.audioName)
                clip.framing = c.recordBase
                // moves were timed from the start of the recording; the clip's own clock starts at its first frame
                clip.moves = c.moves.isEmpty ? nil : c.moves.map { FramingKey(time: $0.time - clip.start, framing: $0.framing, duration: $0.duration) }
                clips.append(clip)
            } else if c.clip != nil || c.failed != nil {
                clips.append(Clip(cam: c.index, device: c.name, file: nil, start: 0, duration: 0, missing: true))
            }
        }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        var p = Project(id: id, name: "Recording \(f.string(from: Date()))", fps: settings.fps)
        p.clips = clips
        let valid = Set(clips.filter { !$0.missing }.map(\.cam))
        p.cuts = cuts.filter { valid.contains($0.cam) }
        if p.cuts.first?.time ?? 1 > 0.001, let first = valid.min() { p.cuts.insert(Cut(time: 0, cam: p.cuts.first?.cam ?? first), at: 0) }
        store.save(p)
        withAnimation { phase = .done(id) }
    }

    func reset() {
        phase = .ready
        projectID = nil
    }

    /// Pretend cameras, for screenshots of the director screen.
    func addDemoCameras() {
        let names = ["iPhone 16 Pro", "iPad Pro", "Inês's iPhone"]
        for i in 1...3 {
            let c = RemoteCam(id: "demo\(i)", peer: nil, index: i, name: names[i - 1])
            c.image = Demo.previewImage(cam: i)
            c.status = CamStatus(battery: [0.82, 0.64, 0.41][i - 1], freeGB: [112, 48, 21][i - 1], recording: false,
                                 peak: [0.4, 0.25, 0.18][i - 1], zoom: [1, 2, 5][i - 1], digital: false, lenses: [0.5, 1, 2, 5],
                                 locked: true, kelvin: 4300, syncMs: [1.2, 2.1, 1.6][i - 1], dropped: 0,
                                 audioName: i == 1 ? "USB Audio" : "iPhone Microphone", stereo: i != 1, model: "iPhone")
            cams.append(c)
        }
        program = 1
        lookLocked = true
    }
}
