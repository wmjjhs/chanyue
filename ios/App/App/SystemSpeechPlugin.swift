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
    // 多条目预取缓存：连续短句也能提前备好音频，不会被单槽缓存互相覆盖。
    private var cachedSpeech: [String: Data] = [:]
    private var cacheOrder: [String] = []
    private var cacheBytes = 0
    private let cacheItemLimit = 6
    private let cacheByteLimit = 24 * 1024 * 1024
    // 同一段文字只合成一次：预取中的任务被真正请求时插到队首并认领结果，不再重复排队等待。
    private var jobs: [String] = []
    private var jobParams: [String: (text: String, rate: Double)] = [:]
    private var waiters: [String: [(Data?) -> Void]] = [:]
    private var inFlight: Set<String> = []
    private var workerBusy = false
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
            #if canImport(SherpaOnnx)
            if engine == "neural" && LocalNeuralTts.available() {
                var queue = Array((call.getArray("queue") ?? [])
                    .compactMap { $0 as? String }
                    .filter { !$0.isEmpty && $0.utf16.count <= 1000 }
                    .prefix(4))
                if queue.isEmpty {
                    let upcoming = call.getString("next") ?? ""
                    if !upcoming.isEmpty, upcoming.utf16.count <= 1000 { queue = [upcoming] }
                }
                self.speakWithNeural(text: text, rate: rate, id: id, voice: requested,
                                     queue: queue, call: call)
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

    private func cacheGet(_ key: String) -> Data? {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        return cachedSpeech[key]
    }

    private func cachePut(_ data: Data, _ key: String) {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        guard cachedSpeech[key] == nil else { return }
        cachedSpeech[key] = data
        cacheOrder.append(key)
        cacheBytes += data.count
        while cacheOrder.count > cacheItemLimit || cacheBytes > cacheByteLimit {
            guard !cacheOrder.isEmpty else { break }
            let oldest = cacheOrder.removeFirst()
            if let removed = cachedSpeech.removeValue(forKey: oldest) { cacheBytes -= removed.count }
        }
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

    // 只从主线程调用：命中缓存时同步回调，未命中时排队并在合成完成后回到主线程回调。
    private func requestAudio(key: String, text: String, rate: Double, priority: Bool,
                              completion: ((Data?) -> Void)?) {
        cacheLock.lock()
        if let data = cachedSpeech[key] {
            cacheLock.unlock()
            completion?(data)
            return
        }
        if let waiter = completion { waiters[key, default: []].append(waiter) }
        if jobParams[key] == nil && !inFlight.contains(key) {
            jobParams[key] = (text, rate)
            if priority { jobs.insert(key, at: 0) } else { jobs.append(key) }
        } else if priority, let index = jobs.firstIndex(of: key), index > 0 {
            jobs.remove(at: index)
            jobs.insert(key, at: 0)
        }
        let start = !workerBusy
        if start { workerBusy = true }
        cacheLock.unlock()
        if start { neuralQueue.async { self.runNextJob() } }
    }

    private func runNextJob() {
        cacheLock.lock()
        guard let key = jobs.first else {
            workerBusy = false
            cacheLock.unlock()
            return
        }
        jobs.removeFirst()
        let params = jobParams.removeValue(forKey: key)
        inFlight.insert(key)
        cacheLock.unlock()

        let data = cacheGet(key) ?? params.flatMap { self.wavData($0.text, rate: $0.rate) }
        if let data { cachePut(data, key) }

        cacheLock.lock()
        inFlight.remove(key)
        let callbacks = waiters.removeValue(forKey: key) ?? []
        cacheLock.unlock()
        if !callbacks.isEmpty {
            DispatchQueue.main.async {
                for callback in callbacks { callback(data) }
            }
        }
        neuralQueue.async { self.runNextJob() }
    }

    // 当前句优先出队，其后若干片段顺序预取；句末切换时音频已备好，不再等待模型计算。
    private func speakWithNeural(text: String, rate: Double, id: String, voice: String,
                                 queue: [String], call: CAPPluginCall) {
        self.cancel("听书已暂停。", keepSession: true)
        self.neuralCall = call; self.neuralID = id
        self.neuralToken += 1
        let token = self.neuralToken
        let key = self.cacheKey(text, rate, voice)
        self.requestAudio(key: key, text: text, rate: rate, priority: true) { [weak self] data in
            guard let self = self else { return }
            guard self.neuralToken == token, self.neuralID == id,
                  UIApplication.shared.applicationState == .active else {
                self.finishNeural(id: id, call: call, error: "听书已暂停。")
                return
            }
            guard let data else {
                self.finishNeural(id: id, call: call, error: "本地神经语音合成失败，请在设置中改用系统语音。")
                return
            }
            self.playNeural(data, id: id, call: call)
        }
        for upcoming in queue {
            let upcomingKey = self.cacheKey(upcoming, rate, voice)
            self.requestAudio(key: upcomingKey, text: upcoming, rate: rate, priority: false, completion: nil)
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
