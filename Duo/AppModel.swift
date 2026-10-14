import Foundation
import UIKit
import Combine

final class AppModel: ObservableObject {
    let sync = SyncManager()
    private let beeper = Beeper()

    @Published var status = ""
    @Published var isRunning = false
    @Published var isTesting = false

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var bag = Set<AnyCancellable>()
    private var runID = 0

    init() {
        sync.onStart = { [weak self] plan in self?.run(plan) }
        sync.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
    }

    // Settings
    var sound: CueSound { CueSound(rawValue: UserDefaults.standard.string(forKey: "sound") ?? "") ?? .ee }
    var volume: Float { Float(UserDefaults.standard.object(forKey: "volume") as? Double ?? 0.5) }
    var delay: Double { UserDefaults.standard.object(forKey: "delay") as? Double ?? 7 }
    var offsetMs: Double { UserDefaults.standard.object(forKey: "offsetMs") as? Double ?? 0 }

    func start() {
        guard !isRunning else { return }
        stopTest()
        sync.startEverywhere(delay: delay)
    }

    private func run(_ plan: StartPlan) {
        stopTest()
        runID += 1
        let id = runID
        isRunning = true
        status = sync.isConnected ? "Starting together…" : "Starting on this device only…"

        do { try beeper.start() } catch { status = "Couldn’t use the speaker." }
        beginBackground()

        let cueAt = plan.cueAt + offsetMs / 1000
        beeper.schedule(sound, at: cueAt, volume: volume)

        let url = Self.url(for: plan.link)
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, plan.openAt - Clock.now)) {
            UIApplication.shared.open(url)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, cueAt - Clock.now) + 0.8) { [weak self] in
            guard let self, self.runID == id else { return }
            self.beeper.stop()
            self.isRunning = false
            self.status = ""
            self.endBackground()
        }
    }

    // MARK: - Test sounds (for setting up Switch Control)

    func toggleTest() {
        isTesting ? stopTest() : startTest()
    }

    private func startTest() {
        guard !isRunning else { return }
        runID += 1
        let id = runID
        isTesting = true
        do { try beeper.start() } catch { isTesting = false; return }
        beginBackground()
        let first = Clock.now + 1
        for i in 0..<10 { beeper.schedule(sound, at: first + Double(i) * 3, volume: volume) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.runID == id else { return }
            self.stopTest()
        }
    }

    private func stopTest() {
        guard isTesting else { return }
        isTesting = false
        beeper.stop()
        endBackground()
    }

    private func beginBackground() {
        endBackground()
        backgroundTask = UIApplication.shared.beginBackgroundTask { [weak self] in self?.endBackground() }
    }

    private func endBackground() {
        if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
    }

    // MARK: - Links

    static func url(for link: String) -> URL {
        let s = link.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.lowercased().contains("netflix.com"), let id = netflixID(s) {
            return URL(string: "nflx://www.netflix.com/title/\(id)")!
        }
        if !s.isEmpty, let u = URL(string: s), u.scheme != nil { return u }
        return URL(string: "nflx://")!
    }

    static func netflixID(_ s: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: "/(?:title|watch)/(\\d+)"),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let r = Range(m.range(at: 1), in: s) else { return nil }
        return String(s[r])
    }

    static func describe(_ link: String) -> String {
        let s = link.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return "No link: opens the Netflix home screen" }
        if s.lowercased().contains("netflix.com"), netflixID(s) != nil { return "Opens this title in Netflix" }
        if let host = URL(string: s)?.host { return "Opens \(host.replacingOccurrences(of: "www.", with: ""))" }
        return "This doesn’t look like a link"
    }
}
