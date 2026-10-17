import AVFoundation
import SwiftUI
import UniformTypeIdentifiers
import CoreTransferable

/// A video picked in Photos, copied into our sandbox.
struct PickedMovie: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + received.file.lastPathComponent)
            // moving is instant; copy only if the system does not let us move it
            do { try FileManager.default.moveItem(at: received.file, to: dest) } catch { try FileManager.default.copyItem(at: received.file, to: dest) }
            return PickedMovie(url: dest)
        }
    }
}

/// Videos (and sound files from a separate recorder) filmed elsewhere: they become a project
/// and get lined up by their sound.
enum Importer {
    static func makeProject(from urls: [URL], store: ProjectStore, name: String? = nil, move: Bool = false) async -> Project {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        var p = Project(name: name ?? "Imported \(f.string(from: Date()))")
        p.imported = true
        var cam = 1
        var fps = 0.0
        for url in urls {
            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension.lowercased()
            let file = "cam\(cam).\(ext)"
            let dest = store.url(p, file)
            try? FileManager.default.removeItem(at: dest)
            do {
                // files Tutti already copied (from Photos) are moved, not copied twice
                if move { try FileManager.default.moveItem(at: url, to: dest) } else { try FileManager.default.copyItem(at: url, to: dest) }
            } catch { continue }
            let asset = AVURLAsset(url: dest)
            let duration = (try? await asset.load(.duration).seconds) ?? 0
            let video = try? await asset.loadTracks(withMediaType: .video).first
            if let v = video, let rate = try? await v.load(.nominalFrameRate) { fps = max(fps, Double(rate)) }
            var clip = Clip(cam: cam, device: url.deletingPathExtension().lastPathComponent, file: file, start: 0, duration: duration)
            clip.hasVideo = video != nil
            p.clips.append(clip)
            cam += 1
        }
        p.fps = fps > 40 ? (fps > 55 ? 60 : 50) : (fps > 27 ? 30 : 25)
        if let first = p.clips.first(where: { $0.hasVideo }) { p.cuts = [Cut(time: 0, cam: first.cam)] }
        store.save(p)
        return p
    }
}
