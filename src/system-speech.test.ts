// 版权所有：波哥
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ native: true, prepare: vi.fn(), speak: vi.fn(), stop: vi.fn(), addListener: vi.fn(), remove: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native }, registerPlugin: () => mock }));
import { createSystemSpeech } from './system-speech';
const deferred = () => { let resolve!: (value: { remove: typeof mock.remove }) => void; const promise = new Promise<{ remove: typeof mock.remove }>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(() => { vi.resetAllMocks(); mock.native = true; mock.prepare.mockResolvedValue({ available: true }); mock.stop.mockResolvedValue(undefined); mock.speak.mockResolvedValue(undefined); mock.remove.mockResolvedValue(undefined); mock.addListener.mockResolvedValue({ remove: mock.remove }); });
describe('原生系统语音适配', () => {
  it('网页不静默回退联网语音', async () => {
    mock.native = false; await expect(createSystemSpeech().prepare()).rejects.toThrow('安装版'); expect(mock.prepare).not.toHaveBeenCalled();
  });
  it('没有中文语音时给出安装提示，不发声', async () => {
    mock.prepare.mockResolvedValue({ available: false }); await expect(createSystemSpeech().prepare()).rejects.toThrow('中文语音'); expect(mock.speak).not.toHaveBeenCalled();
  });
  it('事件注册完成前暂停不会迟到发声，监听仍释放', async () => {
    const pending = deferred(); mock.addListener.mockReturnValue(pending.promise); const driver = createSystemSpeech();
    const run = driver.speak('测试。', 1, vi.fn()); const assertion = expect(run).rejects.toThrow('暂停');
    await driver.stop(); pending.resolve({ remove: mock.remove }); await assertion;
    expect(mock.speak).not.toHaveBeenCalled(); expect(mock.remove).toHaveBeenCalledOnce();
  });
  it('只接受当前ID的开始事件，停止后事件无效', async () => {
    const driver = createSystemSpeech(), started = vi.fn(); let finish!: () => void;
    mock.speak.mockImplementation(({ id }) => { const callback = mock.addListener.mock.calls[0][1]; callback({ id: 'old' }); callback({ id }); return new Promise<void>(yes => { finish = yes; }); });
    const run = driver.speak('测试。', 1.5, started); await Promise.resolve(); await Promise.resolve();
    expect(started).toHaveBeenCalledOnce(); await driver.stop(); mock.addListener.mock.calls[0][1]({ id: mock.speak.mock.calls[0][0].id });
    expect(started).toHaveBeenCalledOnce(); finish(); await run; expect(mock.remove).toHaveBeenCalledOnce();
  });
  it('播放失败也释放监听器', async () => {
    mock.speak.mockRejectedValue(new Error('中断')); await expect(createSystemSpeech().speak('测试。', 1, vi.fn())).rejects.toThrow('中断'); expect(mock.remove).toHaveBeenCalledOnce();
  });
});
