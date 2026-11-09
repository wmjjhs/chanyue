// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { defaultSettings, splitLines, updateImportedTypography } from './model';
import { createDocument, glyphPosition, layoutDocument, readingMetrics, sourcePosition } from './reading-layout';
import { buildMotion, motionFrame, trailRange } from './reading-motion';
import { MAX_STYLE_RUNS, normalizeFormatted, validateTypography, type TextPiece } from './typography';
import { sampleBooks } from './samples';
import { sourceFontFamily, validateSourceFont } from './source-font';

describe('来源字体范围', () => {
  it('原字体区别跨清洗、字号归一化与UTF16字素映射保留', () => {
    const result = normalizeFormatted([{ text: '  宋体  ', font: 'SimSun' }, { text: '楷体🌱', font: 'KaiTi', bold: true }, { text: '\n普通', font: 'Microsoft YaHei' }]);
    const doc = createDocument(result.lines, result.typography);
    expect(doc.fonts).toEqual(['SimSun', 'SimSun', 'KaiTi', 'KaiTi', 'KaiTi', 'Microsoft YaHei', 'Microsoft YaHei']);
    expect(doc.bold).toEqual([false, false, true, true, true, false, false]);
    expect(doc.offsets).toEqual(createDocument(result.lines).offsets);
    expect(validateTypography(result.typography, result.lines.join('\n').length)).toEqual(result.typography);
  });
  it('字体范围不可误合并，字体名不可注入CSS或URL', () => {
    expect(validateTypography([{ start: 0, end: 1, scale: 1, bold: false, font: 'SimSun' }, { start: 1, end: 2, scale: 1, bold: false, font: 'KaiTi' }], 2)).toHaveLength(2);
    for (const font of ['bad; background:url(https://evil.invalid)', 'url(https://evil.invalid)', 'x\"; color:red', '<script>', 'a'.repeat(101), 'bad\nfont']) {
      expect(validateSourceFont(font)).toBeUndefined();
      expect(sourceFontFamily(font)).toBeUndefined();
    }
    expect(validateSourceFont('@宋体')).toBe('宋体');
    expect(sourceFontFamily('楷体')).toContain('Kaiti SC');
    expect(sourceFontFamily('宋体')).toContain('Songti SC');
    expect(sourceFontFamily('微软雅黑')).toContain('PingFang SC');
    expect(createDocument(['旧书']).fonts).toEqual([undefined, undefined]);
  });
  it('同正文Word可补字体及清除旧粗体，保持听书背诵进度，TXT不能清除', () => {
    const old = { ...sampleBooks[0], character: 12.75, listening: { source: 8, completed: false, rate: 1.5 }, practice: { source: 0, span: 2, mask: 'cue' as const, unit: 'paragraph' as const } };
    const typography = [{ start: 0, end: 4, scale: 1, bold: true, font: 'KaiTi' }];
    const incoming = { ...old, format: 'WORD' as const, typography };
    const updated = updateImportedTypography(old, incoming)!;
    expect(updated).toEqual({ ...old, typography, typographyVersion: 1 });
    expect(updateImportedTypography(updated, { ...incoming, typography: [] })).toEqual({ ...old, typography: [], typographyVersion: 1 });
    expect(updateImportedTypography(updated, { ...incoming, format: 'TXT', typography: [] })).toBeNull();
  });
  it('样式跨片段空白清洗与旧纯文本规范完全一致', () => {
    for (const text of ['\uFEFF  甲\r\n\r\n乙\u0000\t  丙  ', '甲\r乙\n\n 丁\u00a0\t戊', ' \n\t', '甲\u2003  \u2003乙\n\uFEFF丙', 'e\u0301🌱👨‍👩‍👧‍👦\r\n阿']) {
      const pieces = Array.from(text).map(value => ({ text: value, size: 12 }));
      expect(normalizeFormatted(pieces).lines).toEqual(splitLines(text));
      expect(normalizeFormatted(pieces).typography).toEqual([]);
    }
  });
  it('清洗前后重点字号按正确UTF16源锚点映射', () => {
    const pieces: TextPiece[] = [{ text: '\uFEFF标题\r\n', size: 24, bold: true }, { text: '正文普通的文字足够多  ', size: 12 }, { text: '重点🌱', size: 18, bold: true }, { text: '\t结尾' }];
    const { lines, typography } = normalizeFormatted(pieces);
    expect(lines).toEqual(['标题', '正文普通的文字足够多 重点🌱 结尾']);
    const doc = createDocument(lines, typography);
    const main = doc.glyphs.indexOf('重');
    expect(doc.scales.slice(main, main + 3)).toEqual([1.5, 1.5, 1.5]);
    expect(doc.bold.slice(main, main + 3)).toEqual([true, true, true]);
    expect(doc.scales[0]).toBe(2);
    expect(doc.offsets[main]).toBe(lines.join('\n').indexOf('重点'));
    expect(doc.wordOffsets).toEqual(createDocument(lines).wordOffsets);
  });
  it('大小有边界，非法字段、越界、重叠与巨大数组不会进入渲染', () => {
    expect(validateTypography([{ start: 0, end: 2, scale: 99, bold: true, html: '<script>' }, { start: 1, end: 3, scale: 1, bold: true }, { start: 2, end: 4, scale: 0.1, bold: false }, { start: 4, end: 6, scale: NaN, bold: true }, { start: 4, end: 99, scale: 1, bold: true }], 6)).toEqual([{ start: 0, end: 2, scale: 2, bold: true }, { start: 2, end: 4, scale: 0.7, bold: false }]);
    expect(validateTypography(new Array(MAX_STYLE_RUNS + 1), 10)).toEqual([]);
    expect(validateTypography([{ start: 0, end: 1, scale: '2', bold: 'true' }], 10)).toEqual([]);
  });
  it('全粗体多段正文的基准字号不被普通换行改变', () => {
    const result = normalizeFormatted([{ text: '全粗体正文\n第二段全粗体正文', size: 18, bold: true }]);
    const doc = createDocument(result.lines, result.typography);
    expect(doc.scales.every(scale => scale === 1)).toBe(true);
    expect(doc.bold.every(Boolean)).toBe(true);
  });
  it('合并相邻同样式，旧书默认字体不变化', () => {
    expect(validateTypography([{ start: 0, end: 1, scale: 1, bold: true }, { start: 1, end: 4, scale: 1, bold: true }], 4)).toEqual([{ start: 0, end: 4, scale: 1, bold: true }]);
    expect(createDocument(['旧书']).scales).toEqual([1, 1]);
    expect(createDocument(['旧书']).bold).toEqual([false, false]);
  });
  it.each(['semantic', 'compact', 'plain'] as const)('大小加粗在%s排版不重叠越界、时钟及源锚点不变', mode => {
    const lines = ['大标题，甲乙丙丁戊己庚辛。hello WORLD 标注🌱新段落', '另一个段落。'];
    const doc = createDocument(lines, [{ start: 0, end: 3, scale: 2, bold: true }, { start: 7, end: 10, scale: 0.75, bold: false }, { start: 18, end: 27, scale: 1.5, bold: true }]);
    for (const width of [2, 3, 6, 10, 30]) {
      const layout = layoutDocument(doc, width, mode), motion = buildMotion(doc, layout, 3);
      expect(motion.total).toBe(createDocument(lines).words.length);
      for (const row of layout.rows) for (let i = 0; i < row.columns.length; i++) {
        expect(row.columns[i]).toBeGreaterThanOrEqual(i ? row.columns[i - 1] + row.widths[i - 1] - 1e-6 : 0);
        expect(row.columns[i] + row.widths[i]).toBeLessThanOrEqual(width + 1e-6);
      }
      for (let clock = 0; clock <= motion.total; clock += 0.125) {
        const frame = motionFrame(motion, clock), row = layout.rows[frame.rowIndex];
        const end = row.columns.at(-1)! + row.widths.at(-1)!;
        expect(frame.x + frame.width).toBeLessThanOrEqual(end + 1e-6);
        expect(frame.width).toBeGreaterThan(0);
        const trail = trailRange(layout, frame.rowIndex, frame);
        expect(trail.x + trail.width).toBeLessThanOrEqual(end + 1e-6);
        expect(glyphPosition(doc, sourcePosition(doc, clock))).toBeCloseTo(clock, 5);
      }
    }
  });
  it('大标题行高与粗下划线不相交，屏幕变化不改设置', () => {
    const settings = { ...defaultSettings, fontSize: 30, maxLines: 30, cursorRow: 18, cursorThickness: 6 };
    for (const [width, height] of [[390, 550], [844, 180], [320, 180]]) {
      const m = readingMetrics(width, height, settings, 2);
      expect(m.maxFontSize).toBe(m.fontSize * 2);
      expect(m.underlineOffset).toBeGreaterThan((m.lineHeight + m.maxFontSize) / 2);
      expect(m.underlineOffset + 6).toBeLessThanOrEqual(m.lineHeight);
      expect(m.cursorRow).toBe(Math.min(18, m.visibleLines));
    }
    expect(settings.fontSize).toBe(30);
  });
  it('重新导入只更新样式，不重置ID、重命名、完成状态或小数进度', () => {
    const old = { ...sampleBooks[0], title: '重命名', character: 12.75, completed: true };
    const typography = [{ start: 0, end: 2, scale: 1.5, bold: true }];
    const incoming = { ...old, id: 'new-import', title: '原文件名', character: 0, typography };
    expect(updateImportedTypography(old, incoming)).toEqual({ ...old, typography, typographyVersion: 1 });
    expect(updateImportedTypography({ ...old, typography }, incoming)).toBeNull();
    expect(updateImportedTypography({ ...old, typography }, { ...incoming, typography: [] })).toBeNull();
    expect(updateImportedTypography(old, { ...incoming, lines: ['不同正文'] })).toBeNull();
  });
});
