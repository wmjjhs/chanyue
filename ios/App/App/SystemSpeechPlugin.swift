// 版权所有：波哥
import AVFoundation
import Capacitor
import UIKit
#if canImport(SherpaOnnx)
import SherpaOnnx
#endif

@objc(ChanyueViewController)
class ChanyueViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SystemSpeechPlugin())
    }
}

#if canImport(SherpaOnnx)
// 模型随 App 内置，仅在设备本地合成；正文不写入网络请求。
private final class LocalNeuralTts {
    static let folder = "tts"
    private static let files = ["model.onnx", "tokens.txt", "lexicon.txt", "date.fst", "number.fst"]
    private static let lock = NSLock()
    private static var engine: SherpaOnnxOfflineTtsWrapper?
    private static var attempted = false

    static var directory: URL? {
        Bundle.main.resourceURL?.appendingPathComponent(folder, isDirectory: true)
    }

    static func available() -> Bool {
        guard let dir = directory else { return false }
        return files.allSatisfy { FileManager.default.fileExists(atPath: dir.appendingPathComponent($0).path) }
    }

    static func shared() -> SherpaOnnxOfflineTtsWrapper? {
        lock.lock()
        defer { lock.unlock() }
        if attempted { return engine }
        attempted = true
        guard let dir = directory, available() else { return nil }
        func path(_ name: String) -> String { dir.appendingPathComponent(name).path }
        let vits = sherpaOnnxOfflineTtsVitsModelConfig(
            model: path("model.onnx"),
            lexicon: path("lexicon.txt"),
            tokens: path("tokens.txt"))
        var model = sherpaOnnxOfflineTtsModelConfig(vits: vits, numThreads: 4)
        var config = sherpaOnnxOfflineTtsConfig(
            model: model,
            ruleFsts: [path("date.fst"), path("number.fst")].joined(separator: ","),
            maxNumSentences: 1,
            silenceScale: 0.2)
        let wrapper = SherpaOnnxOfflineTtsWrapper(config: &config)
        guard wrapper.tts != nil else { return nil }
        engine = wrapper
        return wrapper
    }
}
#endif

@objc(SystemSpeechPlugin)
public class SystemSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    public let identifier = "SystemSpeechPlugin"
    public let jsName = "SystemSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let synthesizer = AVSpeechSynthesizer()
    private let neuralQueue = DispatchQueue(label: "app.chanyue.reader.neural-tts", qos: .userInitiated)
    private let cacheLock = NSLock()
    private var cachedSpeech: (key: String, data: Data)?
    private var sessionActive = false
    private var pending: CAPPluginCall?
    private var current: AVSpeechUtterance?
    private var requestID: String?
    private var player: AVAudioPlayer?
    private var neuralCall: CAPPluginCall?
    private var neuralID: String?
    private var neuralToken = 0
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

    private func score(_ voice: AVSpeechSynthesisVoice) -> Int {
        let id = voice.identifier.lowercased()
        var value = voice.language.hasPrefix("zh-CN") ? 40 : 10
        if id.contains("premium") { value += 70 }
        else if id.contains("enhanced") { value += 50 }
        if voice.quality == .enhanced { value += 20 }
        if id.contains("siri") { value += 10 }
        if id.contains("compact") { value -= 30 }
        return value
    }

    private func systemVoices() -> [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("zh") }
            .sorted { score($0) > score($1) }
    }

    private func selectedVoice(_ requested: String) -> AVSpeechSynthesisVoice? {
        let voices = systemVoices()
        guard !voices.isEmpty else { return nil }
        if !requested.isEmpty, requested.count <= 120,
           let match = voices.first(where: { $0.identifier == requested }) {
            return match
        }
        return voices.first
    }

    // 一次听书会话只激活一次音频会话，句间不反复停用/启用硬件。
    private func activateSession() throws {
        if sessionActive { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true)
        sessionActive = true
    }

    private func deactivateSession() {
        if !sessionActive { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        sessionActive = false
    }

    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let voices = self.systemVoices()
            let list: [[String: String]] = Array(voices.prefix(24)).map { ["id": $0.identifier, "name": $0.name] }
            #if canImport(SherpaOnnx)
            let neural = LocalNeuralTts.available()
            #else
            let neural = false
            #endif
            call.resolve(["available": !voices.isEmpty, "neural": neural, "voices": list])
        }
    }

    @objc func speak(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState == .active else { call.reject("应用已进入后台，听书已暂停。"); return }
            guard let text = call.getString("text"), !text.isEmpty, text.utf16.count <= 1000,
                  let id = call.getString("id"), id.range(of: "^speech-[0-9]+-[0-9]+$", options: .regularExpression) != nil,
                  let rate = call.getDouble("rate"), rate.isFinite, rate >= 0.5, rate <= 2 else {
                call.reject("朗读参数无效。"); return
            }
            let engine = call.getString("engine") ?? "system"
            let requested = call.getString("voice") ?? ""
            let upcoming = call.getString("next") ?? ""
            #if canImport(SherpaOnnx)
            if engine == "neural" && LocalNeuralTts.available() {
                self.speakWithNeural(text: text, rate: rate, id: id, voice: requested,
                                     next: upcoming.utf16.count <= 1000 ? upcoming : "", call: call)
                return
            }
            #endif
            self.speakWithSystem(text: text, rate: rate, id: id, requested: requested, call: call)
        }
    }

    private func speakWithSystem(text: String, rate: Double, id: String, requested: String, call: CAPPluginCall) {
        guard let selected = selectedVoice(requested) else {
            call.reject("没有可用的中文系统语音，请在系统朗读设置中下载中文语音后重试。"); return
        }
        self.cancel("听书已暂停。", keepSession: true)
        do { try self.activateSession() }
        catch { call.reject("当前无法播放声音，请结束其他通话或音频后重试。"); return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = selected
        utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(rate)))
        self.current = utterance; self.pending = call; self.requestID = id
        self.synthesizer.speak(utterance)
    }

    #if canImport(SherpaOnnx)
    private func cacheKey(_ text: String, _ rate: Double, _ voice: String) -> String {
        "\(voice)|\(rate)|\(text)"
    }

    private func cachedData(_ key: String) -> Data? {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        return cachedSpeech?.key == key ? cachedSpeech?.data : nil
    }

    private func storeData(_ data: Data, _ key: String) {
        cacheLock.lock()
        cachedSpeech = (key, data)
        cacheLock.unlock()
    }

    // 官方 WAV 写出后立刻读入内存并删掉临时文件，播放时不再碰磁盘。
    private func wavData(_ text: String, rate: Double) -> Data? {
        guard let engine = LocalNeuralTts.shared() else { return nil }
        let audio = engine.generate(text: text, sid: 0, speed: Float(rate))
        guard audio.n > 0 else { return nil }
        let file = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("chanyue-tts-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: file) }
        guard audio.save(filename: file.path) == 1,
              let data = try? Data(contentsOf: file), !data.isEmpty else { return nil }
        return data
    }

    // 播放当前句的同时合成下一句，句间只剩切换播放器，不再等待模型计算。
    private func prefetch(_ text: String, rate: Double, voice: String) {
        guard !text.isEmpty, text.utf16.count <= 1000 else { return }
        let key = cacheKey(text, rate, voice)
        guard cachedData(key) == nil else { return }
        neuralQueue.async {
            guard self.cachedData(key) == nil, let data = self.wavData(text, rate: rate) else { return }
            self.storeData(data, key)
        }
    }

    private func speakWithNeural(text: String, rate: Double, id: String, voice: String, next: String, call: CAPPluginCall) {
        self.cancel("听书已暂停。", keepSession: true)
        self.neuralCall = call; self.neuralID = id
        self.neuralToken += 1
        let token = self.neuralToken
        let key = self.cacheKey(text, rate, voice)
        if let data = self.cachedData(key) {
            self.playNeural(data, id: id, call: call)
            self.prefetch(next, rate: rate, voice: voice)
            return
        }
        neuralQueue.async {
            let data = self.cachedData(key) ?? self.wavData(text, rate: rate)
            guard let data else {
                DispatchQueue.main.async { self.finishNeural(id: id, call: call, error: "本地神经语音合成失败，请在设置中改用系统语音。") }
                return
            }
            self.storeData(data, key)
            DispatchQueue.main.async {
                guard self.neuralToken == token, self.neuralID == id,
                      UIApplication.shared.applicationState == .active else {
                    self.finishNeural(id: id, call: call, error: "听书已暂停。")
                    return
                }
                self.playNeural(data, id: id, call: call)
                self.prefetch(next, rate: rate, voice: voice)
            }
        }
    }

    private func playNeural(_ data: Data, id: String, call: CAPPluginCall) {
        do {
            try self.activateSession()
            let player = try AVAudioPlayer(data: data, fileTypeHint: AVFileType.wav.rawValue)
            player.delegate = self
            player.prepareToPlay()
            self.player = player
            // 真实音频秒数随开始事件回传，前端据此匀速推进下划线，句末不再估算/校正。
            var event: [String: Any] = ["id": id]
            if player.duration.isFinite, player.duration > 0 { event["duration"] = player.duration }
            self.notifyListeners("speechStarted", data: event)
            if !player.play() {
                self.finishNeural(id: id, call: call, error: "当前无法播放神经语音，请在设置中改用系统语音。")
            }
        } catch {
            self.finishNeural(id: id, call: call, error: "当前无法播放神经语音，请在设置中改用系统语音。")
        }
    }
    #endif

    private func finishNeural(id: String, call: CAPPluginCall, error: String?) {
        guard neuralID == id else { return }
        neuralID = nil; neuralCall = nil
        player?.stop(); player = nil
        if let error { call.reject(error) } else { call.resolve() }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.cancel("听书已暂停。"); call.resolve() }
    }

    private func cancel(_ message: String, keepSession: Bool = false) {
        let systemCall = pending
        let neural = neuralCall
        pending = nil; current = nil; requestID = nil
        neuralCall = nil; neuralID = nil
        neuralToken += 1
        synthesizer.stopSpeaking(at: .immediate)
        player?.stop(); player = nil
        if !keepSession { deactivateSession() }
        systemCall?.reject(message)
        neural?.reject(message)
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        guard utterance === current, let id = requestID else { return }
        notifyListeners("speechStarted", data: ["id": id])
    }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard utterance === current else { return }
        let call = pending
        pending = nil; current = nil; requestID = nil
        call?.resolve()
    }
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        if utterance === current { cancel("听书已中断，请重新开始当前句。") }
    }
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard player === self.player, let id = neuralID, let call = neuralCall else { return }
        finishNeural(id: id, call: call, error: flag ? nil : "本地神经语音播放中断，请重试。")
    }
    public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        guard player === self.player, let id = neuralID, let call = neuralCall else { return }
        finishNeural(id: id, call: call, error: "本地神经语音文件无法播放，请在设置中改用系统语音。")
    }
    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }
}
