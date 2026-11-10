// 版权所有：波哥
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ native: true, prepare: vi.fn(), speak: vi.fn(), stop: vi.fn(), addListener: vi.fn(), remove: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native }, registerPlugin: () => mock }));
import { createSystemSpeech, speechVoices } from './system-speech';
const deferred = () => { let resolve!: (value: { remove: typeof mock.remove }) => void; const promise = new Promise<{ remove: typeof mock.remove }>(yes => { resolve = yes; }); return { promise, resolve }; };
const ready = (extra: Record<string, unknown> = {}) => ({ available: true, neural: false, voices: [], ...extra });
beforeEach(() => { vi.resetAllMocks(); mock.native = true; mock.prepare.mockResolvedValue(ready()); mock.stop.mockResolvedValue(undefined); mock.speak.mockResolvedValue(undefined); mock.remove.mockResolvedValue(undefined); mock.addListener.mockResolvedValue({ remove: mock.remove }); });
describe('原生系统语音适配', () => {
  it('网页不静默回退联网语音', async () => {
    mock.native = false; await expect(createSystemSpeech().prepare()).rejects.toThrow('安装版'); expect(mock.prepare).not.toHaveBeenCalled();
  });
  it('没有中文语音且没有神经语音时给出安装提示，不发声', async () => {
    mock.prepare.mockResolvedValue({ available: false, neural: false, voices: [] }); await expect(createSystemSpeech().prepare()).rejects.toThrow('中文语音'); expect(mock.speak).not.toHaveBeenCalled();
  });
  it('只有本地神经语音可用时不报错', async () => {
    mock.prepare.mockResolvedValue({ available: false, neural: true, voices: [] }); await expect(createSystemSpeech().prepare()).resolves.toBeUndefined();
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
  it('朗读文本经过内置多音字词典，原文和长度不变', async () => {
    await createSystemSpeech().speak('般若与银行。', 1, vi.fn());
    expect(mock.speak.mock.calls[0][0].text).toBe('波惹与银航。');
  });
  it('自定义读音规则可覆盖内置规则', async () => {
    const options = { engine: 'system' as const, voice: '', rules: [{ from: '银行', to: '很行' }] };
    await createSystemSpeech(() => options).speak('银行。', 1, vi.fn());
    expect(mock.speak.mock.calls[0][0].text).toBe('很行。');
  });
  it('每次朗读读取最新设置，音色与引擎一并传给原生插件', async () => {
    let options = { engine: 'neural' as const, voice: 'voice-a', rules: [] };
    const driver = createSystemSpeech(() => options);
    await driver.prepare();
    await driver.speak('测试。', 1, vi.fn());
    expect(mock.speak.mock.calls[0][0]).toMatchObject({ engine: 'system', voice: 'voice-a' });
    mock.prepare.mockResolvedValue(ready({ neural: true }));
    await driver.prepare();
    options = { engine: 'neural' as const, voice: 'voice-b', rules: [] };
    await driver.speak('测试。', 1, vi.fn());
    expect(mock.speak.mock.calls[1][0]).toMatchObject({ engine: 'neural', voice: 'voice-b' });
  });
  it('神经语音不可用时自动回退系统语音', async () => {
    mock.prepare.mockResolvedValue(ready({ neural: false }));
    const driver = createSystemSpeech(() => ({ engine: 'neural', voice: '', rules: [] }));
    await driver.prepare(); await driver.speak('测试。', 1, vi.fn());
    expect(mock.speak.mock.calls[0][0].engine).toBe('system');
  });
  it('音色列表过滤非法标识并去重，网页版返回空', async () => {
    mock.prepare.mockResolvedValue(ready({ neural: true, voices: [
      { id: 'zh-CN-Ting', name: '婷婷' }, { id: 'bad/id', name: '注入' }, { id: 'zh-CN-Ting', name: '重复' }, null,
    ] }));
    await expect(speechVoices()).resolves.toEqual({ available: true, neural: true, voices: [{ id: 'zh-CN-Ting', name: '婷婷' }] });
    mock.native = false;
    await expect(speechVoices()).resolves.toEqual({ available: false, neural: false, voices: [] });
  });
  it('插件不可用时音色查询返回空而不抛错', async () => {
    mock.prepare.mockRejectedValue(new Error('未实现'));
    await expect(speechVoices()).resolves.toEqual({ available: false, neural: false, voices: [] });
  });
  it('神经语音把下一句交给原生预合成，两句都经过读音词典', async () => {
    const options = { engine: 'neural' as const, voice: '', rules: [{ from: '银行', to: '很行' }] };
    const driver = createSystemSpeech(() => options);
    mock.prepare.mockResolvedValue(ready({ neural: true }));
    await driver.prepare();
    await driver.speak('般若与银行。', 1, vi.fn(), '银行与南无。');
    expect(mock.speak.mock.calls[0][0]).toMatchObject({ engine: 'neural', text: '波惹与很行。', next: '很行与那摩。' });
  });
  it('系统语音不做预合成，避免无谓开销', async () => {
    await createSystemSpeech().speak('测试。', 1, vi.fn(), '下一句。');
    expect(mock.speak.mock.calls[0][0].next).toBe('');
  });
});
