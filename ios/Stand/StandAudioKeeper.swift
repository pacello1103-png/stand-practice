// StandAudioKeeper.swift
// Keeps sound and the microphone working after Stand has been in the background, after a call or
// Siri, and after iOS restarts its audio services. Each time, the audio session is switched on again
// and the page is told (window.standAudioWake), so it can wake or rebuild its sound system and
// reopen the microphone. Without this, sound could stay silent until Stand was closed and reopened.

import Foundation
import UIKit
import WebKit
import AVFoundation

final class StandAudioKeeper: NSObject {
    static let shared = StandAudioKeeper()
    private weak var webView: WKWebView?
    private var installed = false

    func install(on webView: WKWebView) {
        self.webView = webView
        guard !installed else { return }
        installed = true
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(servicesReset), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
    }

    private func activate() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default,
                                 options: [.defaultToSpeaker, .allowBluetoothA2DP, .allowAirPlay, .mixWithOthers])
        try? session.setActive(true)
        standApplyRoute()
    }

    private func tellPage(_ reason: String) {
        let src = "window.standAudioWake && window.standAudioWake('\(reason)')"
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript(src, completionHandler: nil) }
    }

    @objc private func becameActive() {
        activate()
        // a moment later too: WebKit wakes its own audio after the app is active
        tellPage("active")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.tellPage("active") }
    }

    @objc private func interrupted(_ note: Notification) {
        guard let info = note.userInfo, let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .ended {
            activate()
            tellPage("interruption")
        }
    }

    @objc private func servicesReset() {
        // iOS restarted its audio: everything built on the old sound system is gone
        DispatchQueue.main.async { [weak self] in
            self?.activate()
            self?.tellPage("reset")
        }
    }
}
