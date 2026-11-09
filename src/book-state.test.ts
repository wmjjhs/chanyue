// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { effectiveSettings, preferencesFor, validateBookState, type PracticeState } from './book-state';
import { fixedPracticeUnits, connectPrevious, practiceRange } from './practice-layout';
import { createBackup, encodeBackup, parseBackup, planRestore } from './backup';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';

describe('固定分段、连段和每书偏好', () => {
  it('原文段落按源位置固定，不因字号、横竖屏或空行改变', () => {
    const text = '第一段。一句。\n\n  第二段🌱。\n第三段。', units = fixedPracticeUnits(text, 'paragraph');
    expect(units.map(r => text.slice(r.start, r.end))).toEqual(['第一段。一句。', '第二段🌱。', '第三段。']);
    expect(fixedPracticeUnits(text, 'paragraph')).toEqual(units);
    expect(practiceRange(units, units[1].start + 2, 2)).toEqual({ index: 1, ranges: units.slice(1) });
  });
  it.each(['paragraph', 'sentence'] as const)('长%s覆盖全部文字，分片不丢字、不切断代理对', unit => {
    const text = '字'.repeat(1999) + '🌱' + '文'.repeat(4100) + '结尾。', ranges = fixedPracticeUnits(text, unit);
    expect(ranges).toHaveLength(4);
    expect(ranges.map(r => text.slice(r.start, r.end)).join('')).toBe(text);
    expect(ranges[0].end).toBe(1999);
    expect(ranges.every(r => r.end - r.start <= 2000)).toBe(true);
    expect(ranges.slice(1).every((r, i) => r.start === ranges[i].end)).toBe(true);
  });
  it('连前段只扩展练习范围，不更改原文；首段和四段边界安全', () => {
    const units = fixedPracticeUnits('甲。\n乙。\n丙。\n丁。\n戊。', 'paragraph');
    const state: PracticeState = { source: units[2].start, span: 1, mask: 'cue', unit: 'paragraph' };
    const next = connectPrevious(units, state);
    expect(next).toEqual({ ...state, source: units[1].start, span: 2 });
    expect(practiceRange(units, next.source, next.span).ranges).toEqual(units.slice(1, 3));
    expect(connectPrevious(units, { ...state, span: 4 })).toEqual({ ...state, span: 4 });
    expect(connectPrevious(units, { ...state, source: 0 })).toEqual({ ...state, source: 0 });
  });
  it('偏好仅覆盖本书关键设置，连续念诵不隐式改动全局或正文', () => {
    const readingPreference = { ...preferencesFor(defaultSettings, 'reciting'), sentenceMode: true, fontSize: 35, speed: 190 };
    const before = JSON.stringify(defaultSettings);
    expect(effectiveSettings(defaultSettings, { ...sampleBooks[0], readingPreference })).toMatchObject({ fontSize: 35, speed: 190, sentenceMode: false, cursorMode: defaultSettings.cursorMode });
    expect(effectiveSettings(defaultSettings, sampleBooks[1])).toBe(defaultSettings);
    expect(JSON.stringify(defaultSettings)).toBe(before);
  });
  it('旧书状态缺省兼容，坏源位置或模式不能进入存储或备份', () => {
    expect(validateBookState({}, 100)).toEqual({});
    const practice: PracticeState = { source: 3, span: 2, mask: 'hidden', unit: 'paragraph' };
    for (const change of [{ source: -1 }, { source: 101 }, { span: 5 }, { span: 0 }, { mask: 'bad' }, { unit: 'html' }]) expect(() => validateBookState({ practice: { ...practice, ...change } }, 100)).toThrow();
    expect(() => validateBookState({ readingPreference: { ...preferencesFor(defaultSettings), speed: NaN } }, 100)).toThrow();
  });
  it('备份完整保留每书练习和偏好，旧备份可读、记录差异留独立副本', () => {
    const book = { ...sampleBooks[0], practice: { source: 3, span: 2, mask: 'cue', unit: 'paragraph' } as PracticeState, readingPreference: preferencesFor(defaultSettings, 'practice') };
    const backup = createBackup([{ book, notes: [] }], defaultSettings), restored = parseBackup(encodeBackup(backup));
    expect(restored).toEqual(backup);
    const old = createBackup([{ book: sampleBooks[0], notes: [] }], defaultSettings);
    expect(old.books[0].book.practice).toBeUndefined();
    expect(planRestore(old.books, backup.books).additions).toHaveLength(1);
    expect(planRestore(backup.books, backup.books).skipped).toBe(1);
  });
});
