// 版权所有：波哥
package app.chanyue.reader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;

@CapacitorPlugin(name = "SystemSpeech")
public class SystemSpeechPlugin extends Plugin {
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
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        if (change != AudioManager.AUDIOFOCUS_GAIN) main.post(() -> stopCurrent("声音被系统中断，请重新开始当前句。"));
    };
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            main.post(() -> stopCurrent("耳机已断开，听书已暂停。"));
        }
    };

    @Override public void load() {
        main.post(() -> {
            audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED);
            else getContext().registerReceiver(noisy, filter);
        });
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
        result.put("neural", false);
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
            if (text == null || text.isEmpty() || text.length() > 1000 || id == null || !id.matches("speech-[0-9]+-[0-9]+") || rate == null || !Double.isFinite(rate) || rate < 0.5 || rate > 2) {
                call.reject("朗读参数无效。"); return;
            }
            Voice selected = selectedVoice(call.getString("voice"));
            if (selected == null) { call.reject("没有可用的离线中文语音，请安装中文语音包后重试。"); return; }
            stopCurrent("听书已暂停。");
            if (engine.setVoice(selected) != TextToSpeech.SUCCESS || engine.setSpeechRate(rate.floatValue()) != TextToSpeech.SUCCESS) { call.reject("无法设置系统语音。"); return; }
            AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
            engine.setAudioAttributes(attributes);
            int granted;
            if (Build.VERSION.SDK_INT >= 26) {
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes)
                    .setWillPauseWhenDucked(true).setOnAudioFocusChangeListener(focusListener, main).build();
                granted = audio.requestAudioFocus(focus);
            } else granted = audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { abandonFocus(); call.reject("当前无法播放声音，请结束其他通话或音频后重试。"); return; }
            speaking = call; utteranceId = id;
            Bundle params = new Bundle(); params.putString(TextToSpeech.Engine.KEY_FEATURE_EMBEDDED_SYNTHESIS, "true");
            if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, id) == TextToSpeech.ERROR) finish(id, "系统语音播放失败，请重试。");
        });
    }
    private void abandonFocus() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26 && focus != null) { audio.abandonAudioFocusRequest(focus); focus = null; }
        else if (Build.VERSION.SDK_INT < 26) audio.abandonAudioFocus(focusListener);
    }
    private void finish(String id, String error) {
        if (!id.equals(utteranceId)) return;
        PluginCall call = speaking; speaking = null; utteranceId = null;
        abandonFocus();
        if (call != null) { if (error == null) call.resolve(); else call.reject(error); }
    }
    private void stopCurrent(String message) {
        String id = utteranceId;
        if (id != null) finish(id, message);
        if (engine != null) engine.stop();
        abandonFocus();
    }
    @PluginMethod public void stop(PluginCall call) { main.post(() -> { stopCurrent("听书已暂停。"); call.resolve(); }); }
    @Override protected void handleOnResume() { main.post(() -> foreground = true); }
    @Override protected void handleOnPause() { main.post(() -> { foreground = false; stopCurrent("应用已进入后台，听书已暂停。"); }); }
    @Override protected void handleOnDestroy() {
        main.post(() -> {
            initialization++; foreground = false;
            stopCurrent("听书已关闭。");
            for (PluginCall call : waiting) call.reject("听书已关闭。");
            waiting.clear();
            if (engine != null) { engine.shutdown(); engine = null; }
            try { getContext().unregisterReceiver(noisy); } catch (IllegalArgumentException ignored) {}
        });
    }
}
