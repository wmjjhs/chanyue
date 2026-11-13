// 版权所有：波哥
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from './model';
import { createDocument, layoutDocument, readingMetrics } from './reading-layout';
import { buildMotion, motionFrame } from './reading-motion';
import { ReadingRenderer } from './reading-renderer';

function setup(lines: string[], overrides: Partial<Settings> = {}) {
  const documentModel = createDocument(lines);
  const settings = { ...defaultSettings, ...overrides };
  const metrics = readingMetrics(320, 320, settings, documentModel.maxScale);
  const layout = layoutDocument(documentModel, metrics.columns, settings.layoutMode);
  const motion = buildMotion(documentModel, layout, settings.cursorWords);
  const container = document.createElement('div');
  const cursor = document.createElement('div');
  document.body.append(container, cursor);
  const renderer = new ReadingRenderer(container, cursor, documentModel, layout, metrics, settings);
  return { documentModel, settings, metrics, layout, motion, container, cursor, renderer };
}

describe('阅读渲染器', () => {
  it('指针模式渲染行、定位光标并复用回收节点', () => {
    const { motion, container, cursor, renderer, layout } = setup(Array.from({ length: 12 }, (_, i) => `第${i}行文字内容，用来铺满多行。`));
    renderer.paint(motionFrame(motion, 0));
    expect(container.querySelectorAll('.reading-row').length).toBeGreaterThan(0);
    expect(cursor.dataset.phase).toBe('scan');

    const middle = layout.rows.length * 0.4;
    renderer.paint(motionFrame(motion, middle));
    expect(container.querySelectorAll('.reading-row.is-current').length).toBeLessThanOrEqual(0);
    expect(container.querySelector('.reading-glyph')?.getAttribute('data-char')).toBe('0');

    renderer.paint(motionFrame(motion, layout.rows.length * 0.8));
    renderer.paint(motionFrame(motion, 0));
    expect(container.querySelectorAll('.reading-row').length).toBeGreaterThan(0);
    renderer.dispose();
    expect(container.children.length).toBe(0);
  });

  it('留痕模式带音频时长时计算淡出与下划线', () => {
    const { motion, container, cursor, renderer } = setup(['春风又绿江南岸，明月何时照我还。', '第二行继续文字内容。'], {
      cursorMode: 'trail', trailFade: true,
    });
    renderer.paint(motionFrame(motion, 0), 0.25);
    const trail = container.querySelector('.reading-trail') as HTMLElement;
    expect(trail.style.height).toBeTruthy();
    expect(cursor.hidden).toBe(true);
    renderer.paint(motionFrame(motion, 3), 0.25);
    expect(container.querySelectorAll('.reading-trail').length).toBeGreaterThan(0);
    renderer.dispose();
  });

  it('只有标点的文档不显示光标与留痕', () => {
    const { motion, container, cursor, renderer } = setup(['。，！？'], { cursorMode: 'trail' });
    renderer.paint(motionFrame(motion, 0));
    expect(cursor.hidden).toBe(true);
    expect(container.querySelector('.reading-trail')?.hasAttribute('hidden')).toBe(true);
    renderer.dispose();
  });

  it('指针模式下光标跟随当前字移动', () => {
    const { motion, container, cursor, renderer, layout } = setup(['甲乙丙丁戊己庚辛壬癸，子丑寅卯辰巳午未。']);
    renderer.paint(motionFrame(motion, 0));
    const first = cursor.style.transform;
    renderer.paint(motionFrame(motion, layout.rows.length * 0.6));
    expect(cursor.style.transform).not.toBe(first);
    expect(container.querySelector('.reading-glyph.is-current')).not.toBeNull();
    renderer.dispose();
  });

  it('带粗体与源字体的正文同时渲染指针与留痕', () => {
    const lines = ['春风又绿江南岸，明月何时照我还。'];
    const documentModel = createDocument(lines, [{ start: 0, end: 4, scale: 1.5, bold: true, font: 'KaiTi' }]);
    const settings = { ...defaultSettings };
    const metrics = readingMetrics(320, 320, settings, documentModel.maxScale);
    const layout = layoutDocument(documentModel, metrics.columns, settings.layoutMode);
    const motion = buildMotion(documentModel, layout, settings.cursorWords);
    const container = document.createElement('div'), cursor = document.createElement('div');
    document.body.append(container, cursor);
    const renderer = new ReadingRenderer(container, cursor, documentModel, layout, metrics, settings);
    renderer.paint(motionFrame(motion, 0));
    const glyphs = [...container.querySelectorAll('.reading-glyph')] as HTMLElement[];
    expect(glyphs.some(element => element.style.fontWeight === '700')).toBe(true);
    expect(glyphs.some(element => element.style.fontFamily.includes('KaiTi'))).toBe(true);
    renderer.dispose();
    const trailContainer = document.createElement('div'), trailCursor = document.createElement('div');
    document.body.append(trailContainer, trailCursor);
    const trail = new ReadingRenderer(trailContainer, trailCursor, documentModel, layout, metrics, { ...settings, cursorMode: 'trail' });
    trail.paint(motionFrame(motion, 0), 0.25);
    expect(trailContainer.querySelectorAll('.reading-glyph').length).toBeGreaterThan(0);
    trail.dispose();
  });
});
