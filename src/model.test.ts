// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { advanceFlow, defaultSettings, getFlowWindow, MAX_READING_SPEED, progressOf, splitLines, validateSettings } from './model';
import { decodeText, importBook } from './importer';
import { sampleBooks } from './samples';

describe('阅读行切分', () => {
  it('清除 BOM、空行和控制字符，保留标点', () => {
    expect(splitLines('\uFEFF第一行。\r\n\r\n第二行\u0000。')).toEqual(['第一行。', '第二行。']);
  });
  it('按句子拆分长段落', () => {
    const result = splitLines(`${'甲'.repeat(60)}。${'乙'.repeat(60)}。`);
    expect(result).toHaveLength(2);
    expect(result.join('')).toBe(`${'甲'.repeat(60)}。${'乙'.repeat(60)}。`);
  });
  it('长行和代理对不会丢失或被切坏', () => {
    const original = '春🌱'.repeat(300);
    const result = splitLines(original);
    expect(result.every(line => Array.from(line).length <= 100)).toBe(true);
    expect(result.join('')).toBe(original);
  });
  it('空文件没有阅读行', () => { expect(splitLines(' \n\t\r\n')).toEqual([]); });
});

describe('阅读设置与进度', () => {
  it('不信任持久化的非法参数', () => {
    expect(validateSettings({ font: '__proto__', fontSize: NaN, speed: 9000, pageColor: 'url(invalid)' }))
      .toEqual({ ...defaultSettings, speed: MAX_READING_SPEED });
    expect(validateSettings(null)).toEqual(defaultSettings);
  });
  it('最高速度为旧上限十倍，保存后仍能使用', () => {
    expect(MAX_READING_SPEED).toBe(160 * 10);
    expect(validateSettings({ speed: 1600 }).speed).toBe(1600);
    expect(validateSettings({ speed: 900 }).speed).toBe(900);
    expect(validateSettings({ speed: -1 }).speed).toBe(15);
  });
  it('已读完标记显示 100%', () => {
    expect(progressOf(sampleBooks[0])).toBe(0);
    expect(progressOf({ ...sampleBooks[0], completed: true })).toBe(100);
  });
});

describe('连续文字流', () => {
  it('相邻阅读行不添加空格，保留行内英文空格', () => {
    expect(getFlowWindow(['第一行。', '第二行。', 'hello world'], 0).join(''))
      .toBe('第一行。第二行。hello world');
  });
  it('预载窗口有限且跳行后从指定行开始', () => {
    const lines = Array.from({ length: 10000 }, (_, i) => `第${i}行。`);
    const window = getFlowWindow(lines, 20, 100);
    expect(window[0]).toBe('第20行。');
    expect(window.join('').length).toBeGreaterThanOrEqual(100);
    expect(window.length).toBeLessThan(30);
    expect(getFlowWindow(lines, lines.length)).toEqual([]);
  });
  it('刚好过行时下一行直接位于左端，而不是重新从右侧进入', () => {
    expect(advanceFlow(-100, [100, 80])).toEqual({ x: 0, passed: 1 });
  });
  it('高速一帧跨越多行仍保留剩余位移', () => {
    expect(advanceFlow(-147.5, [40, 50, 60, 90])).toEqual({ x: -57.5, passed: 2 });
    expect(advanceFlow(-150, [40, 50, 60])).toEqual({ x: 0, passed: 3 });
    expect(advanceFlow(28, [40, 50])).toEqual({ x: 28, passed: 0 });
  });
});

describe('文件导入', () => {
  it('支持 UTF-8 和 GB18030', () => {
    expect(decodeText(new TextEncoder().encode('你好，禅阅'))).toBe('你好，禅阅');
    expect(decodeText(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]))).toBe('你好');
  });
  it('支持带 BOM 的 UTF-16', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]))).toBe('你好');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d]))).toBe('你好');
  });
  it('TXT 导入保留真实内容', async () => {
    const book = await importBook(new File(['春风吹过。\n叶子摇动。'], '春风.txt'), () => {});
    expect(book.title).toBe('春风');
    expect(book.lines).toEqual(['春风吹过。', '叶子摇动。']);
    expect(book.format).toBe('TXT');
  });
  it('拒绝空文件、过大文件和旧 DOC', async () => {
    await expect(importBook(new File([], 'empty.txt'), () => {})).rejects.toThrow('空');
    await expect(importBook(new File(['test'], 'legacy.doc'), () => {})).rejects.toThrow('另存');
    await expect(importBook(new File([new Uint8Array(21 * 1024 * 1024)], 'big.txt'), () => {})).rejects.toThrow('20 MB');
  });
  it('拒绝未知文件类型', async () => {
    await expect(importBook(new File(['text'], 'page.html'), () => {})).rejects.toThrow('请选择');
  });
});
