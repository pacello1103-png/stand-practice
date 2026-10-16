import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct HomeView: View {
    @EnvironmentObject var store: ProjectStore
    @EnvironmentObject var router: Router
    @Environment(\.horizontalSizeClass) private var hsize
    @State private var picked: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var busy: String?
    @State private var showSettings = false
    @State private var renaming: Project?
    @State private var newName = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                roles
                recordings
            }
            .padding(.horizontal, hsize == .regular ? 40 : 18)
            .padding(.vertical, 24)
            .frame(maxWidth: 1100)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg.ignoresSafeArea())
        .photosPicker(isPresented: $showPhotos, selection: $picked, maxSelectionCount: 8, matching: .videos)
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.movie, .audio], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result, !urls.isEmpty { importURLs(urls) }
        }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            importPicked(items)
        }
        .sheet(isPresented: $showSettings) { DeviceSettingsSheet().tuttiSheetBackground() }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Save") {
                if var p = renaming { p.name = newName; store.save(p) }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .overlay {
            if let busy {
                ZStack {
                    Color.black.opacity(0.5).ignoresSafeArea()
                    Card {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text(busy).foregroundStyle(Theme.ink)
                        }
                    }
                }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            TuttiMark(size: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text("Tutti").font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(Theme.ink)
                Text("Every iPhone and iPad becomes a camera.").font(.system(size: 15)).foregroundStyle(Theme.muted)
            }
            Spacer()
            RoundIcon(symbol: "gearshape", size: 40) { showSettings = true }
        }
    }

    private var roles: some View {
        let layout = hsize == .regular ? AnyLayout(HStackLayout(spacing: 16)) : AnyLayout(VStackLayout(spacing: 12))
        return layout {
            RoleCard(title: "Director", subtitle: "See every camera, switch live, start and stop them all together. Usually the iPad.",
                     symbol: "rectangle.split.2x2", color: Theme.accent) { router.screen = .director }
            RoleCard(title: "Camera", subtitle: "Film from this device. It finds the director by itself over Wi‑Fi.",
                     symbol: "video", color: Theme.sunk2) { router.screen = .camera }
        }
    }

    private var recordings: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                SectionTitle(text: "Recordings")
                Menu {
                    Button { showPhotos = true } label: { Label("Videos from Photos", systemImage: "photo.on.rectangle") }
                    Button { showFiles = true } label: { Label("Videos or sound from Files", systemImage: "folder") }
                    Button { makeDemo() } label: { Label("Demo recording", systemImage: "sparkles") }
                } label: {
                    Label("Import", systemImage: "plus")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, 12).frame(minHeight: 32)
                        .background(Capsule().fill(Theme.sunk))
                        .foregroundStyle(Theme.ink)
                }
            }
            if store.projects.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No recordings yet").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
                        Text("Open Tutti on each iPhone and tap Camera, then tap Director on the iPad. Or import videos you already filmed — Tutti lines them up by their sound.")
                            .font(.system(size: 14)).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: hsize == .regular ? 300 : 160), spacing: 14)], spacing: 14) {
                    ForEach(store.projects) { p in
                        ProjectCard(project: p, thumb: store.thumbnail(p))
                            .onTapGesture { router.screen = .editor(p.id) }
                            .contextMenu {
                                Button { newName = p.name; renaming = p } label: { Label("Rename", systemImage: "pencil") }
                                Button(role: .destructive) { store.delete(p) } label: { Label("Delete", systemImage: "trash") }
                            }
                    }
                }
            }
        }
    }

    private func importPicked(_ items: [PhotosPickerItem]) {
        busy = "Importing \(items.count) video\(items.count == 1 ? "" : "s")…"
        Task {
            var urls: [URL] = []
            for item in items {
                if let m = try? await item.loadTransferable(type: PickedMovie.self) { urls.append(m.url) }
            }
            await MainActor.run { picked = [] }
            await finishImport(urls, temporary: true)
        }
    }

    private func importURLs(_ urls: [URL]) {
        busy = "Importing…"
        Task { await finishImport(urls, temporary: false) }
    }

    private func finishImport(_ urls: [URL], temporary: Bool) async {
        guard !urls.isEmpty else { await MainActor.run { busy = nil }; return }
        let p = await Importer.makeProject(from: urls, store: store)
        if temporary { urls.forEach { try? FileManager.default.removeItem(at: $0) } }
        await MainActor.run {
            busy = nil
            router.screen = .editor(p.id)
        }
    }

    private func makeDemo() {
        busy = "Making a demo recording…"
        Task {
            let p = try? await Demo.makeProject(store: store)
            await MainActor.run {
                busy = nil
                if let p { router.screen = .editor(p.id) }
            }
        }
    }
}

struct RoleCard: View {
    let title: String
    let subtitle: String
    let symbol: String
    let color: Color
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .semibold))
                    .frame(width: 54, height: 54)
                    .foregroundStyle(Color.white)
                    .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(color))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(Theme.ink)
                    Text(subtitle).font(.system(size: 14)).foregroundStyle(Theme.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(Theme.muted).padding(.top, 4)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Theme.line))
            .overlay(alignment: .top) {
                Theme.rainbow.frame(height: 3).clipShape(Capsule()).padding(.horizontal, 22).opacity(title == "Director" ? 1 : 0)
            }
        }
        .buttonStyle(.plain)
    }
}

struct ProjectCard: View {
    let project: Project
    let thumb: URL
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack(alignment: .bottomLeading) {
                Rectangle().fill(Theme.stage)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay {
                        if let img = UIImage(contentsOfFile: thumb.path) {
                            Image(uiImage: img).resizable().scaledToFill()
                        } else {
                            TuttiMark(size: 36).opacity(0.6)
                        }
                    }
                    .clipped()
                HStack(spacing: 4) {
                    ForEach(project.cams, id: \.self) { CamBadge(cam: $0) }
                    Spacer()
                    Text(formatClock(project.duration))
                        .font(Theme.num(12)).foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Capsule().fill(Color.black.opacity(0.55)))
                }
                .padding(8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(project.created.formatted(date: .abbreviated, time: .shortened)).font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
        }
        .contentShape(Rectangle())
    }
}

struct DeviceSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = DeviceName.current
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                } header: {
                    Text("This device's name")
                } footer: {
                    Text("Shown to the director, so you know which camera is which.")
                }
                Section("About") {
                    Text("Tutti records on every device at once, sends the clips to the director and edits them together. Nothing is uploaded — everything stays on your devices.")
                        .font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { DeviceName.current = name; dismiss() }
                }
            }
        }
    }
}
