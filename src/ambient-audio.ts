// 版权所有：波哥
import { Capacitor } from '@capacitor/core';
import { defaultSettings, type Settings } from './model';

type Sound = Settings['ambientSound'];
type Voice = { source: AudioBufferSourceNode; gain: GainNode; kind: Sound; target?: number };
export type AmbientState = 'idle' | 'loading' | 'playing' | 'paused' | 'interrupted' | 'error';
const files: Record<Sound, string> = { rain: '/ambience/rain.wav', wind: '/ambience/wind.wav', stream: '/ambience/stream.wav' };
export const ambientNames: Record<Sound, string> = { rain: '柔雨', wind: '微风', stream: '流水' };
const fadeSeconds = 0.35;
const failureMessages = {
  context: 'E01 音频引擎初始化失败', resource: 'E02 本地音频读取失败', response: 'E03 音频响应异常',
  data: 'E04 音频数据不完整', decode: 'E05 音频解码失败', resume: 'E06 音频引擎未能启动',
  playback: 'E07 音源启动失败', timeout: 'E08 音频准备超时',
};
type FailureCode = keyof typeof failureMessages;
class AudioFailure extends Error {
  constructor(readonly code: FailureCode, readonly status?: number) { super(code); }
}
async function audioStep<T>(code: FailureCode, action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch { throw new AudioFailure(code); }
}
function isBundledResponse(response: Response, file: string): boolean {
  return Capacitor.getPlatform() === 'ios' && location.protocol === 'capacitor:'
    && response.status === 0 && !response.redirected
    && !['opaque', 'opaqueredirect', 'error'].includes(response.type)
    && (!response.url || response.url === new URL(file, location.href).href);
}

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
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private suspension: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  getError = () => this.error;
  private publish(state: AmbientState, error: string | null = null) {
    if (this.state === state && this.error === error) return;
    this.state = state; this.error = error;
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
      const resumed = audioStep('resume', () => context.resume());
      this.load(resumed);
    } catch (error) { this.fail(error, 'context'); }
  }
  private fail(error: unknown, fallback: FailureCode = 'playback') {
    this.authorized = false;
    this.silence(true);
    if (this.context?.state !== 'closed') void this.context?.suspend().catch(() => {});
    const failure = error instanceof AudioFailure ? error : new AudioFailure(fallback);
    const status = failure.status !== undefined && Number.isInteger(failure.status) && failure.status >= 0 && failure.status <= 599 ? `（状态${failure.status}）` : '';
    this.publish('error', failureMessages[failure.code] + status);
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
      const response = await audioStep('resource', () => fetch(files[kind], { signal: request.signal, credentials: 'same-origin', redirect: 'error' }));
      if (!response.ok && !isBundledResponse(response, files[kind])) throw new AudioFailure('response', response.status);
      const bytes = await audioStep('resource', () => response.arrayBuffer());
      if (bytes.byteLength > 2_000_000 || bytes.byteLength < 44) throw new AudioFailure('data');
      const header = new DataView(bytes);
      if (header.getUint32(0) !== 0x52494646 || header.getUint32(8) !== 0x57415645 || header.getUint32(4, true) + 8 !== bytes.byteLength) throw new AudioFailure('data');
      const buffer = await audioStep('decode', () => context.decodeAudioData(bytes));
      if (!Number.isFinite(buffer.duration) || buffer.duration < 1 || buffer.duration > 60) throw new AudioFailure('data');
      if (epoch === this.epoch) this.buffers.set(kind, buffer);
      return buffer;
    };
    const timeout = setTimeout(() => {
      if (epoch === this.epoch) this.fail(new AudioFailure('timeout'));
    }, 10000);
    void Promise.all([resumed ?? audioStep('resume', () => context.resume()), loadBuffer()]).then(([, buffer]) => {
      if (epoch !== this.epoch || context !== this.context || !this.wanted()) return;
      if (context.state !== 'running') throw new AudioFailure('resume');
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
    }).catch(error => { if (epoch === this.epoch) this.fail(error); }).finally(() => clearTimeout(timeout));
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
