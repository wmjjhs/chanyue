// 版权所有：波哥
import AVFoundation
import Capacitor
import UIKit

@objc(ChanyueViewController)
class ChanyueViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SystemSpeechPlugin())
    }
}

@objc(SystemSpeechPlugin)
public class SystemSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "SystemSpeechPlugin"
    public let jsName = "SystemSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let synthesizer = AVSpeechSynthesizer()
    private var pending: CAPPluginCall?
    private var current: AVSpeechUtterance?
    private var requestID: String?
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        DispatchQueue.main.async {
            self.synthesizer.delegate = self
            let center = NotificationCenter.default
            self.observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.cancel("应用已进入后台，听书已暂停。")
            })
            self.observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
                if (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue {
                    self?.cancel("声音被系统中断，请重新开始当前句。")
                }
            })
            self.observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
                if (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                    self?.cancel("耳机已断开，听书已暂停。")
                }
            })
        }
    }
    private func voice() -> AVSpeechSynthesisVoice? {
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("zh-") }
        return voices.first { $0.language == "zh-CN" } ?? voices.first
    }
    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["available": self.voice() != nil]) }
    }
    @objc func speak(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState == .active else { call.reject("应用已进入后台，听书已暂停。"); return }
            guard let text = call.getString("text"), !text.isEmpty, text.utf16.count <= 1000,
                  let id = call.getString("id"), id.range(of: "^speech-[0-9]+-[0-9]+$", options: .regularExpression) != nil,
                  let rate = call.getDouble("rate"), rate.isFinite, rate >= 0.5, rate <= 2 else {
                call.reject("朗读参数无效。"); return
            }
            guard let selected = self.voice() else { call.reject("没有可用的中文系统语音，请在系统朗读设置中下载中文语音后重试。"); return }
            self.cancel("听书已暂停。")
            do {
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
            } catch { call.reject("当前无法播放声音，请结束其他通话或音频后重试。"); return }
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = selected
            utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(rate)))
            self.current = utterance; self.pending = call; self.requestID = id
            self.synthesizer.speak(utterance)
        }
    }
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.cancel("听书已暂停。"); call.resolve() }
    }
    private func cancel(_ message: String) {
        let call = pending
        pending = nil; current = nil; requestID = nil
        synthesizer.stopSpeaking(at: .immediate)
        if call != nil { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        call?.reject(message)
    }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        guard utterance === current, let id = requestID else { return }
        notifyListeners("speechStarted", data: ["id": id])
    }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard utterance === current else { return }
        let call = pending
        pending = nil; current = nil; requestID = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        call?.resolve()
    }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        if utterance === current { cancel("听书已中断，请重新开始当前句。") }
    }
    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }
}
