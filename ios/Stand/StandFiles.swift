import UIKit
import WebKit
import MetricKit

// The Stand folder in Files (On My iPad › Stand, On My iPhone › Stand), what goes wrong written
// down there, and a little time in the background for work that should not stop half way.
//
// Page → app:
//   standSave   { op: "begin", id, folder, name } · { op: "chunk", id, data: base64 } · { op: "end", id }
//               · { op: "keep", folder, prefix, count } (only the newest `count` files starting with prefix stay)
//               · { op: "remove", path } (a file in Scores, Backups or Recordings)
//   standBusy   { on: true | false, why }
//   standDiag   { op: "list" } · { op: "log", text }
// App → page:
//   standSaved({ id, ok, path, error })
//   standDiagList({ files: [{ name, size, date }], log })
//   standMemoryLow()

let documentsDir: URL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

enum StandLog {
    static let dir: URL = {
        let d = documentsDir.appendingPathComponent("Diagnostics", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private static let queue = DispatchQueue(label: "stand.log")
    // one line per event, newest last; the file is kept small
    static func write(_ text: String) {
        let line = ISO8601DateFormatter().string(from: Date()) + "  " + text.replacingOccurrences(of: "\n", with: " ") + "\n"
        queue.async {
            let url = dir.appendingPathComponent("events.log")
            if let h = try? FileHandle(forWritingTo: url) {
                h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
            } else {
                try? line.data(using: .utf8)!.write(to: url)
            }
            if let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber, size.intValue > 200_000,
               let data = try? Data(contentsOf: url) {
                try? data.suffix(100_000).write(to: url)
            }
        }
    }
}

// Crash and memory reports from iOS (MetricKit): delivered the next time the app runs, written to
// the Diagnostics folder so they can be sent on.
final class StandDiagnostics: NSObject, MXMetricManagerSubscriber {
    static let shared = StandDiagnostics()
    func start() { MXMetricManager.shared.add(self) }
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for p in payloads {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH.mm.ss"
            let crashes = p.crashDiagnostics?.count ?? 0
            let name = "report " + f.string(from: p.timeStampEnd) + (crashes > 0 ? " crash" : "") + ".json"
            try? p.jsonRepresentation().write(to: StandLog.dir.appendingPathComponent(name))
            StandLog.write("iOS report: \(crashes) crash(es), \(p.hangDiagnostics?.count ?? 0) hang(s), \(p.cpuExceptionDiagnostics?.count ?? 0) CPU, \(p.diskWriteExceptionDiagnostics?.count ?? 0) disk")
        }
    }
    func didReceive(_ payloads: [MXMetricPayload]) {}
}

final class StandFiles {
    private var open: [String: (FileHandle, URL, URL)] = [:]   // id → (handle, temporary file, final place)
    private var busyTask: UIBackgroundTaskIdentifier = .invalid
    private var busyWhy: Set<String> = []
    var send: ((String, [String: Any]) -> Void)?

    // the Stand folder in Files is there from the first day, already in order
    init() {
        for name in ["Scores", "Backup", "Diagnostics"] {
            try? FileManager.default.createDirectory(at: documentsDir.appendingPathComponent(name, isDirectory: true), withIntermediateDirectories: true)
        }
    }

    // a name for a file or folder that is safe on disk (no folders hidden inside it)
    private func clean(_ s: String) -> String {
        let bad = CharacterSet(charactersIn: "/\\:?%*|\"<>\0")
        let t = s.components(separatedBy: bad).joined(separator: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty || t == "." || t == ".." ? "file" : t
    }
    private func folderURL(_ folder: String) -> URL {
        var url = documentsDir
        for part in folder.split(separator: "/") { url.appendPathComponent(clean(String(part)), isDirectory: true) }
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func save(_ body: [String: Any]) {
        let id = body["id"] as? String ?? ""
        switch body["op"] as? String {
        case "begin":
            let dest = folderURL(body["folder"] as? String ?? "").appendingPathComponent(clean(body["name"] as? String ?? "file"))
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("save-" + UUID().uuidString)
            FileManager.default.createFile(atPath: tmp.path, contents: nil)
            guard let h = try? FileHandle(forWritingTo: tmp) else { send?("standSaved", ["id": id, "ok": false, "error": "open"]); return }
            open[id] = (h, tmp, dest)
        case "chunk":
            guard let e = open[id], let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { fail(id, "chunk"); return }
            e.0.write(data)
            // (files ≥ 2: the page sends the next piece when this one is written)
            send?("standSavedChunk", ["id": id])
        case "end":
            guard let e = open.removeValue(forKey: id) else { send?("standSaved", ["id": id, "ok": false, "error": "none"]); return }
            let (h, tmp, dest) = e
            try? h.close()
            do {
                if FileManager.default.fileExists(atPath: dest.path) { try FileManager.default.removeItem(at: dest) }
                try FileManager.default.moveItem(at: tmp, to: dest)
                let rel = String(dest.path.dropFirst(documentsDir.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                send?("standSaved", ["id": id, "ok": true, "path": rel])
            } catch {
                try? FileManager.default.removeItem(at: tmp)
                send?("standSaved", ["id": id, "ok": false, "error": error.localizedDescription])
            }
        case "cancel":
            if let e = open.removeValue(forKey: id) { try? e.0.close(); try? FileManager.default.removeItem(at: e.1) }
        case "remove":
            // one file the app itself wrote earlier (a score copy that was renamed or moved)
            let parts = (body["path"] as? String ?? "").split(separator: "/").map { clean(String($0)) }
            guard parts.count >= 2, ["Scores", "Backups", "Recordings", "Backup"].contains(parts[0]) else { return }
            var url = documentsDir; for p in parts { url.appendPathComponent(p) }
            try? FileManager.default.removeItem(at: url)
            // a folder left empty goes too
            let dir = url.deletingLastPathComponent()
            if dir.lastPathComponent != parts[0], ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? ["x"]).isEmpty { try? FileManager.default.removeItem(at: dir) }
        case "purge":
            // the old backups made as .zip files (one each time): the folder backup replaces them
            for folder in ["Backups", "Recordings"] {
                let dir = documentsDir.appendingPathComponent(folder, isDirectory: true)
                let items = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
                for f in items where f.pathExtension.lowercased() == "zip" && f.lastPathComponent.hasPrefix("Stand") { try? FileManager.default.removeItem(at: f) }
                if ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? ["x"]).isEmpty { try? FileManager.default.removeItem(at: dir) }
            }
        case "keep":
            // the older files of a kind go, the newest few stay (backups do not fill the iPad)
            let dir = folderURL(body["folder"] as? String ?? "")
            let prefix = body["prefix"] as? String ?? ""
            let count = max(1, body["count"] as? Int ?? 3)
            let files = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
                .filter { !prefix.isEmpty && $0.lastPathComponent.hasPrefix(prefix) }
                .sorted { a, b in
                    let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                    let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                    return da > db
                }
            for f in files.dropFirst(count) { try? FileManager.default.removeItem(at: f) }
        default: break
        }
    }
    private func fail(_ id: String, _ why: String) {
        if let e = open.removeValue(forKey: id) { try? e.0.close(); try? FileManager.default.removeItem(at: e.1) }
        send?("standSaved", ["id": id, "ok": false, "error": why])
    }

    // Work that should finish even if you leave the app (a download from the iPad, a backup): iOS
    // gives the app some more time in the background (usually about half a minute).
    func busy(_ body: [String: Any]) {
        let why = body["why"] as? String ?? "work"
        if body["on"] as? Bool == true { busyWhy.insert(why) } else { busyWhy.remove(why) }
        if !busyWhy.isEmpty && busyTask == .invalid {
            busyTask = UIApplication.shared.beginBackgroundTask(withName: "Stand") { [weak self] in self?.endBusy() }
        } else if busyWhy.isEmpty {
            endBusy()
        }
    }
    private func endBusy() {
        busyWhy.removeAll()
        if busyTask != .invalid { UIApplication.shared.endBackgroundTask(busyTask); busyTask = .invalid }
    }

    func diag(_ body: [String: Any]) {
        switch body["op"] as? String {
        case "log":
            StandLog.write("page: " + (body["text"] as? String ?? ""))
        default:
            let files = ((try? FileManager.default.contentsOfDirectory(at: StandLog.dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])) ?? [])
            let list: [[String: Any]] = files.map { f in
                let v = try? f.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                return ["name": f.lastPathComponent, "size": v?.fileSize ?? 0, "date": (v?.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000]
            }
            let log = (try? String(contentsOf: StandLog.dir.appendingPathComponent("events.log"), encoding: .utf8)) ?? ""
            send?("standDiagList", ["files": list, "log": String(log.suffix(6000))])
        }
    }
}
