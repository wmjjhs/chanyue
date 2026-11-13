// 版权所有：波哥
import { describe, expect, it, vi } from 'vitest';
import { progressOf, readableInk, type Book } from './model';
import { contextAt } from './reading-tools';
import { sourceFontFamily } from './source-font';
import { SentenceListening } from './listening';
import type { SpeechDriver } from './system-speech';
import { sampleBooks } from './samples';

describe('分支边界补全', () => {
  it('没有字符进度时按行号估算阅读进度', () => {
    const book = { ...sampleBooks[0], completed: false, character: undefined, line: 1 } as Book;
    expect(progressOf(book)).toBeGreaterThanOrEqual(0);
    expect(progressOf(book)).toBeLessThanOrEqual(100);
  });

  it('按背景亮度选取可读墨色', () => {
    expect(readableInk('#ffffff')).toBe('#3e493d');
    expect(readableInk('#000000')).toBe('#eeeee3');
  });

  it('按半径裁剪上下文片段', () => {
    expect(contextAt('甲乙丙丁', 2, 1)).toEqual({ start: 1, end: 3, text: '乙丙' });
  });

  it('等宽字体与未知源字体分别回退', () => {
    expect(sourceFontFamily('Consolas')).toContain('monospace');
    expect(sourceFontFamily('未知字体')).toContain('serif');
  });

  it('听书订阅可被取消', () => {
    const driver: SpeechDriver = {
      prepare: async () => {}, stop: async () => {}, speak: async () => {},
    };
    const controller = new SentenceListening('第一句。', driver, { source: 0, completed: false, rate: 1 }, async () => {});
    let calls = 0;
    const unsubscribe = controller.subscribe(() => { calls++; });
    unsubscribe();
    expect(calls).toBe(0);
  });

  it('WebView 缺少 Intl.Segmenter 时按码点切分字素', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    vi.resetModules();
    try {
      const { createDocument } = await import('./reading-layout');
      expect(createDocument(['春🌱']).glyphs).toEqual(['春', '🌱']);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', descriptor!);
      vi.resetModules();
    }
  });
});
