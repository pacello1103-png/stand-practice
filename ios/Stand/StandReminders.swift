// StandReminders.swift
// Reminders for the weekly practice plan: local notifications at the start of each planned block,
// repeating every week. Nothing leaves the device.
//
// From the page (window.webkit.messageHandlers.standNotify.postMessage):
//   { op: "state" }                      -> window.standNotifyState({ allowed, asked })
//   { op: "schedule", items: [{ weekday: 1...7 (1 = Sunday), hour, minute, title, body }] }
//                                        -> asks for permission the first time, then replaces all plan
//                                           reminders; answers with window.standNotifyState(...)
//   { op: "clear" }                      -> removes all plan reminders

import Foundation
import UIKit
import WebKit
import UserNotifications

final class StandReminders: NSObject, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    static let shared = StandReminders()
    private weak var webView: WKWebView?
    private let prefix = "stand-plan-"

    func install(on webView: WKWebView) {
        self.webView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "standNotify")
        ucc.add(ReminderHandler(self), name: "standNotify")
        let caps = "window.standCaps = Object.assign(window.standCaps || {}, { notify: 1 });"
        ucc.addUserScript(WKUserScript(source: caps, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.evaluateJavaScript(caps, completionHandler: nil)
        // a reminder that comes while Stand is open still shows
        UNUserNotificationCenter.current().delegate = self
    }

    private func answer(_ allowed: Bool, asked: Bool) {
        let src = "window.standNotifyState && window.standNotifyState({ allowed: \(allowed), asked: \(asked) })"
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript(src, completionHandler: nil) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        let center = UNUserNotificationCenter.current()
        switch op {
        case "state":
            center.getNotificationSettings { s in
                self.answer(s.authorizationStatus == .authorized || s.authorizationStatus == .provisional,
                            asked: s.authorizationStatus != .notDetermined)
            }
        case "clear":
            removeAll { }
        case "schedule":
            let items = body["items"] as? [[String: Any]] ?? []
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                self.removeAll {
                    guard granted else { self.answer(false, asked: true); return }
                    for (i, it) in items.prefix(60).enumerated() {
                        var dc = DateComponents()
                        dc.weekday = it["weekday"] as? Int
                        dc.hour = it["hour"] as? Int
                        dc.minute = it["minute"] as? Int
                        let content = UNMutableNotificationContent()
                        content.title = it["title"] as? String ?? "Time to practise"
                        content.body = it["body"] as? String ?? ""
                        content.sound = .default
                        let trigger = UNCalendarNotificationTrigger(dateMatching: dc, repeats: true)
                        center.add(UNNotificationRequest(identifier: self.prefix + String(i), content: content, trigger: trigger))
                    }
                    self.answer(true, asked: true)
                }
            }
        default: break
        }
    }

    private func removeAll(_ done: @escaping () -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { reqs in
            let ids = reqs.map { $0.identifier }.filter { $0.hasPrefix(self.prefix) }
            center.removePendingNotificationRequests(withIdentifiers: ids)
            done()
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if #available(iOS 14.0, *) { completionHandler([.banner, .list, .sound]) } else { completionHandler([.alert, .sound]) }
    }
}

/// Keeps WKUserContentController from holding StandReminders strongly.
private final class ReminderHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
