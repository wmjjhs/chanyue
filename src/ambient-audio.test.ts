// 版权所有：波哥
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmbientAudio } from './ambient-audio';
import { defaultSettings } from './model';
import { Capacitor } from '@capacitor/core';

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: vi.fn(() => 'web') } }));

const makeSource = () => ({ buffer: null, loop: false, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null });
const makeGain = () => ({ gain: { value: 0, cancelAndHoldAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() });

class FakeContext {
  static all: FakeContext[] = [];
  state = 'suspended'; currentTime = 0; destination = {}; onstatechange: (() => void) | null = null;
  sources: ReturnType<typeof makeSource>[] = [];
  gains: ReturnType<typeof makeGain>[] = [];
  constructor() { FakeContext.all.push(this); }
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  decodeAudioData = vi.fn(async () => ({ duration: 24 }));
  createBufferSource() {
    const source = makeSource();
    this.sources.push(source); return source;
  }
  createGain() {
    const gain = makeGain();
    this.gains.push(gain); return gain;
  }
}
const enabled = { ...defaultSettings, ambientEnabled: true };
const wavBytes = (size = 100) => {
  const bytes = new ArrayBuffer(size), view = new DataView(bytes);
  new Uint8Array(bytes).set(new TextEncoder().encode('RIFF'));
  new Uint8Array(bytes).set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(4, size - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 176400, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  new Uint8Array(bytes).set(new TextEncoder().encode('data'), 36); view.setUint32(40, size - 44, true);
  return bytes;
};
const response = () => ({ ok: true, status: 200, type: 'basic', redirected: false, url: '', arrayBuffer: async () => wavBytes() });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let audio: AmbientAudio;
beforeEach(() => {
  vi.useFakeTimers(); FakeContext.all = [];
  vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
  vi.stubGlobal('location', new URL('https://reader.example/'));
  vi.stubGlobal('AudioContext', FakeContext); vi.stubGlobal('navigator', {});
  vi.stubGlobal('fetch', vi.fn(async () => response()));
  audio = new AmbientAudio();
});
afterEach(() => { audio.stopSession(true); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('阅读环境音生命周期', () => {
  it('配置偏好和打开书籍不创建音频，开始后才加载同源循环并淡入', async () => {
    audio.configure(enabled, false); expect(FakeContext.all).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
    audio.start(enabled); await flush();
    const context = FakeContext.all[0];
    expect(audio.getSnapshot()).toBe('playing');
    expect(fetch).toHaveBeenCalledWith('/ambience/rain.wav', expect.objectContaining({ redirect: 'error', credentials: 'same-origin' }));
    expect(context.sources[0].loop).toBe(true); expect(context.sources[0].start).toHaveBeenCalledTimes(1);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, 0.35);
  });
  it.each(['rain', 'wind', 'stream'] as const)('iOS包内%s音频状态0但数据有效时应正常播放，60%音量不被误判失败', async ambientSound => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.stubGlobal('location', new URL('capacitor://localhost/'));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ...response(), ok: false, status: 0, url: `capacitor://localhost/ambience/${ambientSound}.wav` })));
    audio.start({ ...enabled, ambientSound, ambientVolume: 60 }); await flush();
    expect(audio.getSnapshot()).toBe('playing');
    expect(FakeContext.all[0].decodeAudioData).toHaveBeenCalledTimes(1);
    expect(FakeContext.all[0].gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.6, 0.35);
  });
  it.each([
    ['web', 'https://reader.example/', 0, 'basic', false, ''],
    ['ios', 'https://reader.example/', 0, 'basic', false, ''],
    ['ios', 'capacitor://localhost/', 404, 'basic', false, ''],
    ['ios', 'capacitor://localhost/', 500, 'basic', false, ''],
    ['ios', 'capacitor://localhost/', 0, 'opaque', false, ''],
    ['ios', 'capacitor://localhost/', 0, 'opaqueredirect', false, ''],
    ['ios', 'capacitor://localhost/', 0, 'error', false, ''],
    ['ios', 'capacitor://localhost/', 0, 'basic', true, ''],
    ['ios', 'capacitor://localhost/', 0, 'basic', false, 'https://other.example/rain.wav'],
    ['ios', 'capacitor://localhost/', 0, 'basic', false, 'capacitor://localhost/other.wav'],
  ] as const)('异常响应不可绕过校验：%s %s %s %s %s %s', async (platform, href, status, type, redirected, url) => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    vi.stubGlobal('location', new URL(href));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ...response(), ok: false, status, type, redirected, url })));
    audio.start(enabled); await flush();
    expect(audio.getSnapshot()).toBe('error');
    expect(audio.getError()).toBe(`E03 音频响应异常（状态${status}）`);
    expect(FakeContext.all[0].decodeAudioData).not.toHaveBeenCalled();
  });
  it.each([0, 43, 100, 11_000_001])('状态0返回空白或损坏的%d字节数据仍拒绝解码', async length => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.stubGlobal('location', new URL('capacitor://localhost/'));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ...response(), ok: false, status: 0, arrayBuffer: async () => new ArrayBuffer(length) })));
    audio.start(enabled); await flush();
    expect(audio.getError()).toBe('E04 音频数据不完整');
    expect(FakeContext.all[0].decodeAudioData).not.toHaveBeenCalled();
  });
  it.each([4_233_644, 10_231_244, 11_000_000])('iOS状态0下%d字节合法双声道WAV可播放', async size => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.stubGlobal('location', new URL('capacitor://localhost/'));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ...response(), ok: false, status: 0, arrayBuffer: async () => wavBytes(size) })));
    audio.start(enabled);
    FakeContext.all[0].decodeAudioData.mockResolvedValueOnce({ duration: 58 });
    await flush();
    expect(audio.getSnapshot()).toBe('playing');
  });
  it('即使WAV头和长度正确，超过11MB仍拒绝解码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ...response(), arrayBuffer: async () => wavBytes(11_000_004) })));
    audio.start(enabled); await flush();
    expect(audio.getError()).toBe('E04 音频数据不完整');
    expect(FakeContext.all[0].decodeAudioData).not.toHaveBeenCalled();
  });
  it.each([0, 0.99, 60.01, NaN, Infinity])('非法解码时长%s仍拒绝播放', async duration => {
    audio.start(enabled);
    FakeContext.all[0].decodeAudioData.mockResolvedValueOnce({ duration });
    await flush();
    expect(audio.getError()).toBe('E04 音频数据不完整');
    expect(FakeContext.all[0].sources).toHaveLength(0);
  });
  it('默认关闭/音量零都不创建音频', () => {
    audio.start(defaultSettings); audio.start({ ...enabled, ambientVolume: 0 });
    expect(FakeContext.all).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('默认暂停继续，关闭选项则淡出停止并挂起，关闭设置不自行恢复', async () => {
    audio.start(enabled); await flush(); const context = FakeContext.all[0];
    audio.configure(enabled, false); expect(context.sources[0].stop).not.toHaveBeenCalled();
    context.currentTime = 0.1;
    audio.configure(enabled, false);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
    context.currentTime = 0;
    audio.configure({ ...enabled, ambientContinuePaused: false }, false);
    expect(context.sources[0].stop).toHaveBeenCalledWith(0.35);
    expect(audio.getSnapshot()).toBe('paused');
    await vi.advanceTimersByTimeAsync(401); expect(context.suspend).toHaveBeenCalled();
    audio.configure({ ...enabled, ambientContinuePaused: false }, false); await flush();
    expect(context.sources).toHaveLength(1);
    audio.start({ ...enabled, ambientContinuePaused: false }); await flush();
    expect(audio.getSnapshot()).toBe('playing'); expect(context.sources).toHaveLength(2);
  });
  it('音量和快速切换只保留最新请求，不重复叠加同类源', async () => {
    audio.start(enabled); await flush(); const context = FakeContext.all[0];
    audio.configure({ ...enabled, ambientVolume: 42 }, true);
    expect(context.sources).toHaveLength(1);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.42, 0.35);
    audio.configure({ ...enabled, ambientSound: 'wind' }, true);
    audio.configure(enabled, true); await flush();
    expect(context.sources).toHaveLength(1);
    audio.configure({ ...enabled, ambientSound: 'stream' }, true); await flush();
    expect(context.sources).toHaveLength(2); expect(context.sources[0].stop).toHaveBeenCalled();
    expect(audio.getSnapshot()).toBe('playing');
  });
  it('请求未完成时进入后台或关闭开关，迟到解码不能启动音源', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r; })));
    audio.start(enabled); audio.stopSession(true);
    resolve(response()); await flush();
    expect(FakeContext.all[0].sources).toHaveLength(0);
    expect(FakeContext.all[0].close).toHaveBeenCalled();
    audio.configure(enabled, false); expect(audio.getSnapshot()).toBe('idle');
    audio.start(enabled); audio.configure({ ...enabled, ambientEnabled: false }, true);
    resolve(response()); await flush(); expect(FakeContext.all[1].sources).toHaveLength(0);
  });
  it('返回书架淡出关闭，后台立即关闭，回前台不自动复活', async () => {
    audio.start(enabled); await flush(); const context = FakeContext.all[0];
    audio.stopSession(); expect(context.sources[0].stop).toHaveBeenCalledWith(0.35);
    await vi.advanceTimersByTimeAsync(401); expect(context.close).toHaveBeenCalled();
    audio.configure(enabled, true); expect(FakeContext.all).toHaveLength(1);
    audio.start(enabled); await flush(); audio.stopSession(true);
    expect(FakeContext.all[1].sources[0].stop).toHaveBeenCalledWith(0);
    expect(FakeContext.all[1].close).toHaveBeenCalled();
  });
  it('加载失败、解码失败、播放受阻及超时可重试且不抛向阅读器', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline missing'); }));
    audio.start(enabled); await flush(); expect(audio.getSnapshot()).toBe('error');
    expect(audio.getError()).toBe('E02 本地音频读取失败');
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    FakeContext.all[0].decodeAudioData.mockRejectedValueOnce(new Error('decode'));
    audio.start(enabled); await flush(); expect(audio.getSnapshot()).toBe('error');
    expect(audio.getError()).toBe('E05 音频解码失败');
    FakeContext.all[0].resume.mockRejectedValueOnce(new Error('NotAllowed'));
    audio.start(enabled); await flush(); expect(audio.getSnapshot()).toBe('error');
    expect(audio.getError()).toBe('E06 音频引擎未能启动');
    audio.start(enabled); await flush(); expect(audio.getSnapshot()).toBe('playing');
    expect(audio.getError()).toBeNull();
    audio.stopSession(true); vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    audio.start(enabled); await vi.advanceTimersByTimeAsync(10001); expect(audio.getSnapshot()).toBe('error');
    expect(audio.getError()).toBe('E08 音频准备超时');
  });
  it('内核不支持Web Audio时显示错误而不向阅读器抛出异常', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => audio.start(enabled)).not.toThrow();
    expect(audio.getSnapshot()).toBe('error');
    expect(audio.getError()).toBe('E01 音频引擎初始化失败');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('iOS状态0无响应URL但WAV有效可播放，后台取消仍阻止迟到音源', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.stubGlobal('location', new URL('capacitor://localhost/'));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ...response(), ok: false, status: 0 })));
    audio.start(enabled); await flush();
    expect(audio.getSnapshot()).toBe('playing');
    audio.stopSession(true);
    let finish!: (value: ReturnType<typeof response>) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
    audio.start(enabled); audio.stopSession(true);
    finish({ ...response(), ok: false, status: 0 }); await flush();
    expect(FakeContext.all[1].sources).toHaveLength(0);
    expect(audio.getSnapshot()).toBe('idle');
  });
  it('系统音频中断立即关闭，订阅可移除，重新手势可恢复', async () => {
    const notify = vi.fn(); const unsubscribe = audio.subscribe(notify);
    audio.start(enabled); await flush(); const context = FakeContext.all[0];
    context.state = 'interrupted'; context.onstatechange?.();
    expect(audio.getSnapshot()).toBe('interrupted'); expect(context.close).toHaveBeenCalled();
    unsubscribe(); const calls = notify.mock.calls.length;
    audio.start(enabled); await flush(); expect(audio.getSnapshot()).toBe('playing'); expect(notify).toHaveBeenCalledTimes(calls);
  });
});
