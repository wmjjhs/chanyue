// 版权所有：波哥
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackup, encodeBackup, parseBackup, validateBackup, validateLocalEntries, MAX_BACKUP_BYTES } from './backup';
import { validateTypography, normalizeFormatted, MAX_STYLE_RUNS } from './typography';
import { validateBookState } from './book-state';
import { defaultSettings, makeId } from './model';
import { sampleBooks } from './samples';
import { validatePronunciationRules } from './speech-text';
import { sourceFontFamily } from './source-font';
import { validateNotes } from './reading-tools';
import { splitSentences, maskSentence, practiceSentences, sentenceStop } from './sentence-reading';
import { fixedPracticeUnits } from './practice-layout';
import { createDocument, sourcePosition, initialPosition, readingMetrics, layoutDocument } from './reading-layout';
import { monotoneCurve, curveAt, trailRange, motionFrame } from './reading-motion';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const validBackup = () => JSON.parse(JSON.stringify(createBackup([{ book: sampleBooks[0], notes: [] }], defaultSettings)));
const mutateBackup = (change: (value: any) => void) => {
  const value = validBackup();
  change(value);
  return value;
};

describe('备份校验的每一侧分支', () => {
  it('拒绝非对象、数组、非字符串与非布尔字段', () => {
    for (const value of [null, undefined, 5, 'x', [], {}]) expect(() => validateBackup(value)).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.title = 5; }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.title = 'x'.repeat(501); }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.title = '   '; }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.completed = 'yes'; }))).toThrow();
  });

  it('拒绝空数组、非法行、超长数组与超长正文', () => {
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.lines = []; }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.lines = [5]; }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.lines = new Array(2_000_001); }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.lines = ['']; }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.lines = ['字'.repeat(2_000_001)]; }))).toThrow();
  });

  it('可选字段存在、缺失与非法值分别处理', () => {
    const withOptional = mutateBackup(b => {
      b.books[0].book.offset = 0.5;
      b.books[0].book.character = 1;
      b.books[0].book.paragraphsPreserved = true;
      b.books[0].book.sample = false;
      b.books[0].book.typographyVersion = 1;
    });
    expect(validateBackup(withOptional).books[0].book.offset).toBe(0.5);
    expect(validateBackup(validBackup()).books[0].book.offset).toBeNull();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.typographyVersion = 2; }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.paragraphsPreserved = 'yes'; }))).toThrow();
    expect(() => validateBackup(mutateBackup(b => { b.books[0].book.sample = 1; }))).toThrow();
    const withoutOptional = mutateBackup(b => {
      delete b.books[0].book.paragraphsPreserved;
      delete b.books[0].book.sample;
      delete b.books[0].book.typographyVersion;
      delete b.books[0].book.character;
    });
    expect(validateBackup(withoutOptional).books[0].book.paragraphsPreserved).toBeUndefined();
    expect(validateLocalEntries([]).length).toBe(0);
  });

  it('超过 100 MB 的备份文本在解析与导出时都被拒绝', () => {
    vi.stubGlobal('TextEncoder', class {
      encode() { return { byteLength: MAX_BACKUP_BYTES + 1 }; }
    });
    expect(() => parseBackup('{}')).toThrow('100 MB');
    expect(() => encodeBackup(createBackup([], defaultSettings))).toThrow('100 MB');
    vi.unstubAllGlobals();
  });
});

describe('排版与文本工具的边界分支', () => {
  it('排版校验跳过非对象项并保留有效项', () => {
    expect(validateTypography([null, 5, 'x', {}, { start: 0, end: 2, scale: 1.5, bold: true }], 10)).toEqual([
      { start: 0, end: 2, scale: 1.5, bold: true },
    ]);
    expect(validateTypography([], 10)).toEqual([]);
  });

  it('正文超过 200 万字或样式变化过多时拒绝', () => {
    expect(() => normalizeFormatted([{ text: `字${'　'.repeat(2_000_001)}字` }])).toThrow('200 万字');
    const pieces = Array.from({ length: MAX_STYLE_RUNS + 2 }, (_, index) => ({ text: '字', size: 12 + index % 2, bold: index % 3 === 0 }));
    expect(() => normalizeFormatted(pieces)).toThrow('字体变化过多');
  });

  it('每书状态拒绝非对象、数组与空值', () => {
    for (const value of [null, undefined, 5, 'x', []]) expect(() => validateBookState(value, 10)).toThrow();
    expect(() => validateBookState({}, 10)).not.toThrow();
  });

  it('缺少 randomUUID 时回退生成书籍 ID', () => {
    expect(typeof makeId()).toBe('string');
    vi.stubGlobal('crypto', undefined);
    expect(makeId()).toMatch(/^book-/);
    vi.unstubAllGlobals();
  });

  it('读音规则覆盖 from/to 非字符串与各种无效输入', () => {
    expect(validatePronunciationRules([{ from: 1, to: 'x' }, { from: 'x', to: 2 }, null, 5])).toEqual([]);
    expect(validatePronunciationRules([{ from: '般若', to: '波惹' }])).toHaveLength(1);
  });

  it('仿宋等字体映射命中专属回退', () => {
    expect(sourceFontFamily('仿宋')).toContain('STFangsong');
    expect(sourceFontFamily('FangSong')).toContain('FangSong');
    expect(sourceFontFamily('未知字体')).toContain('serif');
  });

  it('书签位置不一致时拒绝，合法书签通过', () => {
    const note = { id: 'note-1', kind: 'bookmark', start: 0, end: 0, quote: '', note: '', createdAt: 1, updatedAt: 1 };
    expect(validateNotes([note], '正文内容')).toHaveLength(1);
    expect(() => validateNotes([{ ...note, end: 1 }], '正文内容')).toThrow('书签位置无效');
    expect(() => validateNotes([{ ...note, quote: '摘录' }], '正文内容')).toThrow('书签位置无效');
  });
});

describe('句子与练习布局的边界分支', () => {
  it('match 返回空结果时按零前导空白处理', () => {
    vi.spyOn(String.prototype, 'match').mockReturnValue(null);
    expect(() => splitSentences('你好。世界。')).not.toThrow();
    vi.restoreAllMocks();
  });

  it('缺少 Intl.Segmenter 时按码点遮字', () => {
    const fakeIntl = Object.create(Intl);
    fakeIntl.Segmenter = undefined;
    vi.stubGlobal('Intl', fakeIntl);
    expect(maskSentence('春风', 'hidden')).toBe('＿＿');
    expect(maskSentence('春风', 'full')).toBe('春风');
    vi.unstubAllGlobals();
  });

  it('练习段落超出 2000 字边界时停止收录', () => {
    const text = `${'字'.repeat(2100)}。第二句。`;
    const sentences = splitSentences(text);
    expect(practiceSentences(text, sentences, 0, 3)).toHaveLength(1);
    expect(sentenceStop(sentences, 99999, text.length)).toBe(text.length);
  });

  it('空段落被跳过，match 失效时仍可切分段落', () => {
    expect(fixedPracticeUnits('\n\n  第一段\n', 'paragraph').length).toBeGreaterThan(0);
    vi.spyOn(String.prototype, 'match').mockReturnValue(null);
    expect(fixedPracticeUnits('  第二段', 'paragraph').length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});

describe('阅读布局与动画曲线的边界分支', () => {
  it('分段器返回空片段时安全回退', () => {
    vi.spyOn(Intl.Segmenter.prototype, 'segment').mockReturnValue([] as any);
    expect(() => createDocument(['春风'])).not.toThrow();
    vi.restoreAllMocks();
  });

  it('越界位置、已完成书籍与异常缩放都能得到稳定结果', () => {
    const document = createDocument(sampleBooks[0].lines);
    const layout = layoutDocument(document, 20, 'plain');
    expect(sourcePosition(document, Number.NaN)).toBeNaN();
    expect(sourcePosition(document, -5)).toBeLessThan(0);
    expect(initialPosition({ ...sampleBooks[0], completed: true }, document)).toBe(document.words.length);
    expect(initialPosition({ ...sampleBooks[0], line: 9999, character: undefined }, document)).toBeGreaterThanOrEqual(0);
    const emptyDocument = createDocument([]);
    expect(initialPosition({ ...sampleBooks[0], completed: false, character: undefined, line: 0 }, emptyDocument)).toBe(0);
    expect(readingMetrics(360, 640, defaultSettings, Number.NaN)).toBeTruthy();
    expect(readingMetrics(360, 640, defaultSettings, Number.POSITIVE_INFINITY)).toBeTruthy();
    expect(layout.rows.length).toBeGreaterThan(0);
  });

  it('非单调割线、空曲线与空行都安全回退', () => {
    expect(monotoneCurve([0, 1, 2, 3], [0, 1, 0, 1]).slopes.every(Number.isFinite)).toBe(true);
    expect(curveAt({ times: [], values: [], slopes: [] }, 5)).toBe(0);
    const empty = { rows: [], starts: [], scroll: { times: [], values: [], slopes: [] }, total: 0 };
    expect(motionFrame(empty, 0).rowIndex).toBe(0);
    expect(trailRange({ rows: [], rowOf: new Uint32Array(0), columns: 4 }, 0, motionFrame(empty, 0))).toEqual({ x: 0, width: 0 });
  });
});
