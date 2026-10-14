import SwiftUI

struct ContentView: View {
    @EnvironmentObject var model: AppModel
    @State private var showSettings = false
    @FocusState private var linkFocused: Bool

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
                .onTapGesture { linkFocused = false }

            VStack(spacing: 22) {
                header
                connection
                movieCard
                Spacer(minLength: 8)
                StartButton(running: model.isRunning) {
                    linkFocused = false
                    model.start()
                }
                Text(model.status.isEmpty ? footnote : model.status)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .frame(minHeight: 36)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 22)
            .padding(.top, 10)
            .frame(maxWidth: 520)
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showSettings) {
            SettingsView().environmentObject(model)
        }
    }

    private var footnote: String {
        model.sync.isConnected ? "Tap Start on either device." : "Open Duo on the other device too."
    }

    private var header: some View {
        HStack {
            Text("Duo")
                .font(.system(size: 34, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.text)
            Spacer()
            Button { showSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .frame(width: 40, height: 40)
                    .background(Theme.card, in: Circle())
            }
            .accessibilityLabel("Settings")
        }
    }

    private var connection: some View {
        let names = model.sync.connectedNames
        let on = !names.isEmpty
        return HStack(spacing: 10) {
            Circle()
                .fill(on ? Theme.mint : Theme.muted.opacity(0.6))
                .frame(width: 8, height: 8)
            Text(on ? "Connected to \(names.joined(separator: ", "))" : "Looking for your other device…")
                .font(.subheadline)
                .foregroundStyle(on ? Theme.text : Theme.muted)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var movieCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Movie")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.muted)
                .textCase(.uppercase)
            HStack(spacing: 10) {
                TextField("Paste a Netflix or Prime link", text: Binding(
                    get: { model.sync.movieLink },
                    set: { model.sync.movieLink = $0 }
                ))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .focused($linkFocused)
                    .foregroundStyle(Theme.text)
                if model.sync.movieLink.isEmpty {
                    Button("Paste") {
                        if let s = UIPasteboard.general.string { model.sync.movieLink = s }
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.lilac)
                } else {
                    Button { model.sync.movieLink = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted)
                    }
                    .accessibilityLabel("Clear link")
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text(AppModel.describe(model.sync.movieLink))
                .font(.footnote)
                .foregroundStyle(Theme.muted)
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct StartButton: View {
    var running: Bool
    var action: () -> Void
    @State private var spin = false

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle().fill(Theme.card)
                Circle()
                    .strokeBorder(Theme.ring, lineWidth: 3)
                    .rotationEffect(.degrees(spin ? 360 : 0))
                VStack(spacing: 8) {
                    Image(systemName: running ? "hourglass" : "play.fill")
                        .font(.system(size: 38, weight: .medium))
                    Text(running ? "Starting" : "Start")
                        .font(.system(size: 18, weight: .semibold, design: .rounded))
                }
                .foregroundStyle(Theme.text)
            }
            .frame(width: 190, height: 190)
        }
        .buttonStyle(.plain)
        .disabled(running)
        .onChange(of: running) { _, now in
            if now {
                withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) { spin = true }
            } else {
                withAnimation(.default) { spin = false }
            }
        }
        .accessibilityLabel("Start")
    }
}
