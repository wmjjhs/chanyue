// 版权所有：波哥
import { defaultSettings, type Settings } from './model';

type Sound = Settings['ambientSound'];
type Voice = { source: AudioBufferSourceNode; gain: GainNode; kind: Sound; target?: number };
export type AmbientState = 'idle' | 'loading' | 'playing' | 'paused' | 'interrupted' | 'error';
const files: Record<Sound, string> = { rain: '/ambience/rain.wav', wind: '/ambience/wind.wav', stream: '/ambience/stream.wav' };
export const ambientNames: Record<Sound, string> = { rain: '柔雨', wind: '微风', stream: '流水' };
const fadeSeconds = 0.35;

export class AmbientAudio {
  private context: AudioContext | null = null;
  private active: Voice | null = null;
  private voices = new Set<Voice>();
  private request: AbortController | null = null;
  private epoch = 0;
  private authorized = false;
  private playing = false;
  private background = false;
  private settings: Settings = defaultSettings;
  private pending: Sound | null = null;
  private buffers = new Map<Sound, AudioBuffer>();
  private state: AmbientState = 'idle';
  private listeners = new Set<() => void>();
  private suspension: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(state: AmbientState) {
    if (this.state === state) return;
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  private wanted() {
    return this.authorized && !this.background && this.settings.ambientEnabled
      && this.settings.ambientVolume > 0 && (this.playing || this.settings.ambientContinuePaused);
  }
  private cancelPending() {
    this.epoch++;
    this.request?.abort(); this.request = null; this.pending = null;
    if (this.suspension !== null) clearTimeout(this.suspension);
    this.suspension = null;
  }
  private ramp(voice: Voice, volume: number) {
    if (voice.target === volume) return;
    voice.target = volume;
    const now = this.context?.currentTime ?? 0;
    const gain = voice.gain.gain;
    gain.cancelAndHoldAtTime(now);
    gain.linearRampToValueAtTime(volume, now + fadeSeconds);
  }
  private retire(voice: Voice, immediate = false) {
    if (!this.voices.has(voice)) return;
    if (!immediate) this.ramp(voice, 0);
    voice.source.stop(immediate ? 0 : (this.context?.currentTime ?? 0) + fadeSeconds);
    if (immediate) {
      voice.source.disconnect(); voice.gain.disconnect(); this.voices.delete(voice);
    }
  }
  private silence(immediate = false) {
    this.cancelPending();
    for (const voice of this.voices) this.retire(voice, immediate);
    this.active = null;
    const context = this.context;
    if (context && !immediate) {
      const epoch = this.epoch;
      this.suspension = setTimeout(() => {
        if (epoch === this.epoch && !this.wanted() && context.state !== 'closed') void context.suspend().catch(() => {});
      }, (fadeSeconds + 0.05) * 1000);
    }
  }
  configure(settings: Settings, playing: boolean) {
    this.settings = settings; this.playing = playing;
    if (!this.wanted()) {
      this.silence();
      if (this.state !== 'error' && this.state !== 'interrupted') this.publish(this.authorized ? 'paused' : 'idle');
      return;
    }
    if (!this.context) return;
    if (this.active?.kind === settings.ambientSound) {
      if (this.pending) this.cancelPending();
      this.ramp(this.active, settings.ambientVolume / 100); this.publish('playing'); return;
    }
    if (this.pending !== settings.ambientSound) this.load();
  }
  start(settings: Settings) {
    this.settings = settings; this.playing = true; this.background = false;
    this.authorized = true;
    if (!settings.ambientEnabled || settings.ambientVolume === 0) { this.publish('paused'); return; }
    try {
      if (!this.context) {
        const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        if (session) { try { session.type = 'ambient'; } catch { /* Unsupported by some WebKit versions. */ } }
        this.context = new AudioContext({ latencyHint: 'playback' });
        const context = this.context;
        context.onstatechange = () => {
          if (context === this.context && this.wanted() && (context.state as string) === 'interrupted') {
            this.stopSession(true); this.publish('interrupted');
          }
        };
      }
      const context = this.context;
      const resumed = context.resume();
      this.load(resumed);
    } catch { this.fail(); }
  }
  private fail() {
    this.authorized = false;
    this.silence(true);
    if (this.context?.state !== 'closed') void this.context?.suspend().catch(() => {});
    this.publish('error');
  }
  private load(resumed?: Promise<void>) {
    const context = this.context;
    if (!context) return;
    this.cancelPending();
    const epoch = this.epoch, kind = this.settings.ambientSound;
    this.pending = kind;
    const request = new AbortController();
    this.request = request;
    this.publish('loading');
    const loadBuffer = async () => {
      const existing = this.buffers.get(kind);
      if (existing) return existing;
      const response = await fetch(files[kind], { signal: request.signal, credentials: 'same-origin', redirect: 'error' });
      if (!response.ok) throw new Error('Audio unavailable');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 2_000_000 || bytes.byteLength < 44) throw new Error('Invalid audio size');
      const buffer = await context.decodeAudioData(bytes);
      if (buffer.duration < 1 || buffer.duration > 60) throw new Error('Invalid audio duration');
      if (epoch === this.epoch) this.buffers.set(kind, buffer);
      return buffer;
    };
    const timeout = setTimeout(() => {
      if (epoch === this.epoch) this.fail();
    }, 10000);
    void Promise.all([resumed ?? context.resume(), loadBuffer()]).then(([, buffer]) => {
      if (epoch !== this.epoch || context !== this.context || !this.wanted()) return;
      if (context.state !== 'running') throw new Error('Audio not running');
      for (const voice of [...this.voices]) if (voice !== this.active) this.retire(voice, true);
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; source.loop = true; gain.gain.value = 0;
      source.connect(gain); gain.connect(context.destination);
      const voice = { source, gain, kind };
      source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(voice); };
      this.voices.add(voice);
      source.start();
      if (this.active) this.retire(this.active);
      this.active = voice; this.pending = null; this.request = null;
      this.ramp(voice, this.settings.ambientVolume / 100);
      this.publish('playing');
    }).catch(() => { if (epoch === this.epoch) this.fail(); }).finally(() => clearTimeout(timeout));
  }
  stopSession(immediate = false) {
    this.authorized = false; this.background = true; this.playing = false;
    this.silence(immediate);
    const context = this.context;
    this.context = null; this.buffers.clear();
    if (context) {
      context.onstatechange = null;
      if (immediate) void context.close().catch(() => {});
      else setTimeout(() => { if (context.state !== 'closed') void context.close().catch(() => {}); }, (fadeSeconds + 0.05) * 1000);
    }
    this.publish('idle');
  }
}

export const ambientAudio = new AmbientAudio();
