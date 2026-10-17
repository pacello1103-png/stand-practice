import SwiftUI

struct Inspector: View {
    @ObservedObject var model: EditorModel
    @Binding var tab: InspectorTab

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                ForEach(InspectorTab.allCases) { t in
                    Button { tab = t } label: {
                        HStack(spacing: 5) {
                            Image(systemName: t.symbol)
                            Text(t.label).lineLimit(1).fixedSize()
                        }
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
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
        }
    }
}

private struct Note: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 12)).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
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
                    Note(text: "Play and listen, then tap a camera angle to cut to it right there.")
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
                            Text(formatTimecode(cut.time, fps: model.project.fps)).font(Theme.num(13)).foregroundStyle(Theme.muted).fixedSize()
                        }
                        FlowLayout {
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
                VStack(alignment: .leading, spacing: 10) {
                    SectionTitle(text: "Start and end")
                    HStack(spacing: 8) {
                        Chip(label: "Start here", symbol: "arrow.right.to.line", selected: model.project.trimIn != nil) { model.setIn() }
                        Chip(label: "End here", symbol: "arrow.left.to.line", selected: model.project.trimOut != nil) { model.setOut() }
                        if model.project.isTrimmed {
                            Button { model.clearTrim() } label: { Image(systemName: "xmark.circle.fill") }
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    Note(text: model.project.isTrimmed
                         ? "The film runs \(formatClock(model.project.start)) – \(formatClock(model.project.end))."
                         : "Move the playhead and tap to leave out the tuning or the applause.")
                    ToggleRow(title: "Fade in from black", isOn: Binding(get: { model.project.fadeIn ?? false },
                                                                         set: { v in model.project.fadeIn = v; model.refreshProgram() }))
                    ToggleRow(title: "Fade out at the end", isOn: Binding(get: { model.project.fadeOut ?? false },
                                                                           set: { v in model.project.fadeOut = v; model.refreshProgram() }))
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
                            .contentShape(Rectangle())
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
        FlowLayout {
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
                VStack(alignment: .leading, spacing: 10) {
                    SectionTitle(text: "Shape of the film")
                    FlowLayout {
                        Chip(label: "Auto · \(model.project.outputFormat.label)", symbol: "wand.and.stars", selected: model.project.format == nil) {
                            model.setFormat(nil)
                        }
                        ForEach(ProjectFormat.allCases) { f in
                            Chip(label: f.label, symbol: f.symbol, selected: model.project.format == f) { model.setFormat(f) }
                        }
                    }
                    Note(text: "Cameras filmed the other way round are shown whole, on a soft background — never cut off.")
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Match the cameras")
                    ToggleRow(title: "Same look on every camera", detail: "Brightness and colour matched to one camera.",
                              isOn: Binding(get: { pic.matchLook }, set: { v in model.setPicture { $0.matchLook = v } }))
                    if pic.matchLook {
                        FlowLayout {
                            Text("Like").font(.system(size: 13)).foregroundStyle(Theme.muted).frame(height: 34)
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
                    SliderRow(title: "Sharpness", value: Binding(get: { pic.detail }, set: { v in model.setPicture { $0.detail = v } }),
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
                        FlowLayout {
                            ForEach(model.project.cams, id: \.self) { c in
                                Chip(label: "CAM \(c)", selected: currentCam == c, tint: Theme.cam(c).opacity(0.9)) { cam = c }
                            }
                        }
                        Text("\(clip.device) · \(clip.width)×\(clip.height)").font(.system(size: 12)).foregroundStyle(Theme.muted)
                        let fills = clip.fills(model.project.outputFormat)
                        FlowLayout {
                            Chip(label: "Fill the frame", symbol: "rectangle.fill", selected: fills) { model.setClip(cam: currentCam) { $0.fit = false } }
                            Chip(label: "Show it all", symbol: "rectangle.inset.filled", selected: !fills) { model.setClip(cam: currentCam) { $0.fit = true } }
                        }
                        SliderRow(title: "Exposure", value: clipBinding(\.look.exposure), range: -1.5...1.5, format: { String(format: "%+.1f EV", $0) })
                        SliderRow(title: "Warmth", value: clipBinding(\.look.warmth), range: -1...1, format: { String(format: "%+.0f", $0 * 100) })
                        SliderRow(title: "Tint", value: clipBinding(\.look.tint), range: -1...1, format: { String(format: "%+.0f", $0 * 100) })
                        SliderRow(title: "Zoom", value: clipBinding(\.framing.zoom), range: 1...3, format: { String(format: "%.2f×", $0) })
                        FramingPad(framing: clip.framing, aspect: model.project.outputFormat.aspect) { f in model.setClip(cam: currentCam) { $0.framing = f } }
                        if clip.framing.zoom > 1.4 {
                            Note(text: clip.width >= 3000 || clip.height >= 3000
                                 ? "Recorded in 4K: zooming up to 2× stays sharp in a 1080p film."
                                 : "This camera recorded in HD: Tutti adds detail back when zooming, but 4K zooms better.")
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
                        Button("Reset this camera") { model.setClip(cam: currentCam) { $0.look = CamLook(); $0.framing = Framing(); $0.fit = nil } }
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
        let p = model.project
        model.setPicture { $0.reference = reference }
        Task {
            var samples: [Int: [LookMatch.Sample]] = [:]
            for c in p.videoClips {
                samples[c.cam] = await LookMatch.analyze(url: model.store.url(p, c.file!), duration: c.duration, maxSamples: 16)
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
    var aspect: Double
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
                    Text("Zoom in, then drag to frame").font(.system(size: 11)).foregroundStyle(Theme.muted)
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
        .aspectRatio(CGFloat(aspect), contentMode: .fit)
        .frame(maxHeight: 200)
    }
}

// MARK: - Sound

private struct SoundPanel: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        let s = model.project.sound
        VStack(spacing: 12) {
            if !model.project.prepared {
                Card(padding: 14) {
                    HStack(spacing: 10) {
                        ProgressView()
                        Note(text: "Preparing the microphones… the sound controls work as soon as this is done.")
                    }
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    SectionTitle(text: "Quick start")
                    FlowLayout {
                        ForEach(["Natural", "Concert", "Intimate", "Church", "Voice"], id: \.self) { name in
                            Chip(label: name, selected: s.preset == name) { model.applyPreset(name) }
                        }
                    }
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Space")
                    FlowLayout {
                        ForEach(RoomSound.allCases, id: \.self) { r in
                            Chip(label: r.label, selected: s.reverb == r) {
                                model.setSound {
                                    $0.reverb = r
                                    $0.preset = "Custom"
                                    if r != .none && $0.reverbAmount < 0.1 { $0.reverbAmount = 0.4 }
                                }
                            }
                        }
                    }
                    Note(text: s.reverb.detail)
                    if s.reverb != .none {
                        SliderRow(title: "How much \(s.reverb.label.lowercased())", value: soundBinding(\.reverbAmount), range: 0...1,
                                  format: { "\(Int($0 * 100))%" })
                        SliderRow(title: "Size", value: Binding(get: { s.reverbSize ?? 0.5 }, set: { v in model.setSound { $0.reverbSize = v } }),
                                  range: 0...1, format: { $0 < 0.4 ? "Smaller" : ($0 > 0.6 ? "Bigger" : "Normal") })
                    }
                }
            }
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 12) {
                    SectionTitle(text: "Microphones")
                    Note(text: "Main: the good microphone. Room: the other cameras add the sound of the hall, like a real recording.")
                    ForEach(model.project.audioClips.sorted { $0.cam < $1.cam }) { clip in
                        MicRow(model: model, clip: clip)
                    }
                    if s.mics.contains(where: { $0.role == .room }) {
                        SliderRow(title: "Room", value: soundBinding(\.room), range: 0...1, format: { "\(Int($0 * 100))%" })
                        SliderRow(title: "Width", value: soundBinding(\.roomWidth), range: 0...1, format: { "\(Int($0 * 100))%" })
                    }
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
                VStack(alignment: .leading, spacing: 10) {
                    SectionTitle(text: "Loudness")
                    FlowLayout {
                        Chip(label: "Online −14", selected: s.target == -14) { model.setSound { $0.target = -14 } }
                        Chip(label: "Quiet −18", selected: s.target == -18) { model.setSound { $0.target = -18 } }
                        Chip(label: "TV −23", selected: s.target == -23) { model.setSound { $0.target = -23 } }
                    }
                    Note(text: "The finished film is measured and set to this loudness (LUFS), with a limiter so peaks never distort.")
                }
            }
        }
    }

    private var signed: (Double) -> String { { String(format: "%+.0f", $0 * 100) } }

    private func soundBinding(_ path: WritableKeyPath<SoundSettings, Double>) -> Binding<Double> {
        Binding(get: { model.project.sound[keyPath: path] },
                set: { v in
                    model.setSound {
                        $0[keyPath: path] = v
                        if path != \SoundSettings.room && path != \SoundSettings.roomWidth && path != \SoundSettings.reverbAmount { $0.preset = "Custom" }
                    }
                })
    }
}

private struct MicRow: View {
    @ObservedObject var model: EditorModel
    let clip: Clip

    private var mic: MicSetting {
        model.project.sound.mics.first { $0.cam == clip.cam } ?? MicSetting(cam: clip.cam, role: .room)
    }

    private func update(_ change: @escaping (inout MicSetting) -> Void) {
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
                    Chip(label: r.label, selected: mic.role == r, tint: r == .main ? Theme.accent : (r == .room ? Theme.accent.opacity(0.55) : Theme.rec.opacity(0.7))) {
                        update { $0.role = r }
                        if r == .main {
                            model.setSound { s in
                                for i in s.mics.indices where s.mics[i].cam != clip.cam && s.mics[i].role == .main { s.mics[i].role = .room }
                            }
                        }
                    }
                }
            }
            if mic.role != .off {
                compactSlider("Level", value: mic.gain, range: -12...12, text: String(format: "%+.0f dB", mic.gain)) { v in update { $0.gain = v } }
                compactSlider("Pan", value: mic.pan, range: -1...1,
                              text: abs(mic.pan) < 0.05 ? "C" : (mic.pan < 0 ? "L\(Int(-mic.pan * 100))" : "R\(Int(mic.pan * 100))")) { v in update { $0.pan = v } }
                compactSlider("Clean", value: mic.denoise ?? 0, range: 0...1,
                              text: model.cleaning.contains(clip.cam) ? "…" : ((mic.denoise ?? 0) < 0.02 ? "Off" : "\(Int((mic.denoise ?? 0) * 100))%")) { v in
                    update { $0.denoise = v < 0.02 ? nil : v }
                }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.sunk.opacity(0.6)))
    }

    private func compactSlider(_ title: String, value: Double, range: ClosedRange<Double>, text: String, set: @escaping (Double) -> Void) -> some View {
        HStack(spacing: 10) {
            Text(title).font(.system(size: 12)).foregroundStyle(Theme.muted).frame(width: 40, alignment: .leading)
            Slider(value: Binding(get: { value }, set: set), in: range).tint(Theme.accentText)
            Text(text).font(Theme.num(11)).foregroundStyle(Theme.muted).frame(width: 46, alignment: .trailing)
        }
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
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let p = model.exportProgress {
                        VStack(spacing: 14) {
                            TuttiMark(size: 54)
                            Text(model.exportText).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                            ProgressView(value: p).tint(Theme.accentText)
                            Text("\(Int(p * 100))%").font(Theme.num(14)).foregroundStyle(Theme.muted)
                            Note(text: "You can leave Tutti for a moment — the export carries on, and continues when you come back.")
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
                                FlowLayout {
                                    Chip(label: sizeLabel(uhd: false), selected: !options.uhd) { options.uhd = false }
                                    Chip(label: sizeLabel(uhd: true), selected: options.uhd) { options.uhd = true }
                                }
                                SectionTitle(text: "Quality")
                                FlowLayout {
                                    ForEach(ExportQuality.allCases) { q in
                                        Chip(label: q.label, selected: options.quality == q) { options.quality = q }
                                    }
                                }
                                Note(text: options.quality.detail)
                                Note(text: "Every frame is rendered from the original camera files. Sound at \(Int(model.project.sound.target)) LUFS.")
                            }
                        }
                        if let e = model.exportError { Text(e).font(.system(size: 13)).foregroundStyle(Theme.warn) }
                        PrimaryButton(title: "Export", symbol: "film") { model.export(options) }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } }
            }
        }
        .interactiveDismissDisabled(model.exportProgress != nil)
        .onAppear {
            // 4K by default when the cameras filmed in 4K
            options.uhd = model.project.videoClips.contains { max($0.width, $0.height) >= 3000 }
        }
    }

    private func sizeLabel(uhd: Bool) -> String {
        let s = model.project.outputFormat.size(uhd: uhd)
        return "\(uhd ? "4K" : "HD") · \(Int(s.width))×\(Int(s.height))"
    }
}
