// 版权所有：波哥
package app.chanyue.reader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.AssetManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

/** 与 iOS 同协议：系统语音与内置 sherpa-onnx 神经语音共用去重队列、LRU 缓存与真实音频时长。 */
@CapacitorPlugin(name = "SystemSpeech")
public class SystemSpeechPlugin extends Plugin {
    private static final String[] TTS_ASSETS = {"model.onnx", "tokens.txt", "lexicon.txt", "date.fst", "number.fst"};
    private static final Set<String> TTS_ABIS = new HashSet<>(java.util.Arrays.asList("arm64-v8a", "armeabi-v7a", "x86", "x86_64"));
    private static final int CACHE_ITEMS = 6;
    private static final long CACHE_BYTES = 24L * 1024 * 1024;
    private static final int MAX_PREFETCH = 4;
    private static final int TEXT_LIMIT = 1000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<PluginCall> waiting = new ArrayList<>();
    private TextToSpeech engine;
    private boolean initialized;
    private boolean failed;
    private boolean foreground = true;
    private int initialization;
    private PluginCall speaking;
    private String utteranceId;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private boolean focusHeld;
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        if (change != AudioManager.AUDIOFOCUS_GAIN) main.post(() -> cancelCurrent("声音被系统中断，请重新开始当前句。", false));
    };
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            main.post(() -> cancelCurrent("耳机已断开，听书已暂停。", false));
        }
    };

    private final Object neuralLock = new Object();
    private final LinkedHashMap<String, AudioData> cache = new LinkedHashMap<>();
    private final ArrayDeque<String> jobs = new ArrayDeque<>();
    private final Map<String, Job> jobParams = new HashMap<>();
    private final Map<String, List<AudioCallback>> waiters = new HashMap<>();
    private final Set<String> inFlight = new HashSet<>();
    private long cacheBytes;
    private boolean workerBusy;
    private final ExecutorService synth = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "chanyue-neural-tts");
        thread.setPriority(Thread.NORM_PRIORITY);
        return thread;
    });
    private OfflineTts neural;
    private boolean neuralAttempted;
    private volatile Boolean neuralSupported;
    private PluginCall neuralCall;
    private String neuralId;
    private volatile int neuralToken;
    private volatile boolean neuralPlaying;
    private AudioTrack neuralTrack;

    private static final class AudioData {
        final float[] samples;
        final int sampleRate;
        AudioData(float[] samples, int sampleRate) { this.samples = samples; this.sampleRate = sampleRate; }
        long bytes() { return (long) samples.length * Float.BYTES; }
        double duration() { return (double) samples.length / sampleRate; }
    }
    private static final class Job {
        final String text;
        final double rate;
        Job(String text, double rate) { this.text = text; this.rate = rate; }
    }
    private interface AudioCallback { void onAudio(AudioData data); }

    @Override public void load() {
        main.post(() -> {
            audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED);
            else getContext().registerReceiver(noisy, filter);
        });
    }

    // 与 iOS 一致：prepare 只检查随包资源与 ABI 是否具备，不在此加载 170MB 模型。
    private boolean neuralAssets() {
        Boolean known = neuralSupported;
        if (known != null) return known;
        AssetManager assets = getContext().getAssets();
        for (String name : TTS_ASSETS) {
            try (java.io.InputStream ignored = assets.open("tts/" + name)) {
                if (ignored == null) { neuralSupported = false; return false; }
            } catch (Exception error) { neuralSupported = false; return false; }
        }
        for (String abi : Build.SUPPORTED_ABIS) {
            if (TTS_ABIS.contains(abi)) { neuralSupported = true; return true; }
        }
        neuralSupported = false;
        return false;
    }

    private AudioAttributes speechAttributes() {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    }

    // 一次听书会话只申请一次音频焦点，句间不反复停用硬件。
    private boolean ensureFocus() {
        if (focusHeld) return true;
        if (audio == null) return false;
        AudioAttributes attributes = speechAttributes();
        int granted;
        if (Build.VERSION.SDK_INT >= 26) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes).setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(focusListener, main).build();
            granted = audio.requestAudioFocus(focus);
        } else {
            granted = audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        }
        focusHeld = granted == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return focusHeld;
    }

    private void releaseFocus() {
        if (!focusHeld) return;
        focusHeld = false;
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26 && focus != null) { audio.abandonAudioFocusRequest(focus); focus = null; }
        else if (Build.VERSION.SDK_INT < 26) audio.abandonAudioFocus(focusListener);
    }

    private void initialize() {
        initialized = false; failed = false;
        final int token = ++initialization;
        if (engine != null) engine.shutdown();
        engine = new TextToSpeech(getContext(), status -> main.post(() -> {
            if (token != initialization) return;
            initialized = status == TextToSpeech.SUCCESS;
            failed = !initialized;
            if (initialized) engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { main.post(() -> {
                    if (id.equals(utteranceId)) { JSObject event = new JSObject(); event.put("id", id); notifyListeners("speechStarted", event); }
                }); }
                @Override public void onDone(String id) { main.post(() -> finish(id, null)); }
                @Override public void onError(String id) { main.post(() -> finish(id, "系统语音无法朗读，请检查中文语音包后重试。")); }
                @Override public void onError(String id, int code) { onError(id); }
                @Override public void onStop(String id, boolean interrupted) { main.post(() -> finish(id, "听书已暂停，请重新开始当前句。")); }
            });
            for (PluginCall call : new ArrayList<>(waiting)) respond(call);
            waiting.clear();
        }));
    }

    private int score(Voice voice) {
        int value = "CN".equalsIgnoreCase(voice.getLocale().getCountry()) ? 40 : 10;
        value += Math.min(400, Math.max(0, voice.getQuality())) / 5;
        String name = voice.getName() == null ? "" : voice.getName().toLowerCase(Locale.ROOT);
        if (name.contains("network")) value -= 100;
        return value;
    }
    private List<Voice> voices() {
        if (!initialized || engine == null || engine.getVoices() == null) return new ArrayList<>();
        return engine.getVoices().stream().filter(v -> "zh".equals(v.getLocale().getLanguage())
            && !v.isNetworkConnectionRequired()
            && (v.getFeatures() == null || !v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)))
            .sorted(Comparator.comparingInt((Voice v) -> -score(v)).thenComparing(Voice::getName))
            .collect(Collectors.toList());
    }
    private Voice selectedVoice(String requested) {
        List<Voice> list = voices();
        if (list.isEmpty()) return null;
        if (requested != null && requested.length() <= 120) {
            for (Voice voice : list) if (requested.equals(voice.getName())) return voice;
        }
        return list.get(0);
    }
    private void respond(PluginCall call) {
        List<Voice> list = voices();
        JSArray options = new JSArray();
        for (Voice voice : list.subList(0, Math.min(24, list.size()))) {
            JSObject option = new JSObject();
            option.put("id", voice.getName());
            option.put("name", voice.getName());
            options.put(option);
        }
        JSObject result = new JSObject();
        result.put("available", !list.isEmpty());
        result.put("neural", neuralAssets());
        result.put("voices", options);
        call.resolve(result);
    }
    @PluginMethod public void prepare(PluginCall call) {
        main.post(() -> {
            if (engine == null || failed) initialize();
            if (initialized) { respond(call); return; }
            waiting.add(call);
            main.postDelayed(() -> { if (waiting.remove(call)) { failed = true; call.reject("系统语音初始化超时，请检查文字转语音设置后重试。"); } }, 12000);
        });
    }

    @PluginMethod public void speak(PluginCall call) {
        main.post(() -> {
            if (!foreground) { call.reject("应用已进入后台，听书已暂停。"); return; }
            String text = call.getString("text"), id = call.getString("id");
            Double rate = call.getDouble("rate", 1.0);
            if (text == null || text.isEmpty() || text.length() > TEXT_LIMIT || id == null
                || !id.matches("speech-[0-9]+-[0-9]+") || rate == null || !Double.isFinite(rate) || rate < 0.5 || rate > 2) {
                call.reject("朗读参数无效。"); return;
            }
            String engineName = call.getString("engine", "system");
            String voice = call.getString("voice", "");
            if ("neural".equals(engineName) && neuralAssets()) speakWithNeural(text, rate, id, voice, upcoming(call), call);
            else speakWithSystem(text, rate, id, voice, call);
        });
    }

    private List<String> upcoming(PluginCall call) {
        List<String> result = new ArrayList<>();
        JSArray array = call.getArray("queue", new JSArray());
        if (array != null) {
            for (int i = 0; i < array.length() && result.size() < MAX_PREFETCH; i++) {
                Object value = array.opt(i);
                if (value instanceof String) {
                    String text = (String) value;
                    if (!text.isEmpty() && text.length() <= TEXT_LIMIT) result.add(text);
                }
            }
        }
        if (result.isEmpty()) {
            String next = call.getString("next", "");
            if (next != null && !next.isEmpty() && next.length() <= TEXT_LIMIT) result.add(next);
        }
        return result;
    }

    private void speakWithSystem(String text, double rate, String id, String requested, PluginCall call) {
        Voice selected = selectedVoice(requested);
        if (selected == null) { call.reject("没有可用的离线中文语音，请安装中文语音包后重试。"); return; }
        if (!initialized || engine == null) { call.reject("系统语音尚未就绪，请稍后重试。"); return; }
        cancelCurrent("听书已暂停。", true);
        if (!ensureFocus()) { call.reject("当前无法播放声音，请结束其他通话或音频后重试。"); return; }
        if (engine.setVoice(selected) != TextToSpeech.SUCCESS || engine.setSpeechRate((float) rate) != TextToSpeech.SUCCESS) {
            call.reject("无法设置系统语音。"); return;
        }
        engine.setAudioAttributes(speechAttributes());
        speaking = call; utteranceId = id;
        Bundle params = new Bundle(); params.putString(TextToSpeech.Engine.KEY_FEATURE_EMBEDDED_SYNTHESIS, "true");
        if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, id) == TextToSpeech.ERROR) finish(id, "系统语音播放失败，请重试。");
    }

    private void finish(String id, String error) {
        if (!id.equals(utteranceId)) return;
        PluginCall call = speaking; speaking = null; utteranceId = null;
        if (call != null) { if (error == null) call.resolve(); else call.reject(error); }
    }

    // 与 iOS cancel(message, keepSession) 对应：换句时保留音频焦点，停止/后台/中断时释放。
    private void cancelCurrent(String message, boolean keepSession) {
        String id = utteranceId;
        if (id != null) finish(id, message);
        if (engine != null) engine.stop();
        neuralToken++;
        PluginCall pending = neuralCall;
        neuralCall = null; neuralId = null;
        neuralPlaying = false;
        AudioTrack track = neuralTrack; neuralTrack = null;
        if (track != null) {
            try { track.pause(); track.flush(); track.stop(); } catch (Throwable ignored) {}
        }
        if (pending != null) pending.reject(message);
        if (!keepSession) releaseFocus();
    }

    private String cacheKey(String text, double rate, String voice) {
        return voice + "|" + rate + "|" + text;
    }

    private void cachePut(String key, AudioData data) {
        synchronized (neuralLock) {
            if (cache.containsKey(key)) return;
            cache.put(key, data);
            cacheBytes += data.bytes();
            while (cache.size() > CACHE_ITEMS || cacheBytes > CACHE_BYTES) {
                Iterator<Map.Entry<String, AudioData>> it = cache.entrySet().iterator();
                if (!it.hasNext()) break;
                Map.Entry<String, AudioData> oldest = it.next();
                it.remove();
                cacheBytes -= oldest.getValue().bytes();
            }
        }
    }

    /** 命中缓存同步回调；未命中时并入去重队列，当前句插到队首，回调统一回主线程。 */
    private void requestAudio(String key, String text, double rate, boolean priority, AudioCallback callback) {
        AudioData hit = null;
        boolean start = false;
        synchronized (neuralLock) {
            hit = cache.get(key);
            if (hit == null) {
                if (callback != null) {
                    List<AudioCallback> list = waiters.get(key);
                    if (list == null) { list = new ArrayList<>(); waiters.put(key, list); }
                    list.add(callback);
                }
                if (!jobParams.containsKey(key) && !inFlight.contains(key)) {
                    jobParams.put(key, new Job(text, rate));
                    if (priority) jobs.addFirst(key); else jobs.addLast(key);
                } else if (priority && jobs.remove(key)) {
                    jobs.addFirst(key);
                }
                if (!workerBusy) { workerBusy = true; start = true; }
            }
        }
        if (hit != null) { if (callback != null) callback.onAudio(hit); return; }
        if (start) synth.execute(this::runJobs);
    }

    private void runJobs() {
        while (true) {
            String key;
            Job params;
            synchronized (neuralLock) {
                key = jobs.pollFirst();
                if (key == null) { workerBusy = false; return; }
                params = jobParams.remove(key);
                inFlight.add(key);
            }
            AudioData data = null;
            if (params != null) {
                synchronized (neuralLock) { data = cache.get(key); }
                if (data == null) data = synthesize(params.text, params.rate);
                if (data != null) cachePut(key, data);
            }
            final AudioData result = data;
            List<AudioCallback> callbacks;
            synchronized (neuralLock) {
                inFlight.remove(key);
                callbacks = waiters.remove(key);
            }
            if (callbacks != null && !callbacks.isEmpty()) {
                main.post(() -> { for (AudioCallback callback : callbacks) callback.onAudio(result); });
            }
        }
    }

    // 只在单线程合成器里访问；模型随包内置，首次朗读时懒加载，正文不出设备。
    private OfflineTts neuralEngine() {
        if (neuralAttempted) return neural;
        neuralAttempted = true;
        try {
            OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig();
            vits.setModel("tts/model.onnx");
            vits.setLexicon("tts/lexicon.txt");
            vits.setTokens("tts/tokens.txt");
            OfflineTtsModelConfig model = new OfflineTtsModelConfig();
            model.setVits(vits);
            model.setNumThreads(4);
            model.setDebug(false);
            model.setProvider("cpu");
            OfflineTtsConfig config = new OfflineTtsConfig();
            config.setModel(model);
            config.setRuleFsts("tts/date.fst,tts/number.fst");
            config.setRuleFars("");
            config.setMaxNumSentences(1);
            config.setSilenceScale(0.2f);
            neural = new OfflineTts(getContext().getAssets(), config);
        } catch (Throwable error) {
            neural = null;
        }
        return neural;
    }

    private AudioData synthesize(String text, double rate) {
        try {
            OfflineTts tts = neuralEngine();
            if (tts == null) return null;
            GeneratedAudio generated = tts.generate(text, 0, (float) rate);
            if (generated == null) return null;
            float[] samples = generated.getSamples();
            int sampleRate = generated.getSampleRate();
            if (samples == null || samples.length == 0 || sampleRate <= 0) return null;
            return new AudioData(samples, sampleRate);
        } catch (Throwable error) {
            return null;
        }
    }

    private void speakWithNeural(String text, double rate, String id, String voice, List<String> queue, PluginCall call) {
        cancelCurrent("听书已暂停。", true);
        neuralCall = call; neuralId = id;
        final int token = ++neuralToken;
        String key = cacheKey(text, rate, voice);
        requestAudio(key, text, rate, true, data -> {
            if (token != neuralToken || !id.equals(neuralId) || !foreground) {
                finishNeural(id, call, "听书已暂停。"); return;
            }
            if (data == null) {
                finishNeural(id, call, "本地神经语音合成失败，请在设置中改用系统语音。"); return;
            }
            playNeural(data, id, call, token);
        });
        for (String next : queue) {
            requestAudio(cacheKey(next, rate, voice), next, rate, false, null);
        }
    }

    private void playNeural(AudioData data, String id, PluginCall call, int token) {
        if (!ensureFocus()) { finishNeural(id, call, "当前无法播放神经语音，请在设置中改用系统语音。"); return; }
        AudioTrack track;
        try {
            int minimum = AudioTrack.getMinBufferSize(data.sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT);
            track = new AudioTrack.Builder()
                .setAudioAttributes(speechAttributes())
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(data.sampleRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(Math.max(minimum, 4096 * Float.BYTES))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
            track.play();
        } catch (Throwable error) {
            finishNeural(id, call, "当前无法播放神经语音，请在设置中改用系统语音。"); return;
        }
        neuralTrack = track;
        neuralPlaying = true;
        JSObject event = new JSObject();
        event.put("id", id);
        double seconds = data.duration();
        if (Double.isFinite(seconds) && seconds > 0 && seconds <= 600) event.put("duration", seconds);
        notifyListeners("speechStarted", event);
        final AudioTrack playing = track;
        new Thread(() -> {
            float[] samples = data.samples;
            int offset = 0;
            boolean writeFailed = false;
            while (offset < samples.length) {
                if (token != neuralToken || !neuralPlaying) break;
                int written = playing.write(samples, offset, Math.min(4096, samples.length - offset), AudioTrack.WRITE_BLOCKING);
                if (written <= 0) { writeFailed = true; break; }
                offset += written;
            }
            // WRITE_BLOCKING 返回时数据可能仍在硬件缓冲里，等真实播放到末帧再收尾，避免句尾被截断。
            long deadline = System.currentTimeMillis() + (long) (data.duration() * 2000) + 5000;
            while (!writeFailed && offset >= samples.length && playing.getPlaybackHeadPosition() < samples.length
                && System.currentTimeMillis() < deadline) {
                if (token != neuralToken || !neuralPlaying) break;
                try { Thread.sleep(10); } catch (InterruptedException error) { Thread.currentThread().interrupt(); break; }
            }
            boolean completed = !writeFailed && offset >= samples.length && playing.getPlaybackHeadPosition() >= samples.length
                && token == neuralToken && neuralPlaying;
            boolean playbackError = writeFailed && token == neuralToken && neuralPlaying;
            main.post(() -> {
                if (playing == neuralTrack) neuralTrack = null;
                try { playing.stop(); playing.release(); } catch (Throwable ignored) {}
                if (completed) finishNeural(id, call, null);
                else if (playbackError) finishNeural(id, call, "本地神经语音播放中断，请重试。");
            });
        }, "chanyue-neural-play").start();
    }

    private void finishNeural(String id, PluginCall call, String error) {
        if (!id.equals(neuralId)) return;
        neuralId = null; neuralCall = null;
        neuralPlaying = false;
        AudioTrack track = neuralTrack; neuralTrack = null;
        if (track != null) {
            try { track.pause(); track.flush(); track.stop(); } catch (Throwable ignored) {}
        }
        if (error == null) call.resolve(); else call.reject(error);
    }

    @PluginMethod public void stop(PluginCall call) {
        main.post(() -> { cancelCurrent("听书已暂停。", false); call.resolve(); });
    }
    @Override protected void handleOnResume() { main.post(() -> foreground = true); }
    @Override protected void handleOnPause() { main.post(() -> { foreground = false; cancelCurrent("应用已进入后台，听书已暂停。", false); }); }
    @Override protected void handleOnDestroy() {
        main.post(() -> {
            initialization++; foreground = false;
            cancelCurrent("听书已关闭。", false);
            for (PluginCall call : waiting) call.reject("听书已关闭。");
            waiting.clear();
            if (engine != null) { engine.shutdown(); engine = null; }
            synth.execute(() -> {
                if (neural != null) { try { neural.release(); } catch (Throwable ignored) {} neural = null; }
            });
            synth.shutdown();
            try { getContext().unregisterReceiver(noisy); } catch (IllegalArgumentException ignored) {}
        });
    }
}
