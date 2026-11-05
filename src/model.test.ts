// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { defaultSettings, MAX_READING_SPEED, progressOf, splitLines, validateSettings } from './model';
import { createDocument, glyphPosition, initialPosition, layoutDocument, readingMetrics, sourcePosition } from './reading-layout';
import { buildMotion, focusWeight, motionFrame } from './reading-motion';
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
  it('字速、行数、倍率和配色有边界校验', () => {
    expect(validateSettings({ ...defaultSettings, speed: 1600 }).speed).toBe(1600);
    expect(validateSettings({ ...defaultSettings, speed: -1 }).speed).toBe(30);
    expect(validateSettings({ ...defaultSettings, maxLines: 999, cursorScale: 9, cursorColor: 'url(x)' }))
      .toMatchObject({ maxLines: 12, cursorScale: 2, cursorColor: defaultSettings.cursorColor });
  });
  it('窗口字数限制1–10，旧v2设置保留字速并默认1字窗口', () => {
    expect(validateSettings({ version: 2, speed: 600 })).toMatchObject({ speed: 600, cursorWords: 1 });
    for (const [input, output] of [[0, 1], [11, 10], [4.6, 5], [NaN, 1], [Infinity, 1]]) {
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
  it('小屏大字与放大仍保留两行，最大行数限制有效', () => {
    const metrics = readingMetrics(700, 180, { ...defaultSettings, fontSize: 64, cursorScale: 2, maxLines: 12 });
    expect(metrics.visibleLines).toBe(2);
    expect(metrics.fontSize).toBeLessThan(64);
    expect(metrics.lineHeight * metrics.visibleLines).toBeLessThanOrEqual(182);
    expect(readingMetrics(900, 1000, { ...defaultSettings, maxLines: 3 }).visibleLines).toBe(3);
    const narrow = readingMetrics(272, 600, { ...defaultSettings, fontSize: 64, cursorScale: 2 });
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
  it('1–10字窗口的纯文字宽度正确，沿行连续移动而非逐格跳动', () => {
    const doc = createDocument(['甲乙丙丁戊己庚辛壬癸'.repeat(6)]);
    const layout = layoutDocument(doc, 20, 'compact');
    for (let span = 1; span <= 10; span++) {
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
    expect(motionFrame(buildMotion(doc, layout, 10), 0)).toMatchObject({ x: 0, width: 10, span: 5 });
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
  it('扫读、弧线返回和下行起点位置及速度连续', () => {
    const doc = createDocument(['甲乙丙丁戊己庚辛壬癸，。', '子丑寅卯辰巳午未申酉戌亥']);
    for (const span of [1, 5, 10]) {
      const motion = buildMotion(doc, layoutDocument(doc, 8, 'semantic'), span);
      const epsilon = 0.00001;
      for (const row of motion.rows.slice(0, -1)) {
        for (const time of [row.scanEnd, row.end]) {
          const before = motionFrame(motion, time - epsilon);
          const at = motionFrame(motion, time);
          const after = motionFrame(motion, time + epsilon);
          for (const key of ['x', 'y', 'width', 'scroll'] as const) {
            expect(Math.abs(at[key] - before[key])).toBeLessThan(0.0001);
            expect(Math.abs(after[key] - at[key])).toBeLessThan(0.0001);
            expect((at[key] - before[key]) / epsilon).toBeCloseTo((after[key] - at[key]) / epsilon, 2);
          }
        }
      }
      const row = motion.rows[0];
      const middle = motionFrame(motion, (row.scanEnd + row.end) / 2);
      expect(middle.turning).toBe(true);
      expect(middle.y).toBeGreaterThan((row.rowIndex + motion.rows[1].rowIndex) / 2);
    }
  });
  it('中心渐进放大，两侧对称衰减，换行前后无缩放跳变', () => {
    const doc = createDocument(['甲乙丙丁戊己庚辛'.repeat(4)]);
    const motion = buildMotion(doc, layoutDocument(doc, 8, 'compact'), 5);
    const frame = motionFrame(motion, 0);
    expect(focusWeight(2, 0, frame)).toBe(1);
    expect(focusWeight(1, 0, frame)).toBeGreaterThan(focusWeight(0, 0, frame));
    expect(focusWeight(1, 0, frame)).toBe(focusWeight(3, 0, frame));
    expect(focusWeight(7, 0, frame)).toBe(0);
    for (const time of [motion.rows[0].scanEnd, motion.rows[0].end]) {
      for (let row = 0; row <= 1; row++) {
        for (let column = 0; column < 8; column++) {
          expect(focusWeight(column, row, motionFrame(motion, time - 0.00001)))
            .toBeCloseTo(focusWeight(column, row, motionFrame(motion, time + 0.00001)), 4);
        }
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
