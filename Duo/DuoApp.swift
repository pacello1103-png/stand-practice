import SwiftUI
import AVFoundation

@main
struct DuoApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onAppear {
                    model.sync.begin()
                    AVAudioApplication.requestRecordPermission { _ in }
                }
        }
        .onChange(of: phase) { _, newPhase in
            if newPhase == .active { model.sync.begin() }
        }
    }
}
