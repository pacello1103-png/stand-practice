import SwiftUI
import AVFoundation

@main
struct TuttiApp: App {
    @StateObject private var store = ProjectStore()
    @StateObject private var router = Router()

    init() {
        let nav = UINavigationBarAppearance()
        nav.configureWithTransparentBackground()
        UINavigationBar.appearance().standardAppearance = nav
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(router)
                .preferredColorScheme(.dark)
                .tint(Theme.accentText)
        }
    }
}

final class Router: ObservableObject {
    enum Screen: Equatable {
        case home, director, camera, editor(UUID)
    }
    @Published var screen: Screen = .home
    var demoTab: String?
}

struct RootView: View {
    @EnvironmentObject var router: Router
    @EnvironmentObject var store: ProjectStore
    @State private var launched = false

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            switch router.screen {
            case .home:
                HomeView().transition(.opacity)
            case .director:
                DirectorScreen(store: store).transition(.opacity)
            case .camera:
                CameraScreen().transition(.opacity)
            case .editor(let id):
                if let p = store.project(id) {
                    EditorScreen(project: p, store: store).id(id).transition(.opacity)
                } else {
                    HomeView()
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: router.screen)
        .onAppear {
            guard !launched else { return }
            launched = true
            Demo.handleLaunch(store: store, router: router)
        }
    }
}
