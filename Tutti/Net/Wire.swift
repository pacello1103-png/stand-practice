import Foundation

/// What every camera should record. Chosen on the director, applied on every camera.
struct CaptureSettings: Codable, Equatable {
    var uhd = true               // 4K, otherwise 1080p
    var fps = 25
    var antiFlicker50 = true     // shutter matched to 50 Hz mains (Europe) so lights never flicker
    var stabilization = false    // off on a tripod (sharper, no crop)
    var front = false
}

struct CamStatus: Codable, Equatable {
    var battery: Float = -1
    var freeGB: Double = -1
    var recording = false
    var peak: Float = 0
    var zoom: Double = 1
    var digital = false
    var lenses: [Double] = []
    var locked = false
    var kelvin: Double = 0
    var syncMs: Double = -1
    var dropped = 0
    var audioName = ""
    var stereo = false
    var model = ""
}

struct ClipInfo: Codable, Equatable {
    var session: String
    var cam: Int
    var start: Double        // director clock, first frame
    var duration: Double
    var bytes: Int64
    var device: String
    var hasAudio: Bool
    var audioName: String
}

struct WireMsg: Codable {
    var t: String
    var name: String? = nil
    var cam: Int? = nil
    var t1: Double? = nil
    var t2: Double? = nil
    var at: Double? = nil
    var session: String? = nil
    var settings: CaptureSettings? = nil
    var status: CamStatus? = nil
    var clip: ClipInfo? = nil
    var zoom: Double? = nil
    var lock: Bool? = nil
    var kelvin: Double? = nil
    var program: Int? = nil
    var text: String? = nil
}

enum Msg {
    static let hello = "hello"          // camera → director: name
    static let assign = "assign"        // director → camera: cam number
    static let settings = "settings"    // director → camera
    static let ping = "ping"            // camera → director
    static let pong = "pong"            // director → camera
    static let record = "record"        // director → camera: session, at (director clock)
    static let stop = "stop"            // director → camera: at
    static let status = "status"        // camera → director
    static let clip = "clip"            // camera → director: clip info, file follows
    static let zoom = "zoom"            // director → camera
    static let lock = "lock"            // director → camera: lock, kelvin
    static let tally = "tally"          // director → camera: program cam
    static let resend = "resend"        // director → camera: session
    static let error = "error"          // camera → director: text
}
