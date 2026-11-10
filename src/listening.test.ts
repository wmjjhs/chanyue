// 版权所有：波哥
import { describe, expect, it, vi } from 'vitest';
import { SentenceListening, speechChunks, adaptiveSpeechSpeed, DEFAULT_SPEECH_SPEED, measuredSpeechSpeed, smoothSpeechSpeed } from './listening';
import type { SpeechDriver } from './system-speech';
import { preferencesFor, validateBookState } from './book-state';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';
import { createBackup, encodeBackup, parseBackup, planRestore } from './backup';
const deferred = () => { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup(text = '第一句。第二句。第三句。') {
  const calls: { text: string; next: string; rate: number; started: (seconds?: number) => void; done: ReturnType<typeof deferred> }[] = [];
  const driver: SpeechDriver = { prepare: vi.fn(async () => {}), stop: vi.fn(async () => {}), speak: vi.fn((text, rate, started, next) => { const done = deferred(); calls.push({ text, next: next ?? '', rate, started, done }); return done.promise; }) };
  const save = vi.fn(async () => {});
  const controller = new SentenceListening(text, driver, { source: 0, completed: false, rate: 1 }, save);
  return { controller, calls, driver, save };
}
describe('系统听书按句控制器', () => {
  it('只在真实开始时显示发声，只在完成时进入下一句，末句结束才完成', async () => {
    const { controller: c, calls, save } = setup(); const run = c.start(); await flush();
    expect(calls.map(c => c.text)).toEqual(['第一句。']); expect(c.getSnapshot().speaking).toBe(false);
    calls[0].started(); expect(c.getSnapshot().speaking).toBe(true);
    expect(c.getSnapshot().source).toBe(0); calls[0].done.resolve(); await flush();
    expect(calls[1].text).toBe('第二句。'); expect(c.getSnapshot().source).toBe(4);
    calls[1].done.resolve(); await flush(); expect(c.getSnapshot().completed).toBe(false);
    calls[2].done.resolve(); await run;
    expect(c.getSnapshot()).toMatchObject({ source: 12, completed: true, active: false });
    expect(save).toHaveBeenLastCalledWith({ source: 12, completed: true, rate: 1 });
  });
  it('正常续句不增加定位标识，开始/重开与主动跳句才增加', async () => {
    const { controller: c, calls } = setup(); const run = c.start(); await flush();
    const initial = c.getSnapshot().seekId;
    expect(initial).toBe(1);
    calls[0].done.resolve(); await flush();
    expect(c.getSnapshot().seekId).toBe(initial);
    c.pause(); calls[1].done.resolve(); await run;
    await c.seek(8); expect(c.getSnapshot().seekId).toBe(initial + 1);
    const replay = c.start(); await flush();
    expect(c.getSnapshot()).toMatchObject({ seekId: initial + 2, speaking: false, duration: 0, focus: 8 });
    c.pause(); calls[2].done.resolve(); await replay;
  });
  it('真实发声第一帧带回音频时长与片段范围，准备阶段清零', async () => {
    const { controller: c, calls } = setup(); const run = c.start(); await flush();
    expect(c.getSnapshot()).toMatchObject({ speaking: false, duration: 0, startedId: 0, spokenEnd: 4 });
    calls[0].started(2.4);
    expect(c.getSnapshot()).toMatchObject({ speaking: true, duration: 2.4, startedId: 1, spokenEnd: 4 });
    calls[0].done.resolve(); await flush();
    expect(c.getSnapshot()).toMatchObject({ speaking: false, duration: 0, startedId: 1, spokenEnd: 8 });
    calls[1].started(999);
    expect(c.getSnapshot()).toMatchObject({ duration: 0, startedId: 2 });
    c.pause(); calls[1].done.resolve(); await run;
  });
  it('真实音频时长换算匀速滚动，非法时长丢弃且速度逐帧平滑', () => {
    expect(measuredSpeechSpeed(12, 2)).toBe(6);
    expect(measuredSpeechSpeed(12, 1000)).toBeNull();
    expect(measuredSpeechSpeed(0, 2)).toBeNull();
    expect(measuredSpeechSpeed(12, Number.NaN)).toBeNull();
    expect(measuredSpeechSpeed(1e9, 0.1)).toBe(12);
    expect(smoothSpeechSpeed(4, 8, 1 / 60)).toBeGreaterThan(4);
    expect(smoothSpeechSpeed(4, 8, 1 / 60)).toBeLessThan(4.2);
    expect(smoothSpeechSpeed(4, 0, 0)).toBe(4);
  });
  it('自适应语速按实测耗时平滑收敛并拒绝无效样本', () => {
    expect(DEFAULT_SPEECH_SPEED).toBe(4.2);
    expect(adaptiveSpeechSpeed(4.2, 20, 2, 1)).toBeGreaterThan(4.2);
    expect(adaptiveSpeechSpeed(4.2, 20, 10, 1)).toBeLessThan(4.2);
    expect(adaptiveSpeechSpeed(4.2, 20, 2, 2)).toBeLessThan(adaptiveSpeechSpeed(4.2, 20, 2, 1));
    expect(adaptiveSpeechSpeed(4.2, 0, 2, 1)).toBe(4.2);
    expect(adaptiveSpeechSpeed(4.2, 20, 0.1, 1)).toBe(4.2);
    expect(adaptiveSpeechSpeed(Number.NaN, 20, 2, 1)).toBeGreaterThan(0);
    expect(adaptiveSpeechSpeed(4.2, 1e9, 0.3, 0.5)).toBeLessThanOrEqual(12);
  });
  it('朗读当前句时预取下一句，末句不预取', async () => {
    const { controller: c, calls } = setup(); const run = c.start(); await flush();
    expect(calls[0]).toMatchObject({ text: '第一句。', next: '第二句。' });
    calls[0].done.resolve(); await flush();
    expect(calls[1]).toMatchObject({ text: '第二句。', next: '第三句。' });
    calls[1].done.resolve(); await flush();
    expect(calls[2]).toMatchObject({ text: '第三句。', next: '' });
    calls[2].done.resolve(); await run;
  });
  it('暂停后旧回调不能推进，继续从当前句重读', async () => {
    const { controller: c, calls } = setup(); const old = c.start(); await flush(); c.pause();
    calls[0].started(); calls[0].done.resolve(); await old;
    expect(calls).toHaveLength(1); expect(c.getSnapshot().speaking).toBe(false);
    const next = c.start(); await flush(); expect(calls[1].text).toBe('第一句。'); c.pause(); calls[1].done.resolve(); await next;
  });
  it('快速跳句/旧错误不回滚当前句，并且不同会话互不写错', async () => {
    const { controller: c, calls } = setup(); const old = c.start(); await flush();
    await c.seek(8); const next = c.start(); await flush(); calls[0].done.reject(new Error('old error')); await old;
    expect(c.getSnapshot()).toMatchObject({ source: 8, error: '', active: true });
    expect(calls[1].text).toBe('第三句。'); c.pause(); calls[1].done.resolve(); await next;
  });
  it('初始化未完成时取消，不得稍后发声', async () => {
    const { controller: c, driver, calls } = setup(); const init = deferred(); vi.mocked(driver.prepare).mockReturnValue(init.promise);
    const run = c.start(); await flush(); c.pause(); init.resolve(); await run; expect(calls).toHaveLength(0);
  });
  it('缺少语音/朗读错误不推进完成状态，允许重试', async () => {
    const { controller: c, driver, calls } = setup(); vi.mocked(driver.prepare).mockRejectedValueOnce(new Error('没有中文语音'));
    await c.start(); expect(c.getSnapshot()).toMatchObject({ active: false, source: 0, completed: false, error: '没有中文语音' });
    const run = c.start(); await flush(); calls[0].done.reject(new Error('声音中断')); await run;
    expect(c.getSnapshot()).toMatchObject({ active: false, source: 0, completed: false, error: '声音中断' });
  });
  it('语速和听读位置保存失败不得发声/假装成功', async () => {
    const { controller: c, save, calls } = setup(); save.mockRejectedValueOnce(new Error('disk full'));
    await c.start(); expect(calls).toHaveLength(0); expect(c.getSnapshot().error).toContain('尚未保存');
    save.mockRejectedValueOnce(new Error('disk full')); await expect(c.seek(4, 1.5)).rejects.toThrow('尚未保存');
    const run = c.start(); await flush(); expect(calls[0]).toMatchObject({ text: '第二句。', rate: 1.5 }); c.pause(); calls[0].done.resolve(); await run;
  });
  it('保存串行，旧写入完成后不能覆盖更新的跳句位置', async () => {
    const { controller: c, save } = setup(); const first = deferred(); save.mockImplementationOnce(() => first.promise);
    const a = c.seek(4); await flush(); const b = c.seek(8); first.resolve(); await Promise.all([a, b]);
    expect(save).toHaveBeenLastCalledWith({ source: 8, completed: false, rate: 1 });
    expect(c.getSnapshot().source).toBe(8);
  });
  it('长句完整分片且不拆UTF16代理对、不漏字', async () => {
    const text = '甲'.repeat(999) + '😀' + '乙'.repeat(2001) + '。';
    const chunks = speechChunks(text, { start: 0, end: text.length });
    expect(chunks.every(c => c.end - c.start <= 1000)).toBe(true);
    expect(chunks.map(c => text.slice(c.start, c.end)).join('')).toBe(text);
    expect(chunks.some(c => c.start === 1000 || c.end === 1000)).toBe(false);
    const { controller: c, calls } = setup(text); const run = c.start(); await flush();
    for (let i = 0; i < chunks.length; i++) { calls[i].started(); expect(c.getSnapshot().source).toBe(0); calls[i].done.resolve(); await flush(); }
    await run; expect(c.getSnapshot().completed).toBe(true);
  });
  it('已听完重新听书定位到首句句首，而不是书末', async () => {
    const { calls, driver, save } = setup();
    const replay = new SentenceListening('第一句。第二句。第三句。', driver, { source: 12, completed: true, rate: 1 }, save);
    const run = replay.start(); await flush();
    expect(replay.getSnapshot()).toMatchObject({ focus: 0, spokenEnd: 4, speaking: false, seekId: 1 });
    expect(calls[0].text).toBe('第一句。');
    replay.pause(); calls[0].done.resolve(); await run;
  });
  it('重开从保存句首继续，已听完回退到最后一句', async () => {
    const { driver, save, calls } = setup(); const c = new SentenceListening('甲。乙。', driver, { source: 4, completed: true, rate: 0.75 }, save);
    c.step(-1); await flush(); expect(c.getSnapshot()).toMatchObject({ source: 2, completed: false });
    const run = c.start(); await flush(); expect(calls[0]).toMatchObject({ text: '乙。', rate: 0.75 }); calls[0].done.resolve(); await run;
  });
  it('听书状态严格校验，备份往返并参与恢复去重', () => {
    const listening = { source: 4, completed: false, rate: 1.25 };
    const book = { ...sampleBooks[0], listening, readingPreference: preferencesFor(defaultSettings, 'listening') };
    const backup = createBackup([{ book, notes: [] }], defaultSettings);
    expect(parseBackup(encodeBackup(backup)).books[0].book).toMatchObject({ listening });
    expect(planRestore(backup.books, backup.books).skipped).toBe(1);
    expect(planRestore([{ ...backup.books[0], book: { ...book, listening: { ...listening, source: 8 } } }], backup.books).additions).toHaveLength(1);
    for (const value of [{ ...listening, source: -1 }, { ...listening, rate: NaN }, { ...listening, rate: 3 }, { ...listening, source: 1.5 }, { ...listening, completed: true }]) expect(() => validateBookState({ listening: value }, 100)).toThrow();
    expect(validateBookState({}, 100)).toEqual({});
  });
});
