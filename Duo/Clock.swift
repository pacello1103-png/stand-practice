import Foundation
import Darwin

/// Monotonic clock in seconds, based on the same host clock that audio uses.
enum Clock {
    static let secondsPerTick: Double = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return Double(info.numer) / Double(info.denom) / 1_000_000_000
    }()

    static var now: Double { Double(mach_absolute_time()) * secondsPerTick }

    static func ticks(_ seconds: Double) -> UInt64 {
        UInt64(max(0, seconds) / secondsPerTick)
    }
}
