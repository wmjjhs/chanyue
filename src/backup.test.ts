// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { createBackup, encodeBackup, parseBackup, planRestore, validateBackup, validateLocalEntries, type BackupEntry } from './backup';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';
const entry = (): BackupEntry => ({ book: { ...sampleBooks[0], character: 3.25, contents: [{ title: '开头', source: 0, level: 1 }], typography: [{ start: 0, end: 2, scale: 2, bold: true }], typographyVersion: 1 }, notes: [{ id: 'note-1', kind: 'bookmark', start: 3.25, end: 3.25, quote: '', note: '<文字，不是HTML>', createdAt: 1, updatedAt: 1 }] });

describe('书库备份与非破坏恢复', () => {
  it('单份备份限额不限制本地已有书库继续查重恢复', () => {
    const entries = Array.from({ length: 501 }, (_, index) => ({ book: { ...sampleBooks[0], id: `book-${index}`, lines: ['短正文。'] }, notes: [] }));
    expect(() => createBackup(entries, defaultSettings)).toThrow();
    const current = validateLocalEntries(entries);
    expect(planRestore(current, createBackup([entries[0]], defaultSettings).books)).toEqual({ additions: [], skipped: 1 });
  });
  it('正文格式、目录、小数进度、笔记与设置完整往返', () => {
    const backup = createBackup([entry()], { ...defaultSettings, sentenceMode: true });
    expect(parseBackup(encodeBackup(backup))).toEqual(backup);
    expect(backup.books[0]).toMatchObject({ book: { character: 3.25 }, notes: [{ start: 3.25 }] });
  });
  it('完全一致备份重复恢复幂等，重映射ID后仍识别', () => {
    const { books } = createBackup([entry()], defaultSettings);
    expect(planRestore(books, books)).toEqual({ additions: [], skipped: 1 });
    expect(planRestore([{ ...books[0], book: { ...books[0].book, id: 'new-id' } }], books).skipped).toBe(1);
    expect(planRestore([], [books[0], { ...books[0], book: { ...books[0].book, id: 'other' } }])).toMatchObject({ skipped: 1, additions: [books[0]] });
  });
  it('同ID不同正文/进度/笔记作为新副本，原数据不变', () => {
    const current = createBackup([entry()], defaultSettings).books;
    const before = JSON.stringify(current);
    for (const incoming of [
      { ...current[0], book: { ...current[0].book, character: 0 } },
      { ...current[0], notes: [] },
      { ...current[0], book: { ...current[0].book, lines: ['不同正文。'] } },
    ]) {
      const result = planRestore(current, [incoming]);
      expect(result.additions).toHaveLength(1); expect(result.additions[0].book.id).not.toBe(current[0].book.id);
      expect(result.additions[0].notes).toEqual(incoming.notes);
    }
    expect(JSON.stringify(current)).toBe(before);
  });
  it.each(['{broken', '{}', '{"__proto__":{}}', '{"format":"wrong","version":1}'])('拒绝非备份和危险结构 %s', text => {
    expect(() => parseBackup(text)).toThrow(); expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('拒绝重复ID、路径穿越、错误版本与伪造摘录', () => {
    const data = createBackup([entry()], defaultSettings);
    expect(() => validateBackup({ ...data, version: 2 })).toThrow();
    expect(() => validateBackup({ ...data, books: [data.books[0], data.books[0]] })).toThrow();
    expect(() => createBackup([{ ...entry(), book: { ...entry().book, id: '../x' } }], defaultSettings)).toThrow();
    expect(() => createBackup([{ ...entry(), notes: [{ ...entry().notes[0], kind: 'excerpt', quote: '伪造' }] }], defaultSettings)).toThrow();
  });
  it('损坏格式、越界进度、缺失笔记不可静默降级成成功备份', () => {
    const value = entry();
    expect(() => createBackup([{ ...value, book: { ...value.book, character: Infinity } }], defaultSettings)).toThrow();
    expect(() => createBackup([{ ...value, book: { ...value.book, typography: [{ start: -1, end: 2, scale: 2, bold: true }] } }], defaultSettings)).toThrow();
    expect(() => validateBackup({ ...createBackup([], defaultSettings), books: [{ book: value.book }] })).toThrow();
  });
  it('新设置缺失时保留旧备份兼容性，完成状态也可恢复', () => {
    const data = createBackup([{ ...entry(), book: { ...entry().book, completed: true } }], defaultSettings);
    expect(validateBackup({ ...data, settings: {} }).settings.sentenceMode).toBe(false);
    expect(parseBackup(encodeBackup(data)).books[0].book.completed).toBe(true);
  });
});
