import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @AppStorage("sound") private var sound = CueSound.ee.rawValue
    @AppStorage("volume") private var volume = 0.5
    @AppStorage("delay") private var delay = 7.0
    @AppStorage("offsetMs") private var offsetMs = 0.0

    private var cue: CueSound { CueSound(rawValue: sound) ?? .ee }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Sound", selection: $sound) {
                        ForEach(CueSound.allCases) { Text($0.label).tag($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                    Text(cue.hint).font(.footnote).foregroundStyle(.secondary)
                    VStack(alignment: .leading) {
                        Text("Loudness")
                        Slider(value: $volume, in: 0.05...1)
                    }
                    Button(model.isTesting ? "Stop test sounds" : "Play test sounds") { model.toggleTest() }
                } header: {
                    Text("Cue sound")
                } footer: {
                    Text("Test sounds keep playing every 3 seconds for 30 seconds, even after you switch to Settings, so you can set up Switch Control. Use the softest level that still works.")
                }

                Section {
                    Stepper(value: $delay, in: 3...20, step: 1) {
                        HStack {
                            Text("Sound after")
                            Spacer()
                            Text("\(Int(delay)) s").foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                    VStack(alignment: .leading) {
                        HStack {
                            Text("Fine-tune this device")
                            Spacer()
                            Text(offsetLabel).foregroundStyle(.secondary).monospacedDigit()
                        }
                        Slider(value: $offsetMs, in: -300...300, step: 10)
                    }
                } header: {
                    Text("Timing")
                } footer: {
                    Text("“Sound after” is how long Netflix gets to open the movie page before the cue. The device you press Start on decides it. If this device always starts a little late, move Fine-tune to the left; if early, to the right.")
                }

                Section {
                    Step(n: 1, text: "In Netflix, turn off Autoplay previews (Netflix profile settings), so nothing plays on the movie page.")
                    Step(n: 2, text: "Settings › Accessibility › Switch Control › Switches › Add New Switch › Sound. Pick the same sound as above (tap Play test sounds first).")
                    Step(n: 3, text: "Switch Control › Recipes › Create New Recipe. Assign your sound switch to a Custom Gesture: one tap where Netflix’s Play button is on a movie page. Then set it as the Launch Recipe.")
                    Step(n: 4, text: "Shortcuts › Automation › New › App › Duo › Is Opened → Set Switch Control On, Run Immediately. And: App › Netflix › Is Closed → Set Switch Control Off.")
                    Step(n: 5, text: "Do steps 2–4 on each device. The Play button sits in a different spot on iPhone and iPad.")
                } header: {
                    Text("Setup, once per device")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var offsetLabel: String {
        offsetMs == 0 ? "0 ms" : String(format: "%+.0f ms", offsetMs)
    }
}

private struct Step: View {
    var n: Int
    var text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(.footnote.weight(.semibold))
                .frame(width: 22, height: 22)
                .background(Theme.lilac.opacity(0.25), in: Circle())
            Text(text).font(.subheadline)
        }
        .padding(.vertical, 2)
    }
}
