// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { defaultSettings, MAX_READING_SPEED, progressOf, splitLines, validateSettings } from './model';
import { createDocument, glyphPosition, initialPosition, layoutDocument, pagination, pageTarget, readingMetrics, rowAtSource, sourcePosition } from './reading-layout';
import { buildMotion, motionFrame, trailRange } from './reading-motion';
import { decodeText, importBook } from './importer';
import { sampleBooks } from './samples';

describe('阅读行切分', () => {
  it('清除 BOM、空行和控制字符，保留标点', () => {
    expect(splitLines('\uFEFF第一行。\r\n\r\n第二行\u0000。')).toEqual(['第一行。', '第二行。']);
  });
  it('保留完整段落，不再按80字截断', () => {
    const paragraph = `${'甲'.repeat(60)}。${'乙'.repeat(60)}。`;
    expect(splitLines(paragraph)).toEqual([paragraph]);
  });
  it('长行和代理对不会丢失或被切坏', () => {
    const original = '春🌱'.repeat(300);
    expect(splitLines(original)).toEqual([original]);
  });
  it('空文件没有阅读行', () => { expect(splitLines(' \n\t\r\n')).toEqual([]); });
});

describe('阅读设置与进度', () => {
  it('不信任持久化的非法参数', () => {
    expect(validateSettings({ version: 2, font: '__proto__', fontSize: NaN, speed: 9000, pageColor: 'url(invalid)' }))
      .toEqual({ ...defaultSettings, speed: MAX_READING_SPEED });
    expect(validateSettings(null)).toEqual(defaultSettings);
  });
  it('迁移旧像素速度，但保留字号和颜色', () => {
    expect(validateSettings({ speed: 1600, fontSize: 44, pageColor: '#123456' }))
      .toEqual({ ...defaultSettings, fontSize: 44, pageColor: '#123456' });
  });
  it('字速、行数、线宽和配色有边界校验', () => {
    expect(validateSettings({ ...defaultSettings, speed: 1600 }).speed).toBe(1600);
    expect(validateSettings({ ...defaultSettings, speed: -1 }).speed).toBe(30);
    expect(validateSettings({ ...defaultSettings, fontSize: 0, maxLines: 999, cursorThickness: 9, cursorColor: 'url(x)' }))
      .toMatchObject({ fontSize: 12, maxLines: 15, cursorThickness: 6, cursorColor: defaultSettings.cursorColor });
    for (const [input, output] of [[0, 1], [1, 1], [6, 6], [7, 6], [2.6, 3], [NaN, 2], [Infinity, 2]]) {
      expect(validateSettings({ cursorThickness: input }).cursorThickness).toBe(output);
    }
    const migrated = validateSettings({ version: 2, cursorScale: 2, speed: 600, cursorWords: 50, cursorColor: '#e5b77b', cursorTransparent: true });
    expect(migrated).toMatchObject({ cursorThickness: 2, speed: 600, cursorWords: 50, cursorColor: '#e5b77b', cursorTransparent: true });
    expect(migrated).not.toHaveProperty('cursorScale');
    expect(validateSettings({ fontSize: 12, maxLines: 15 })).toMatchObject({ fontSize: 12, maxLines: 15 });
    expect(validateSettings({ cursorTransparent: true }).cursorTransparent).toBe(true);
    for (const value of ['true', 1, null, undefined]) expect(validateSettings({ cursorTransparent: value }).cursorTransparent).toBe(false);
  });
  it('默认指读模式，留痕模式可保存，旧配置和非法模式安全回退', () => {
    expect(defaultSettings.cursorMode).toBe('pointer');
    for (const cursorMode of [undefined, null, '', 'unknown', true, 1, 'pointer']) expect(validateSettings({ version: 2, cursorMode }).cursorMode).toBe('pointer');
    expect(validateSettings({ version: 2, cursorMode: 'trail', speed: 600, cursorWords: 50, cursorThickness: 6, cursorTransparent: true })).toMatchObject({ cursorMode: 'trail', speed: 600, cursorWords: 50, cursorThickness: 6, cursorTransparent: true });
  });
  it('窗口字数限制1–50，旧v2设置保留字速并默认有色1字窗口', () => {
    expect(validateSettings({ version: 2, speed: 600 })).toMatchObject({ speed: 600, cursorWords: 1, cursorTransparent: false });
    for (const [input, output] of [[0, 1], [11, 11], [50, 50], [51, 50], [4.6, 5], [NaN, 1], [Infinity, 1]]) {
      expect(validateSettings({ ...defaultSettings, cursorWords: input }).cursorWords).toBe(output);
    }
    expect(validateSettings({ layoutMode: 'plain' }).layoutMode).toBe('plain');
    expect(validateSettings({ layoutMode: 'unknown' }).layoutMode).toBe('semantic');
  });
  it('已读完标记显示 100%', () => {
    expect(progressOf(sampleBooks[0])).toBe(0);
    expect(progressOf({ ...sampleBooks[0], completed: true })).toBe(100);
  });
});

describe('多行逐字阅读', () => {
  it('紧凑模式忽略段落和空白，逐行排满', () => {
    const doc = createDocument(['第一行。', '第二行。', 'hello world']);
    const layout = layoutDocument(doc, 5, 'compact');
    expect(doc.glyphs.join('')).toBe('第一行。第二行。helloworld');
    expect(layout.rows.slice(0, -1).every(row => row.end - row.start === 5)).toBe(true);
    expect(layout.rows[0].columns).toEqual([0, 1, 2, 3, 4]);
  });
  it('语义模式保留段落、缩进和完整单词', () => {
    const doc = createDocument(['甲乙。', 'hello world']);
    const layout = layoutDocument(doc, 8, 'semantic');
    expect(layout.rows.filter(row => row.paragraph)).toHaveLength(2);
    expect(layout.rows[0].columns[0]).toBe(2);
    expect(layout.rows.map(row => doc.glyphs.slice(row.start, row.end).join(''))).toEqual(['甲乙。', 'hello', 'world']);
  });
  it('组合字和emoji不拆开，包括4096分块边界', () => {
    const doc = createDocument(['甲'.repeat(4095) + '👨‍👩‍👧‍👦e\u0301🇨🇳']);
    expect(doc.glyphs.slice(-3)).toEqual(['👨‍👩‍👧‍👦', 'e\u0301', '🇨🇳']);
  });
  it('排版变化不改变字符锚点和小数进度', () => {
    const doc = createDocument(['你好 world', '🌱新段落。']);
    const source = sourcePosition(doc, 8.375);
    for (const mode of ['semantic', 'compact', 'plain'] as const) {
      for (const width of [2, 8, 20]) {
        const layout = layoutDocument(doc, width, mode);
        expect(glyphPosition(doc, source)).toBeCloseTo(8.375);
        expect(layout.rows.at(-1)?.wordEnd).toBe(doc.words.length);
      }
    }
    expect(initialPosition({ ...sampleBooks[0], lines: ['你好 world', '🌱新段落。'], line: 1, character: undefined }, doc)).toBe(7);
  });
  it('满行时持续匀速上移，行边界连续', () => {
    const doc = createDocument(['甲乙丙丁戊己庚辛'.repeat(20)]);
    const motion = buildMotion(doc, layoutDocument(doc, 8, 'compact'), 1);
    expect(motionFrame(motion, 2).scroll - motionFrame(motion, 1).scroll).toBe(1 / 8);
    expect(motionFrame(motion, 8).scroll).toBe(1);
    expect(motionFrame(motion, 8).scroll - motionFrame(motion, 7.999).scroll).toBeCloseTo(0.001 / 8);
  });
  it('短段落只改变上移曲线，不改变纯字阅读总时长', () => {
    const doc = createDocument(['甲，。', '乙丙丁！']);
    const motion = buildMotion(doc, layoutDocument(doc, 8, 'semantic'), 1);
    expect(motion.total).toBe(4);
    expect(motionFrame(motion, 1).scroll).toBe(1);
    expect(motionFrame(motion, 1.5).scroll).toBeGreaterThan(1);
    expect(motionFrame(motion, 4).progress).toBe(1);
  });
  it('小屏大字与粗下划线仍保留两行，最大行数限制有效', () => {
    const metrics = readingMetrics(700, 180, { ...defaultSettings, fontSize: 64, cursorThickness: 6, maxLines: 12 });
    expect(metrics.visibleLines).toBe(2);
    expect(metrics.fontSize).toBeLessThan(64);
    expect(metrics.lineHeight * metrics.visibleLines).toBeLessThanOrEqual(182);
    expect(readingMetrics(900, 1000, { ...defaultSettings, maxLines: 3 }).visibleLines).toBe(3);
    const narrow = readingMetrics(272, 600, { ...defaultSettings, fontSize: 64, cursorThickness: 6 });
    expect(narrow.columns * narrow.cellWidth + 32).toBeLessThanOrEqual(272);
  });
});

describe('连续滑窗与纯文字时钟', () => {
  it('中英文标点不计字数，数字、字母和组合emoji保留', () => {
    const doc = createDocument(['“甲，乙。” (A-1)… e\u0301 👨‍👩‍👧‍👦']);
    expect(doc.words.map(index => doc.glyphs[index])).toEqual(['甲', '乙', 'A', '1', 'e\u0301', '👨‍👩‍👧‍👦']);
    expect(doc.wordOrdinal.filter(index => index >= 0)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('密排只隐藏标点和空白，不修改原文或源字符偏移', () => {
    const lines = ['甲，乙。', '“A B”！'];
    const doc = createDocument(lines);
    const layout = layoutDocument(doc, 3, 'plain');
    expect(layout.rows.map(row => row.glyphs.map(index => doc.glyphs[index]).join(''))).toEqual(['甲乙A', 'B']);
    expect(layout.rows[0].columns).toEqual([0, 1, 2]);
    expect(layout.rows.flatMap(row => row.glyphs.map(index => doc.offsets[index]))).toEqual([0, 2, 6, 8]);
    expect(lines).toEqual(['甲，乙。', '“A B”！']);
    expect(doc.glyphs.join('')).toBe('甲，乙。“AB”！');
  });
  it('标点前后的小数进度可往返，旧行锚点与完成状态兼容', () => {
    const doc = createDocument(['“甲，。乙！”', '丙丁。']);
    for (const position of [0, 0.125, 0.99, 1.25, 2, 3.9, 4]) {
      expect(glyphPosition(doc, sourcePosition(doc, position))).toBeCloseTo(position, 5);
    }
    expect(initialPosition({ ...sampleBooks[0], character: undefined, line: 1 }, doc)).toBe(2);
    expect(initialPosition({ ...sampleBooks[0], completed: true }, doc)).toBe(4);
  });
  it('1–50字窗口的纯文字宽度正确，沿行连续移动而非逐格跳动', () => {
    const doc = createDocument(['甲乙丙丁戊己庚辛壬癸'.repeat(6)]);
    const layout = layoutDocument(doc, 60, 'compact');
    for (let span = 1; span <= 50; span++) {
      const motion = buildMotion(doc, layout, span);
      for (const clock of [0, 0.25, 2.5, 10.125, 18.5, 19.9, 20]) {
        expect(motionFrame(motion, clock).width).toBeCloseTo(span);
      }
      const before = motionFrame(motion, 2.25);
      const after = motionFrame(motion, 2.251);
      expect(after.x).toBeGreaterThan(before.x);
      expect(after.x - before.x).toBeLessThan(0.01);
      expect(motion.total).toBe(60);
    }
  });
  it('窗口覆盖文字时跨过中间标点，短行不足时覆盖全行', () => {
    const doc = createDocument(['甲，乙，丙，丁，戊。']);
    const layout = layoutDocument(doc, 20, 'compact');
    const motion = buildMotion(doc, layout, 3);
    expect(motionFrame(motion, 0)).toMatchObject({ x: 0, width: 5, span: 3 });
    expect(motionFrame(motion, motion.total)).toMatchObject({ x: 4, width: 6 });
    expect(motionFrame(buildMotion(doc, layout, 50), 0)).toMatchObject({ x: 0, width: 10, span: 5 });
    expect(motion.total).toBe(5);
  });
  it('长短行和密集标点下，上移保持单调且边界速度连续', () => {
    const doc = createDocument(['甲，。', '乙丙丁戊己庚辛壬癸', '！！！！！', '子', '丑寅卯辰巳午未申酉戌亥']);
    const motion = buildMotion(doc, layoutDocument(doc, 8, 'semantic'), 5);
    let previous = -1;
    for (let clock = 0; clock <= motion.total; clock += 0.02) {
      const frame = motionFrame(motion, clock);
      expect(frame.scroll).toBeGreaterThanOrEqual(previous);
      expect(frame.width).toBeGreaterThan(0);
      previous = frame.scroll;
    }
    const epsilon = 0.00001;
    for (const time of motion.starts.slice(1)) {
      const before = motionFrame(motion, time - epsilon).scroll;
      const at = motionFrame(motion, time).scroll;
      const after = motionFrame(motion, time + epsilon).scroll;
      expect((at - before) / epsilon).toBeCloseTo((after - at) / epsilon, 3);
    }
  });
  it('换行直接进入下一行字下，无飞行阶段，正文上移速度仍连续', () => {
    const doc = createDocument(['甲乙丙丁戊己庚辛壬癸，。', '！！！', '子丑寅卯辰巳午未申酉戌亥']);
    for (const span of [1, 5, 10, 50]) {
      const motion = buildMotion(doc, layoutDocument(doc, 8, 'semantic'), span);
      const epsilon = 0.00001;
      for (let i = 0; i < motion.rows.length - 1; i++) {
        const row = motion.rows[i];
        const next = motion.rows[i + 1];
        const before = motionFrame(motion, row.end - epsilon);
        const at = motionFrame(motion, row.end);
        const after = motionFrame(motion, row.end + epsilon);
        expect(before.y).toBe(row.rowIndex);
        expect(before.x).toBeCloseTo(row.left.values.at(-1)!, 3);
        expect(at).toMatchObject({ y: next.rowIndex, rowIndex: next.rowIndex, x: next.left.values[0], inkX: next.ink.values[0] });
        expect(after.y).toBe(next.rowIndex);
        expect((at.scroll - before.scroll) / epsilon).toBeCloseTo((after.scroll - at.scroll) / epsilon, 2);
      }
      for (let clock = 0; clock <= motion.total; clock += 0.05) {
        const frame = motionFrame(motion, clock);
        expect(frame.y).toBe(frame.rowIndex);
        expect(Number.isInteger(frame.y)).toBe(true);
      }
    }
  });
  it('等宽纯文字行指读与笔尖都持续匀速前行', () => {
    const doc = createDocument(['甲乙丙丁戊己庚辛壬癸'.repeat(4)]);
    const motion = buildMotion(doc, layoutDocument(doc, 20, 'plain'), 5);
    for (const clock of [0, 2, 10, 18]) {
      const before = motionFrame(motion, clock);
      const after = motionFrame(motion, clock + 0.5);
      expect(after.x - before.x).toBeCloseTo(15 / 20 * 0.5);
      expect(after.inkX - before.inkX).toBeCloseTo(0.5);
    }
  });
  it('留痕从零逐渐增长，完成行保留，未读行无痕，回退和重读按当前进度重建', () => {
    const doc = createDocument(['甲乙丙丁'.repeat(4)]);
    const layout = layoutDocument(doc, 4, 'plain');
    const motion = buildMotion(doc, layout, 1);
    const ranges = (time: number) => layout.rows.map((_, i) => trailRange(layout, i, motionFrame(motion, time)).width);
    expect(ranges(0)).toEqual([0, 0, 0, 0]);
    expect(ranges(1.5)).toEqual([1.5, 0, 0, 0]);
    expect(ranges(4)).toEqual([4, 0, 0, 0]);
    expect(ranges(6.5)).toEqual([4, 2.5, 0, 0]);
    expect(ranges(16)).toEqual([4, 4, 4, 4]);
    expect(ranges(2)).toEqual([2, 0, 0, 0]);
    expect(ranges(0)).toEqual([0, 0, 0, 0]);
    for (const span of [1, 5, 50]) expect(trailRange(layout, 1, motionFrame(buildMotion(doc, layout, span), 6.5)).width).toBe(2.5);
  });
  it('留痕按源进度重排，跨标点和缩进但不连接行间空白', () => {
    const doc = createDocument(['甲，乙！', '丙，丁。', '！？？']);
    const source = sourcePosition(doc, 2.5);
    for (const mode of ['semantic', 'compact', 'plain'] as const) {
      for (const columns of [3, 12]) {
        const layout = layoutDocument(doc, columns, mode);
        const motion = buildMotion(doc, layout, 1);
        const frame = motionFrame(motion, glyphPosition(doc, source));
        let previous = 0;
        for (let clock = 0; clock <= motion.total; clock += 0.1) {
          const sum = layout.rows.reduce((value, _, i) => value + trailRange(layout, i, motionFrame(motion, clock)).width, 0);
          expect(sum).toBeGreaterThanOrEqual(previous - 1e-8);
          previous = sum;
        }
        layout.rows.forEach((row, i) => {
          const range = trailRange(layout, i, frame);
          expect(range.x).toBe(row.columns[0]);
          expect(range.width).toBeGreaterThanOrEqual(0);
          expect(range.x + range.width).toBeLessThanOrEqual(row.columns.at(-1)! + 1);
          if (i > frame.rowIndex) expect(range.width).toBe(0);
        });
      }
    }
  });
  it('各字号的1–6px下划线均在字形下面、行内，粗细不改变排版', () => {
    for (const fontSize of [12, 18, 28, 44, 64]) {
      const base = readingMetrics(390, 600, { ...defaultSettings, fontSize });
      for (let cursorThickness = 1; cursorThickness <= 6; cursorThickness++) {
        const metrics = readingMetrics(390, 600, { ...defaultSettings, fontSize, cursorThickness });
        expect(metrics).toEqual(base);
        expect(metrics.underlineOffset).toBeGreaterThan((metrics.lineHeight + metrics.fontSize) / 2);
        expect(metrics.underlineOffset + cursorThickness).toBeLessThan(metrics.lineHeight);
        expect(metrics.cellWidth).toBe(Math.ceil(metrics.fontSize * 1.12));
      }
    }
  });
  it('三种排版和窗口宽度不影响总字数，纯标点及空正文安全', () => {
    for (const text of ['甲，乙。丙！', '，。！？……', '']) {
      const doc = createDocument([text]);
      for (const mode of ['semantic', 'compact', 'plain'] as const) {
        for (const span of [1, 5, 10]) {
          const motion = buildMotion(doc, layoutDocument(doc, 3, mode), span);
          expect(motion.total).toBe(text.startsWith('甲') ? 3 : 0);
          const frame = motionFrame(motion, motion.total);
          expect(Object.values(frame).every(value => typeof value !== 'number' || Number.isFinite(value))).toBe(true);
          if (!doc.words.length) expect(frame.span).toBe(0);
        }
      }
    }
  });
});

describe('按实际行数分页', () => {
  it('不足一页、整页、末页及页首边界统计正确', () => {
    expect(pagination(0, 15, 0)).toEqual({ size: 15, total: 0, current: 0 });
    expect(pagination(1, 15, 0)).toEqual({ size: 15, total: 1, current: 1 });
    expect(pagination(30, 15, 14)).toEqual({ size: 15, total: 2, current: 1 });
    expect(pagination(30, 15, 15)).toEqual({ size: 15, total: 2, current: 2 });
    expect(pagination(31, 15, 31)).toEqual({ size: 15, total: 3, current: 3 });
  });
  it('跳转落在目标页首并拒绝空、越界、小数及非有限页码', () => {
    const doc = createDocument(['甲乙丙丁戊己庚辛壬癸'.repeat(4)]);
    const layout = layoutDocument(doc, 2, 'plain');
    expect(pageTarget(layout, 6, 1)).toEqual({ rowIndex: 0, position: 0 });
    expect(pageTarget(layout, 6, 3)).toEqual({ rowIndex: 12, position: 24 });
    expect(pageTarget(layout, 6, 4)).toEqual({ rowIndex: 18, position: 36 });
    for (const page of [0, -1, 1.5, 5, NaN, Infinity]) expect(pageTarget(layout, 6, page)).toBeNull();
    expect(pageTarget(layoutDocument(createDocument([]), 10, 'plain'), 6, 1)).toBeNull();
  });
  it('12px可显示15行，空间受限时按实际可见行数分页', () => {
    const settings = { ...defaultSettings, fontSize: 12, maxLines: 15, cursorThickness: 1 };
    const tall = readingMetrics(390, 700, settings);
    expect(tall.fontSize).toBe(12);
    expect(tall.visibleLines).toBe(15);
    const short = readingMetrics(700, 100, settings);
    expect(short.visibleLines).toBeLessThan(15);
    expect(pagination(40, short.visibleLines, 0).total).toBe(Math.ceil(40 / short.visibleLines));
  });
  it('三种排版和方向重新分页，不修改保存的源字符位置', () => {
    const doc = createDocument(['第一段，读书。'.repeat(8), '第二段，慢慢读。'.repeat(8)]);
    const source = sourcePosition(doc, 30.25);
    const totals = new Set<number>();
    for (const mode of ['semantic', 'compact', 'plain'] as const) {
      for (const width of [4, 12]) {
        const layout = layoutDocument(doc, width, mode);
        const row = rowAtSource(doc, layout, source);
        totals.add(pagination(layout.rows.length, 3, row).total);
        expect(glyphPosition(doc, source)).toBeCloseTo(30.25);
        const target = pageTarget(layout, 3, pagination(layout.rows.length, 3, row).current)!;
        expect(target.rowIndex).toBeLessThanOrEqual(row);
        expect(row - target.rowIndex).toBeLessThan(3);
      }
    }
    expect(totals.size).toBeGreaterThan(1);
  });
  it('仅标点的页面仍计入页数，尾部标点可定位而不增加计时字数', () => {
    const doc = createDocument(['甲乙', '！！', '？？', '。。', '丙丁', '……']);
    const layout = layoutDocument(doc, 2, 'semantic');
    expect(pagination(layout.rows.length, 2, 0).total).toBe(3);
    const target = pageTarget(layout, 2, 2)!;
    expect(target).toEqual({ rowIndex: 2, position: 2 });
    expect(rowAtSource(doc, layout, doc.offsets[layout.rows[2].start])).toBe(2);
    expect(rowAtSource(doc, layout, doc.length)).toBe(5);
    expect(buildMotion(doc, layout, 50).total).toBe(4);
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
