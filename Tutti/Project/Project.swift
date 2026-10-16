import Foundation
import AVFoundation
import UIKit

struct Framing: Codable, Equatable {
    var zoom: Double = 1     // 1 = whole picture
    var x: Double = 0        // -1…1, which part of the picture stays in view when zoomed
    var y: Double = 0
}

extension Framing {
    /// Centre of the visible window in the full picture (0…1, y down).
    var center: CGPoint {
        let spare = (1 - 1 / max(1, zoom)) / 2
        return CGPoint(x: 0.5 + x * spare, y: 0.5 + y * spare)
    }

    init(zoom: Double, center: CGPoint) {
        let z = max(1, min(3, zoom))
        let spare = (1 - 1 / z) / 2
        self.zoom = z
        self.x = spare > 0.0001 ? max(-1, min(1, (Double(center.x) - 0.5) / spare)) : 0
        self.y = spare > 0.0001 ? max(-1, min(1, (Double(center.y) - 0.5) / spare)) : 0
    }

    /// A smooth camera move: zoom changes evenly (log scale), the centre glides in a straight line.
    static func blend(_ a: Framing, _ b: Framing, _ p: Double) -> Framing {
        let q = p * p * (3 - 2 * p)
        let z = exp(log(max(1, a.zoom)) * (1 - q) + log(max(1, b.zoom)) * q)
        let ca = a.center, cb = b.center
        let c = CGPoint(x: ca.x + (cb.x - ca.x) * q, y: ca.y + (cb.y - ca.y) * q)
        return Framing(zoom: z, center: c)
    }

    /// Framing at time t, starting from `base` and following timed moves.
    static func at(_ t: Double, base: Framing, moves: [FramingKey]) -> Framing {
        var current = base
        for m in moves.sorted(by: { $0.time < $1.time }) {
            if t >= m.time + m.duration { current = m.framing; continue }
            if t <= m.time { break }
            return blend(current, m.framing, (t - m.time) / max(0.001, m.duration))
        }
        return current
    }
}

/// A camera move made by the director while recording (time on the project timeline).
struct FramingKey: Codable, Equatable {
    var time: Double
    var framing: Framing
    var duration: Double
}

struct CamLook: Codable, Equatable {
    var exposure: Double = 0     // EV
    var warmth: Double = 0       // -1…1
    var tint: Double = 0         // -1…1
}

/// Measured automatically so every camera looks like the reference camera.
struct AutoLook: Codable, Equatable {
    var gains: [Double] = [1, 1, 1]
    var exposure: Double = 1
    var steadyTimes: [Double] = []
    var steadyGains: [Double] = []
}

struct Clip: Codable, Identifiable, Equatable {
    var id = UUID()
    var cam: Int
    var device: String
    var file: String?
    var hasVideo = true
    var start: Double            // seconds on the project timeline (0 = when recording began)
    var duration: Double
    var rotation = 0
    var width = 1920
    var height = 1080
    var hasAudio = true
    var audioName = ""
    var audioFile: String?       // prepared 48 kHz copy for the mixer
    var peaksFile: String?
    var audioShift: Double = 0   // fine alignment of the sound (found by listening)
    var drift: Double = 0        // clock drift of this recorder, ratio
    var syncNote: String?
    var loudness: Double?        // LUFS of the raw microphone
    var framing = Framing()
    var moves: [FramingKey]?     // director's camera moves during the take
    var look = CamLook()
    var auto: AutoLook?
    var missing = false          // never arrived from the camera

    var end: Double { start + duration }
}

enum TransitionKind: String, Codable, CaseIterable, Identifiable {
    case cut, dissolve, dip, wipe, push, blur
    var id: String { rawValue }
    var label: String {
        switch self {
        case .cut: return "Cut"
        case .dissolve: return "Dissolve"
        case .dip: return "Dip"
        case .wipe: return "Wipe"
        case .push: return "Push"
        case .blur: return "Blur"
        }
    }
    var symbol: String {
        switch self {
        case .cut: return "scissors"
        case .dissolve: return "circle.lefthalf.filled"
        case .dip: return "moon.fill"
        case .wipe: return "rectangle.righthalf.inset.filled"
        case .push: return "arrow.right.square"
        case .blur: return "aqi.medium"
        }
    }
}

struct Cut: Codable, Identifiable, Equatable {
    var id = UUID()
    var time: Double
    var cam: Int
    var kind: TransitionKind = .cut
    var length: Double = 0.6
}

enum MicRole: String, Codable, CaseIterable {
    case main, room, off
    var label: String {
        switch self {
        case .main: return "Main"
        case .room: return "Room"
        case .off: return "Off"
        }
    }
}

struct MicSetting: Codable, Equatable {
    var cam: Int
    var role: MicRole
    var gain: Double = 0     // dB, on top of automatic level matching
    var pan: Double = 0      // -1…1
}

enum RoomSound: String, Codable, CaseIterable {
    case none, studio, chamber, hall, church, plate
    var label: String {
        switch self {
        case .none: return "Dry"
        case .studio: return "Studio"
        case .chamber: return "Chamber"
        case .hall: return "Hall"
        case .church: return "Church"
        case .plate: return "Plate"
        }
    }
}

struct SoundSettings: Codable, Equatable {
    var mics: [MicSetting] = []
    var room: Double = 0.3          // how much of the room microphones
    var roomWidth: Double = 0.8
    var lowCut = true
    var warmth: Double = 0          // -1…1
    var presence: Double = 0
    var air: Double = 0
    var compress: Double = 0.2      // 0…1
    var reverb: RoomSound = .none
    var reverbAmount: Double = 0.25
    var target: Double = -14        // LUFS
    var preset = "Natural"
}

struct PictureSettings: Codable, Equatable {
    var matchLook = true
    var reference = 1
    var strength: Double = 0.85
    var steady = true
    var detail: Double = 0.35
    var contrast: Double = 1
    var saturation: Double = 1
    var vibrance: Double = 0
}

struct Project: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var created = Date()
    var fps = 25
    var clips: [Clip] = []
    var cuts: [Cut] = []
    var sound = SoundSettings()
    var picture = PictureSettings()
    var prepared = false
    var imported = false
    var mixGain: Double?            // dB that brings the mix to the loudness target
    var exportedAt: Date?

    var videoClips: [Clip] { clips.filter { $0.hasVideo && $0.file != nil && !$0.missing }.sorted { $0.cam < $1.cam } }
    var audioClips: [Clip] { clips.filter { $0.hasAudio && $0.audioFile != nil && !$0.missing } }
    var cams: [Int] { videoClips.map(\.cam) }
    var duration: Double { videoClips.map(\.end).max() ?? clips.map(\.end).max() ?? 0 }

    func clip(cam: Int) -> Clip? { clips.first { $0.cam == cam && !$0.missing } }

    /// Which camera is on screen at time t (ignoring transitions).
    func camera(at t: Double) -> Int {
        let sorted = cuts.sorted { $0.time < $1.time }
        var current = sorted.first?.cam ?? cams.first ?? 1
        for c in sorted where c.time <= t { current = c.cam }
        return current
    }
}

/// Projects live in Documents/Projects/<id>/ so they also show up in the Files app.
final class ProjectStore: ObservableObject {
    @Published private(set) var projects: [Project] = []
    let root: URL

    init() {
        root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Projects", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        reload()
    }

    func reload() {
        let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        var list: [Project] = []
        for d in dirs {
            let f = d.appendingPathComponent("project.json")
            if let data = try? Data(contentsOf: f), let p = try? Self.decoder.decode(Project.self, from: data) { list.append(p) }
        }
        projects = list.sorted { $0.created > $1.created }
    }

    func project(_ id: UUID) -> Project? { projects.first { $0.id == id } }

    func folder(_ id: UUID) -> URL {
        let d = root.appendingPathComponent(id.uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    func url(_ project: Project, _ file: String) -> URL { folder(project.id).appendingPathComponent(file) }

    func save(_ p: Project) {
        if let data = try? Self.encoder.encode(p) {
            try? data.write(to: folder(p.id).appendingPathComponent("project.json"), options: .atomic)
        }
        if let i = projects.firstIndex(where: { $0.id == p.id }) { projects[i] = p } else { projects.insert(p, at: 0) }
    }

    func delete(_ p: Project) {
        try? FileManager.default.removeItem(at: root.appendingPathComponent(p.id.uuidString))
        projects.removeAll { $0.id == p.id }
    }

    func thumbnail(_ p: Project) -> URL { folder(p.id).appendingPathComponent("thumb.jpg") }

    func makeThumbnail(_ p: Project) async {
        guard let c = p.videoClips.first, let f = c.file else { return }
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url(p, f)))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 640, height: 640)
        let t = CMTime(seconds: min(2, c.duration / 3), preferredTimescale: 600)
        if let img = try? await gen.image(at: t).image, let data = UIImage(cgImage: img).jpegData(compressionQuality: 0.75) {
            try? data.write(to: thumbnail(p))
            await MainActor.run { self.objectWillChange.send() }
        }
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
