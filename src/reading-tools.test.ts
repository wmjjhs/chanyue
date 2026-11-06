// 版权所有：波哥
import { describe, it, expect } from 'vitest';
import { changeNotes, validateContents, currentContentsIndex, validateNotes, searchBook, safeBoundary, excerptAt, excerptContextAt, noteRevision, MAX_NOTES, type ReadingNote } from './reading-tools';
import { normalizeFormatted } from './typography';
import { sampleBooks } from './samples';
import { updateImportedTypography } from './model';

const bookmark = (id = 'n-1', start = 1.25): ReadingNote => ({ id, start, end: start, kind: 'bookmark', quote: '', note: '', createdAt: 1, updatedAt: 1 });
describe('简洁阅读工具基础模型', () => {
  it('搜索为忽略英文大小写的字面量，不执行正则或HTML', () => {
    const text = 'İ TEST test A.*B <img onerror=x> 🌱重点';
    const hits = searchBook(text, 'test').hits;
    expect(hits.map(h => h.start)).toEqual([2, 7]);
    expect(hits.map(h => text.slice(h.start, h.end))).toEqual(['TEST', 'test']);
    expect(searchBook(text, '.*').hits).toHaveLength(1);
    expect(searchBook(text, '<img onerror=x>').hits[0].match).toBe('<img onerror=x>');
    expect(searchBook(text, '🌱重点').hits[0].start).toBe(text.indexOf('🌱'));
    expect(searchBook(text, '  ').hits).toEqual([]);
    expect(searchBook(text, '[').hits).toEqual([]);
  });
  it('两百万字搜索受限结果且不改变UTF16原文位置', () => {
    const text = '🌱重点'.repeat(500000);
    const result = searchBook(text, '重点');
    expect(result.more).toBe(true); expect(result.hits).toHaveLength(200);
    expect(result.hits[199].start).toBe(199 * 4 + 2);
    expect(searchBook('重复重复', '重复', 2).more).toBe(false);
  });
  it('默认摘录当前句或段落，范围不截断代理对', () => {
    const text = '上一句。\n  这一句🌱很重要！下一句。';
    const result = excerptAt(text, text.indexOf('很'));
    expect(result.quote).toBe('这一句🌱很重要！');
    expect(text.slice(result.start, result.end)).toBe(result.quote);
    const at = text.indexOf('🌱');
    expect(safeBoundary(text, at + 1)).toBe(at);
    expect(safeBoundary(text, at + 1, true)).toBe(at + 2);
    expect(excerptAt('', 0).quote).toBe('');
  });
  it('摘录窗口在开头、中间和结尾均包含完整2000字符并保持有界', () => {
    const text = '文'.repeat(10000);
    for (const start of [0, 100, 4500, 8000]) {
      const context = excerptContextAt(text, start, start + 2000);
      expect(context.start).toBeLessThanOrEqual(start);
      expect(context.end).toBeGreaterThanOrEqual(start + 2000);
      expect(context.text.length).toBeLessThanOrEqual(3200);
      expect(context.text.slice(start - context.start, start + 2000 - context.start)).toBe(text.slice(start, start + 2000));
    }
    expect(excerptContextAt('', 0, 0)).toEqual({ start: 0, end: 0, text: '' });
    expect(excerptContextAt('很短。', 0, 3).text).toBe('很短。');
  });
  it('摘录窗口不在边缘拆分Unicode代理对，当前摘录仍能精确映射', () => {
    const text = '文'.repeat(100) + '🌱'.repeat(2500);
    const context = excerptContextAt(text, 701, 702);
    expect(context.start).toBe(100);
    expect(context.end).toBe(3302);
    expect(safeBoundary(text, context.start)).toBe(context.start);
    expect(safeBoundary(text, context.end)).toBe(context.end);
    const saved = excerptContextAt(text, 700, 2700);
    expect(saved.text.slice(700 - saved.start, 2700 - saved.start)).toBe(text.slice(700, 2700));
  });
  it('规范化锚点和同名章节位置独立，过滤外来非法目录', () => {
    const formatted = normalizeFormatted([{ text: ' \n', anchor: 'h1' }, { text: '第一章\r\n' }, { text: ' \t第一章', anchor: 'h2' }]);
    expect(formatted.anchors).toEqual({ h1: 0, h2: 4 });
    const entries = validateContents([{ title: '第一章', source: 0, level: 1 }, { title: '第一章', source: 4, level: 2 }, { title: '第一章', source: 4, level: 2 }, { title: 'bad', source: 999, level: 1 }, { title: '<script>', source: 1, level: 99 }], 7);
    expect(entries).toHaveLength(3); expect(entries[2].level).toBe(9);
    expect(validateContents(undefined, 10)).toEqual([]);
  });
  it('当前章节按源位置而非目录顺序定位，同位置优先最深层级', () => {
    const contents = [{ title: '后章', source: 100, level: 1 }, { title: '第一章', source: 10, level: 1 }, { title: '小节', source: 10, level: 2 }, { title: '前言', source: 2, level: 1 }];
    expect(currentContentsIndex([], 10)).toBe(-1);
    expect(currentContentsIndex(contents, 0)).toBe(-1);
    expect(currentContentsIndex(contents, 9.5)).toBe(3);
    expect(currentContentsIndex(contents, 10)).toBe(2);
    expect(currentContentsIndex(contents, 99.99)).toBe(2);
    expect(currentContentsIndex(contents, 100)).toBe(0);
    expect(currentContentsIndex(contents, 200)).toBe(0);
  });
  it('书签保留小数阅读位置，去重并修改备注不改创建时间', () => {
    const first = bookmark();
    const notes = changeNotes([], { type: 'put', value: first }, '正文足够长');
    expect(notes[0].start).toBe(1.25);
    expect(() => changeNotes(notes, { type: 'put', value: bookmark('duplicate') }, '正文足够长')).toThrow('相同');
    const updated = changeNotes(notes, { type: 'put', expected: noteRevision(first), value: { ...first, note: '<img onerror=x>', createdAt: 20, updatedAt: 30 } }, '正文足够长');
    expect(updated[0]).toMatchObject({ note: '<img onerror=x>', createdAt: 1, updatedAt: 30 });
    expect(changeNotes(updated, { type: 'remove', id: first.id }, '正文足够长')).toEqual([]);
  });
  it('摘录必须与源范围相符，拒绝越界、超限、伪造、拆分Unicode', () => {
    const text = '甲🌱重点乙';
    const note: ReadingNote = { ...bookmark(), kind: 'excerpt', start: 1, end: 5, quote: '🌱重点' };
    expect(validateNotes([note], text)).toEqual([note]);
    for (const bad of [{ ...note, quote: '篡改' }, { ...note, start: 2 }, { ...note, end: 99 }, { ...note, note: '字'.repeat(501) }, { ...note, id: '../other' }, { ...note, start: NaN }]) expect(() => validateNotes([bad], text)).toThrow();
    expect(() => validateNotes([note, note], text)).toThrow();
    expect(() => validateNotes({ notes: [] }, text)).toThrow();
  });
  it('每书容量200条但仍可编辑删除，不接受2001字摘录', () => {
    const text = '字'.repeat(3000), notes = Array.from({ length: MAX_NOTES }, (_, i) => bookmark(`n-${i}`, i));
    expect(() => changeNotes(notes, { type: 'put', value: bookmark('full', 299) }, text)).toThrow('最多');
    expect(changeNotes(notes, { type: 'put', expected: noteRevision(notes[0]), value: { ...notes[0], note: '修改' } }, text)).toHaveLength(200);
    expect(changeNotes(notes, { type: 'remove', id: notes[0].id }, text)).toHaveLength(199);
    expect(() => validateNotes([{ ...bookmark(), kind: 'excerpt', start: 0, end: 2001, quote: text.slice(0, 2001) }], text)).toThrow();
  });
  it('过期编辑和删除不覆盖新内容，已删除记录不能被旧草稿复活', () => {
    const text = '正文足够长', first = bookmark(), expected = noteRevision(first);
    const updated = changeNotes([first], { type: 'put', expected, value: { ...first, note: '新内容', updatedAt: 2 } }, text);
    expect(() => changeNotes(updated, { type: 'put', expected, value: { ...first, note: '旧窗口' } }, text)).toThrow('其他窗口');
    expect(() => changeNotes(updated, { type: 'remove', expected, id: first.id }, text)).toThrow('其他窗口');
    expect(() => changeNotes(updated, { type: 'put', value: first }, text)).toThrow('其他窗口');
    expect(updated[0].note).toBe('新内容');
    const removed = changeNotes(updated, { type: 'remove', expected: noteRevision(updated[0]), id: first.id }, text);
    expect(removed).toEqual([]);
    expect(() => changeNotes(removed, { type: 'put', expected, value: first }, text)).toThrow('其他窗口');
    expect(() => changeNotes(removed, { type: 'remove', expected, id: first.id }, text)).toThrow('其他窗口');
  });
  it('旧书重新导入仅新增目录，保留格式进度ID及已有字段', () => {
    const old = { ...sampleBooks[0], character: 12.3, typography: [{ start: 0, end: 2, scale: 2, bold: true }] };
    const contents = [{ title: '第一章', source: 0, level: 1 }];
    const updated = updateImportedTypography(old, { ...old, typography: [], contents, id: 'new' });
    expect(updated).toEqual({ ...old, contents });
    expect(updateImportedTypography({ ...old, contents }, { ...old, contents: [] })).toBeNull();
  });
});
