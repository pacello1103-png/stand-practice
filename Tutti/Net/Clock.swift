import Foundation
import Darwin
import CoreMedia

/// Monotonic host clock in seconds — the same clock the camera stamps its frames with.
enum Clock {
    static let secondsPerTick: Double = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return Double(info.numer) / Double(info.denom) / 1_000_000_000
    }()

    static var now: Double { Double(mach_absolute_time()) * secondsPerTick }

    static func hostTime(_ seconds: Double) -> UInt64 {
        UInt64(max(0, seconds) / secondsPerTick)
    }

    static func cmTime(_ seconds: Double) -> CMTime {
        CMClockMakeHostTimeFromSystemUnits(hostTime(seconds))
    }
}

/// Keeps "director time = local time + offset" from ping/pong samples (NTP style, best round trip wins).
final class ClockSync {
    private var samples: [(rtt: Double, offset: Double, at: Double)] = []
    private let lock = NSLock()

    func add(sent t1: Double, remote t2: Double, received t3: Double) {
        let rtt = t3 - t1
        guard rtt >= 0, rtt < 1 else { return }
        let off = t2 - (t1 + t3) / 2
        lock.lock()
        samples.append((rtt, off, t3))
        // keep the last ~90 s, plenty to ride out Wi-Fi hiccups
        samples.removeAll { t3 - $0.at > 90 }
        if samples.count > 120 { samples.removeFirst(samples.count - 120) }
        lock.unlock()
    }

    var offset: Double {
        lock.lock(); defer { lock.unlock() }
        // average the offsets of the fastest round trips
        let best = samples.sorted { $0.rtt < $1.rtt }.prefix(5)
        guard !best.isEmpty else { return 0 }
        return best.map(\.offset).reduce(0, +) / Double(best.count)
    }

    /// Worst-case error of the offset, in milliseconds.
    var precisionMs: Double {
        lock.lock(); defer { lock.unlock() }
        guard let best = samples.map(\.rtt).min() else { return .infinity }
        return best / 2 * 1000
    }

    var hasSamples: Bool {
        lock.lock(); defer { lock.unlock() }
        return samples.count >= 3
    }

    func reset() {
        lock.lock(); samples.removeAll(); lock.unlock()
    }
}
