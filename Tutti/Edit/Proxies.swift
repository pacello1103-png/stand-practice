import AVFoundation

/// Small copies of every camera (like proxies in DaVinci): the angle previews in the editor play
/// these, so the iPad is not decoding several 4K files at once. The film itself always uses the originals.
enum Proxies {
    static func make(project p: Project, store: ProjectStore, done: @escaping (Int, String) -> Void) async {
        for c in p.videoClips where c.proxyFile == nil {
            guard let f = c.file else { continue }
            let name = "cam\(c.cam)-proxy.mp4"
            let out = store.url(p, name)
            if FileManager.default.fileExists(atPath: out.path) { done(c.cam, name); continue }
            let asset = AVURLAsset(url: store.url(p, f))
            guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset960x540) else { continue }
            let tmp = store.url(p, "cam\(c.cam)-proxy-partial.mp4")
            try? FileManager.default.removeItem(at: tmp)
            session.outputURL = tmp
            session.outputFileType = .mp4
            session.shouldOptimizeForNetworkUse = false
            await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
                session.exportAsynchronously { k.resume() }
            }
            if session.status == .completed, (try? FileManager.default.moveItem(at: tmp, to: out)) != nil {
                done(c.cam, name)
            } else {
                try? FileManager.default.removeItem(at: tmp)
            }
        }
    }
}
