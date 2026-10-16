import SwiftUI

struct Inspector: View {
    @ObservedObject var model: EditorModel
    @Binding var tab: InspectorTab

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 6) {
                ForEach(InspectorTab.allCases) { t in
                    Button { tab = t } label: {
                        Label(t.label, systemImage: t.symbol)
                            .font(.system(size: 13, weight: .semibold))
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .foregroundStyle(tab == t ? Color.white : Theme.ink)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(tab == t ? Theme.accent : Theme.sunk))
                    }
                    .buttonStyle(.plain)
                }
            }
            ScrollView {
                Group {
                    switch tab {
                    case .cut: CutPanel(model: model)
                    case .picture: PicturePanel(model: model)
                    case .sound: SoundPanel(model: model)
                    }
                }
                .padding(.bottom, 20)
            }
            .scrollIndicators(.hidden)
        }
    }
}

// MARK: - Cuts

private struct CutPanel: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        VStack(spacing: 12) {
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    SectionTitle(text: "Next cut")
                    Text("Play and listen, then tap a camera angle to cut to it right there — or pause, place the playhead and tap.")
                        .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    TransitionChips(selected: model.transition) { model.transition = $0 }
                    if model.transition != .cut {
                        SliderRow(title: "Length", value: $model.transitionLength, range: 0.2...2.5, format: { String(format: "%.1f s", $0) })
                    }
                }
            }
            if let cut = model.selected {
                Card(padding: 14) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            SectionTitle(text: "Selected cut")
                            Text(formatTimecode(cut.time, fps: model.project.fps)).font(Theme.num(13)).foregroundStyle(Theme.muted)
                        }
                        HStack(spacing: 6) {
                            ForEach(model.project.cams, id: \.self) { cam in
                                Chip(label: "CAM \(cam)", selected: cut.cam == cam, tint: Theme.cam(cam).opacity(0.9)) {
                                    model.updateSelected { $0.cam = cam }
                                }
                            }
                        }
                        if cut.time > 0.001 {
                            TransitionChips(selected: cut.kind) { k in model.updateSelected { $0.kind = k } }
                            if cut.kind != .cut {
                                SliderRow(title: "Length",
                                          value: Binding(get: { cut.length }, set: { v in model.updateSelected { $0.length = v } }),
                                          range: 0.2...2.5, format: { String(format: "%.1f s", $0) })
                            }
                            HStack {
                                Button { model.seek(to: max(0, cut.time - 2)) } label: { Label("Watch it", systemImage: "play.circle") }
                                Spacer()
                                Button(role: .destructive) { model.deleteSelected() } label: { Label("Remove", systemImage: "trash") }
                            }
                            .font(.system(size: 14, weight: .semibold))
                        }
                    }
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle(text: "All cuts")
                    ForEach(model.project.cuts.sorted { $0.time < $1.time }) { c in
                        Button {
                            model.selectedCut = c.id
                            model.seek(to: c.time)
                        } label: {
                            HStack(spacing: 10) {
                                Text(formatClock(c.time)).font(Theme.num(13)).foregroundStyle(Theme.muted).frame(width: 52, alignment: .leading)
                                CamBadge(cam: c.cam)
                                if c.time > 0.001 && c.kind != .cut {
                                    Label(c.kind.label, systemImage: c.kind.symbol).font(.system(size: 12)).foregroundStyle(Theme.ink)
                                } else {
                                    Text(c.time < 0.001 ? "Start" : "Cut").font(.system(size: 12)).foregroundStyle(Theme.ink)
                                }
                                Spacer()
                                if c.id == model.selectedCut { Image(systemName: "checkmark").foregroundStyle(Theme.accentText) }
                            }
                            .padding(.vertical, 3)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

struct TransitionChips: View {
    let selected: TransitionKind
    let pick: (TransitionKind) -> Void
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], spacing: 6) {
            ForEach(TransitionKind.allCases) { k in
                Chip(label: k.label, symbol: k.symbol, selected: selected == k) { pick(k) }
            }
        }
    }
}

// MARK: - Picture

private struct PicturePanel: View {
    @ObservedObject var model: EditorModel
    @State private var cam = 1

    var body: some View {
        let pic = model.project.picture
        VStack(spacing: 12) {
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Match the cameras")
                    ToggleRow(title: "Same look on every camera", detail: "Brightness and colour matched to one camera.",
                              isOn: Binding(get: { pic.matchLook }, set: { v in model.setPicture { $0.matchLook = v } }))
                    if pic.matchLook {
                        HStack(spacing: 6) {
                            Text("Like").font(.system(size: 13)).foregroundStyle(Theme.muted)
                            ForEach(model.project.cams, id: \.self) { c in
                                Chip(label: "CAM \(c)", selected: pic.reference == c, tint: Theme.cam(c).opacity(0.9)) {
                                    rematch(reference: c)
                                }
                            }
                        }
                        SliderRow(title: "Strength", value: Binding(get: { pic.strength }, set: { v in model.setPicture { $0.strength = v } }),
                                  range: 0...1, format: { "\(Int($0 * 100))%" })
                        ToggleRow(title: "Steady brightness", detail: "Smooths exposure that drifts during a take.",
                                  isOn: Binding(get: { pic.steady }, set: { v in model.setPicture { $0.steady = v } }))
                    }
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Whole film")
                    SliderRow(title: "Detail", value: Binding(get: { pic.detail }, set: { v in model.setPicture { $0.detail = v } }),
                              range: 0...1, format: { "\(Int($0 * 100))%" })
                    SliderRow(title: "Contrast", value: Binding(get: { pic.contrast }, set: { v in model.setPicture { $0.contrast = v } }),
                              range: 0.8...1.25, format: { String(format: "%+.0f", ($0 - 1) * 100) })
                    SliderRow(title: "Saturation", value: Binding(get: { pic.saturation }, set: { v in model.setPicture { $0.saturation = v } }),
                              range: 0.6...1.4, format: { String(format: "%+.0f", ($0 - 1) * 100) })
                    SliderRow(title: "Vibrance", value: Binding(get: { pic.vibrance }, set: { v in model.setPicture { $0.vibrance = v } }),
                              range: -0.5...0.8, format: { String(format: "%+.0f", $0 * 100) })
                }
            }
            if let clip = model.project.clip(cam: currentCam) {
                Card(padding: 14) {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionTitle(text: "One camera")
                        HStack(spacing: 6) {
                            ForEach(model.project.cams, id: \.self) { c in
                                Chip(label: "CAM \(c)", selected: currentCam == c, tint: Theme.cam(c).opacity(0.9)) { cam = c }
                            }
                        }
                        Text(clip.device).font(.system(size: 12)).foregroundStyle(Theme.muted)
                        SliderRow(title: "Exposure", value: clipBinding(\.look.exposure), range: -1.5...1.5, format: { String(format: "%+.1f EV", $0) })
                        SliderRow(title: "Warmth", value: clipBinding(\.look.warmth), range: -1...1, format: { String(format: "%+.0f", $0 * 100) })
                        SliderRow(title: "Tint", value: clipBinding(\.look.tint), range: -1...1, format: { String(format: "%+.0f", $0 * 100) })
                        SliderRow(title: "Zoom", value: clipBinding(\.framing.zoom), range: 1...3, format: { String(format: "%.2f×", $0) })
                        FramingPad(framing: clip.framing) { f in model.setClip(cam: currentCam) { $0.framing = f } }
                        if clip.framing.zoom > 1.5 {
                            Text(clip.width >= 3000 ? "Recorded in 4K: zooming up to 2× stays sharp in a 1080p film." : "Zooming a 1080p recording softens it — Tutti adds detail back, but 4K recordings zoom better.")
                                .font(.system(size: 12)).foregroundStyle(Theme.muted)
                        }
                        if let moves = clip.moves, !moves.isEmpty {
                            HStack {
                                Label("\(moves.count) framing move\(moves.count == 1 ? "" : "s") from the director", systemImage: "scope")
                                    .font(.system(size: 13)).foregroundStyle(Theme.ink)
                                Spacer()
                                Button("Remove") { model.setClip(cam: currentCam) { $0.moves = nil } }
                                    .font(.system(size: 13, weight: .semibold))
                            }
                        }
                        Button("Reset this camera") { model.setClip(cam: currentCam) { $0.look = CamLook(); $0.framing = Framing() } }
                            .font(.system(size: 14, weight: .semibold))
                    }
                }
            }
        }
        .onAppear { cam = model.project.cams.first ?? 1 }
    }

    private var currentCam: Int { model.project.cams.contains(cam) ? cam : (model.project.cams.first ?? 1) }

    private func clipBinding(_ path: WritableKeyPath<Clip, Double>) -> Binding<Double> {
        let c = currentCam
        return Binding(get: { model.project.clip(cam: c)?[keyPath: path] ?? 0 },
                       set: { v in model.setClip(cam: c) { $0[keyPath: path] = v } })
    }

    private func rematch(reference: Int) {
        // the reference changes, so every camera's correction is recomputed relative to it
        let p = model.project
        model.setPicture { $0.reference = reference }
        Task {
            var samples: [Int: [LookMatch.Sample]] = [:]
            for c in p.videoClips {
                samples[c.cam] = await LookMatch.analyze(url: model.store.url(p, c.file!), duration: c.duration, maxSamples: 24)
            }
            await MainActor.run {
                for c in p.videoClips {
                    let look = LookMatch.match(cam: samples[c.cam] ?? [], ref: samples[reference] ?? [], isReference: c.cam == reference)
                    model.setClip(cam: c.cam) { $0.auto = look }
                }
            }
        }
    }
}

/// Drag inside the frame to choose which part of the picture stays in view when zoomed.
private struct FramingPad: View {
    let framing: Framing
    let change: (Framing) -> Void
    @State private var start: Framing?

    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            let z = CGFloat(max(1, framing.zoom))
            let fw = w / z, fh = h / z
            let cx = w / 2 + CGFloat(framing.x) * (w - fw) / 2
            let cy = h / 2 + CGFloat(framing.y) * (h - fh) / 2
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(Theme.sunk)
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Theme.accentText, lineWidth: 2)
                    .background(RoundedRectangle(cornerRadius: 4).fill(Theme.accentSoft))
                    .frame(width: fw, height: fh)
                    .position(x: cx, y: cy)
                if z <= 1.01 {
                    Text("Zoom in to choose the framing").font(.system(size: 11)).foregroundStyle(Theme.muted)
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture()
                .onChanged { v in
                    if start == nil { start = framing }
                    guard let s = start, z > 1.01 else { return }
                    var f = s
                    let spareW = max(1, (w - fw) / 2), spareH = max(1, (h - fh) / 2)
                    f.x = max(-1, min(1, s.x + Double(v.translation.width / spareW)))
                    f.y = max(-1, min(1, s.y + Double(v.translation.height / spareH)))
                    change(f)
                }
                .onEnded { _ in start = nil })
        }
        .aspectRatio(16 / 9, contentMode: .fit)
    }
}

// MARK: - Sound

private struct SoundPanel: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        let s = model.project.sound
        VStack(spacing: 12) {
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    SectionTitle(text: "Sound")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], spacing: 6) {
                        ForEach(["Natural", "Concert", "Intimate", "Church", "Voice"], id: \.self) { name in
                            Chip(label: name, selected: s.preset == name) { model.applyPreset(name) }
                        }
                    }
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Microphones")
                    Text("Main: the good microphone (an external mic on one device, or the closest phone). Room: the other cameras' microphones add the space of the hall, like a real recording.")
                        .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    ForEach(model.project.audioClips.sorted { $0.cam < $1.cam }) { clip in
                        MicRow(model: model, clip: clip)
                    }
                    SliderRow(title: "Room", value: soundBinding(\.room), range: 0...1, format: { "\(Int($0 * 100))%" })
                    SliderRow(title: "Room width", value: soundBinding(\.roomWidth), range: 0...1, format: { "\(Int($0 * 100))%" })
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Tone")
                    ToggleRow(title: "Low cut", detail: "Removes rumble below 70 Hz (air conditioning, steps).",
                              isOn: Binding(get: { s.lowCut }, set: { v in model.setSound { $0.lowCut = v; $0.preset = "Custom" } }))
                    SliderRow(title: "Warmth", value: soundBinding(\.warmth), range: -1...1, format: signed)
                    SliderRow(title: "Presence", value: soundBinding(\.presence), range: -1...1, format: signed)
                    SliderRow(title: "Air", value: soundBinding(\.air), range: -1...1, format: signed)
                    SliderRow(title: "Compression", value: soundBinding(\.compress), range: 0...1, format: { "\(Int($0 * 100))%" })
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Space")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 6)], spacing: 6) {
                        ForEach(RoomSound.allCases, id: \.self) { r in
                            Chip(label: r.label, selected: s.reverb == r) { model.setSound { $0.reverb = r; $0.preset = "Custom" } }
                        }
                    }
                    if s.reverb != .none {
                        SliderRow(title: "Amount", value: soundBinding(\.reverbAmount), range: 0...1, format: { "\(Int($0 * 100))%" })
                    }
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    SectionTitle(text: "Loudness")
                    HStack(spacing: 6) {
                        Chip(label: "Online −14", selected: s.target == -14) { model.setSound { $0.target = -14 } }
                        Chip(label: "Quiet −18", selected: s.target == -18) { model.setSound { $0.target = -18 } }
                        Chip(label: "TV −23", selected: s.target == -23) { model.setSound { $0.target = -23 } }
                    }
                    Text("The finished film is measured and set to this loudness (LUFS), with a limiter so peaks never distort.")
                        .font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private var signed: (Double) -> String { { String(format: "%+.0f", $0 * 100) } }

    private func soundBinding(_ path: WritableKeyPath<SoundSettings, Double>) -> Binding<Double> {
        Binding(get: { model.project.sound[keyPath: path] },
                set: { v in model.setSound { $0[keyPath: path] = v; if path != \SoundSettings.room && path != \SoundSettings.roomWidth { $0.preset = "Custom" } } })
    }
}

private struct MicRow: View {
    @ObservedObject var model: EditorModel
    let clip: Clip

    private var mic: MicSetting {
        model.project.sound.mics.first { $0.cam == clip.cam } ?? MicSetting(cam: clip.cam, role: .room)
    }

    private func update(_ change: (inout MicSetting) -> Void) {
        model.setSound { s in
            if let i = s.mics.firstIndex(where: { $0.cam == clip.cam }) {
                change(&s.mics[i])
            } else {
                var m = MicSetting(cam: clip.cam, role: .room)
                change(&m)
                s.mics.append(m)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if clip.hasVideo { CamBadge(cam: clip.cam) } else { Image(systemName: "mic.fill").foregroundStyle(Theme.accentText) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(clip.audioName.isEmpty ? clip.device : "\(clip.device) · \(clip.audioName)")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    if let note = clip.syncNote {
                        Text(note).font(.system(size: 11)).foregroundStyle(Theme.muted).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 6) {
                ForEach(MicRole.allCases, id: \.self) { r in
                    Chip(label: r.label, selected: mic.role == r, tint: r == .main ? Theme.accent : (r == .room ? Theme.sunk2 : Theme.rec.opacity(0.7))) {
                        update { m in
                            m.role = r
                        }
                        if r == .main {
                            // only one main microphone at a time
                            model.setSound { s in
                                for i in s.mics.indices where s.mics[i].cam != clip.cam && s.mics[i].role == .main { s.mics[i].role = .room }
                            }
                        }
                    }
                }
            }
            if mic.role != .off {
                HStack(spacing: 10) {
                    Text("Level").font(.system(size: 12)).foregroundStyle(Theme.muted)
                    Slider(value: Binding(get: { mic.gain }, set: { v in update { $0.gain = v } }), in: -12...12)
                        .tint(Theme.accentText)
                    Text(String(format: "%+.0f dB", mic.gain)).font(Theme.num(11)).foregroundStyle(Theme.muted).frame(width: 46)
                }
                HStack(spacing: 10) {
                    Text("Pan").font(.system(size: 12)).foregroundStyle(Theme.muted)
                    Slider(value: Binding(get: { mic.pan }, set: { v in update { $0.pan = v } }), in: -1...1)
                        .tint(Theme.accentText)
                    Text(mic.pan.magnitude < 0.05 ? "C" : (mic.pan < 0 ? "L\(Int(-mic.pan * 100))" : "R\(Int(mic.pan * 100))"))
                        .font(Theme.num(11)).foregroundStyle(Theme.muted).frame(width: 46)
                }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.sunk.opacity(0.6)))
    }
}

// MARK: - Export

struct ExportSheet: View {
    @ObservedObject var model: EditorModel
    @Environment(\.dismiss) private var dismiss
    @State private var options = ExportOptions()
    @State private var saved = false
    @State private var saveError: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                if let p = model.exportProgress {
                    VStack(spacing: 14) {
                        TuttiMark(size: 54)
                        Text(model.exportText).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                        ProgressView(value: p).tint(Theme.accentText)
                        Text("\(Int(p * 100))%").font(Theme.num(14)).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 20)
                } else if let url = model.exportedURL {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("Your film is ready", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.good)
                        PrimaryButton(title: saved ? "Saved to Photos" : "Save to Photos", symbol: saved ? "checkmark" : "photo.on.rectangle") {
                            Task {
                                do { try await Exporter.saveToPhotos(url); saved = true } catch { saveError = error.localizedDescription }
                            }
                        }
                        ShareLink(item: url) {
                            Label("Share or save to Files", systemImage: "square.and.arrow.up")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .foregroundStyle(Theme.ink)
                                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.sunk))
                        }
                        if let saveError { Text(saveError).font(.system(size: 13)).foregroundStyle(Theme.warn) }
                    }
                } else {
                    Card(padding: 14) {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionTitle(text: "Size")
                            HStack(spacing: 8) {
                                Chip(label: "1080p", selected: !options.uhd) { options.uhd = false }
                                Chip(label: "4K", selected: options.uhd) { options.uhd = true }
                            }
                            SectionTitle(text: "Quality")
                            HStack(spacing: 8) {
                                Chip(label: "Efficient (HEVC)", selected: !options.maxQuality) { options.maxQuality = false }
                                Chip(label: "Maximum", selected: options.maxQuality) { options.maxQuality = true }
                            }
                            Text("The sound is mixed and brought to \(Int(model.project.sound.target)) LUFS. Every frame is rendered from the original camera files.")
                                .font(.system(size: 12)).foregroundStyle(Theme.muted)
                        }
                    }
                    if let e = model.exportError { Text(e).font(.system(size: 13)).foregroundStyle(Theme.warn) }
                    PrimaryButton(title: "Export", symbol: "film") { model.export(options) }
                }
                Spacer()
            }
            .padding(20)
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } }
            }
        }
        .interactiveDismissDisabled(model.exportProgress != nil)
    }
}
