// 版权所有：波哥
import type { Settings } from './model';
import { type ReadingDocument, type ReadingLayout, type readingMetrics } from './reading-layout';
import { trailRange, type motionFrame } from './reading-motion';
import { trailOpacity } from './trail-fade';
import { sourceFontFamily } from './source-font';

type Cell = { element: HTMLSpanElement; glyph: number; column: number };
type RowView = { element: HTMLDivElement; cells: Cell[]; trail: HTMLElement };
type Metrics = ReturnType<typeof readingMetrics>;

export class ReadingRenderer {
  private rows = new Map<number, RowView>();
  private current: HTMLElement | null = null;

  constructor(
    private container: HTMLDivElement, private cursor: HTMLDivElement,
    private document: ReadingDocument, private layout: ReadingLayout,
    private metrics: Metrics, private settings: Settings,
  ) {
    this.cursor.style.height = `${settings.cursorThickness}px`;
  }

  private populate(rowIndex: number, recycled?: RowView): RowView {
    const row = this.layout.rows[rowIndex];
    const element = recycled?.element ?? document.createElement('div');
    element.className = `reading-row${row.paragraph ? ' paragraph-start' : ''}`;
    element.dataset.row = String(rowIndex);
    element.style.height = `${this.metrics.lineHeight}px`;
    const cells = row.glyphs.map((glyph, index) => {
      const span = document.createElement('span');
      const inner = document.createElement('span');
      span.className = 'reading-glyph';
      span.dataset.char = String(glyph);
      span.dataset.source = String(this.document.offsets[glyph]);
      span.dataset.word = String(this.document.wordOrdinal[glyph]);
      span.style.left = `${row.columns[index] * this.metrics.cellWidth}px`;
      span.style.width = `${row.widths[index] * this.metrics.cellWidth}px`;
      span.style.fontSize = `${this.metrics.fontSize * this.document.scales[glyph]}px`;
      span.style.fontWeight = this.document.bold[glyph] ? '700' : '400';
      const family = sourceFontFamily(this.document.fonts[glyph]);
      if (family) span.style.fontFamily = family;
      inner.style.fontWeight = span.style.fontWeight;
      span.style.alignItems = 'flex-end';
      span.style.paddingBottom = `${(this.metrics.lineHeight - this.metrics.maxFontSize) / 2}px`;
      inner.textContent = this.document.glyphs[glyph];
      span.append(inner);
      return { element: span, glyph, column: row.columns[index] };
    });
    const trail = recycled?.trail ?? document.createElement('i');
    trail.className = 'reading-trail';
    trail.setAttribute('aria-hidden', 'true');
    trail.style.top = `${this.metrics.underlineOffset}px`;
    trail.style.height = `${this.settings.cursorThickness}px`;
    trail.style.width = '0px';
    trail.hidden = true;
    element.textContent = '';
    element.append(...cells.map(cell => cell.element), trail);
    return { element, cells, trail };
  }

  /** secondsPerWord 由听书实际语速传入；阅读模式沿用阅读速度，样式与留痕完全一致。 */
  paint(frame: ReturnType<typeof motionFrame>, secondsPerWord?: number) {
    const { metrics: m } = this;
    const elapsed = (words: number) => secondsPerWord === undefined ? words * 60 / this.settings.speed : words * secondsPerWord;
    const anchor = m.cursorRow - 1;
    const first = Math.max(0, Math.floor(frame.scroll - anchor) - 1);
    const last = Math.min(this.layout.rows.length, first + m.visibleLines + 5);
    const reusable: RowView[] = [];
    for (const [index, row] of this.rows) {
      if (index < first || index >= last) { this.rows.delete(index); reusable.push(row); }
    }
    for (let index = first; index < last; index++) {
      if (this.rows.has(index)) continue;
      const row = this.populate(index, reusable.pop());
      const next = Array.from(this.container.children).find(node => Number((node as HTMLElement).dataset.row) > index);
      this.container.insertBefore(row.element, next ?? null);
      this.rows.set(index, row);
    }
    for (const row of reusable) row.element.remove();
    this.container.style.transform = `translate3d(0, ${(first - frame.scroll) * m.lineHeight}px, 0)`;
    let nearest: HTMLElement | null = null;
    let nearestDistance = Infinity;
    for (const [rowIndex, row] of this.rows) {
      const top = `${(anchor + rowIndex - first) * m.lineHeight}px`;
      if (row.element.style.top !== top) row.element.style.top = top;
      if (this.settings.cursorMode === 'trail') {
        const range = trailRange(this.layout, rowIndex, frame);
        row.trail.style.left = `${range.x * m.cellWidth}px`;
        row.trail.style.width = `${range.width * m.cellWidth}px`;
        row.trail.style.opacity = String(trailOpacity(this.settings, frame.rowIndex - rowIndex, elapsed(frame.rowElapsed)));
        row.trail.hidden = !this.document.words.length || range.width <= 0;
      }
      for (const cell of row.cells) {
        if (rowIndex === frame.rowIndex && this.document.wordOrdinal[cell.glyph] >= 0) {
          const pen = this.settings.cursorMode === 'trail' ? frame.inkX : frame.x + frame.width / 2;
          const width = this.document.scales[cell.glyph] * (this.document.bold[cell.glyph] ? 1.04 : 1);
          const distance = Math.abs(cell.column + Math.min(this.layout.columns, width) / 2 - pen);
          if (distance < nearestDistance) { nearestDistance = distance; nearest = cell.element; }
        }
      }
    }
    if (nearest !== this.current) {
      this.current?.classList.remove('is-current');
      nearest?.classList.add('is-current');
      this.current = nearest;
    }
    this.cursor.hidden = this.settings.cursorMode === 'trail' || !this.document.words.length || frame.span === 0;
    this.cursor.style.width = `${frame.width * m.cellWidth}px`;
    this.cursor.style.transform = `translate3d(${frame.x * m.cellWidth}px, ${(anchor + frame.y - frame.scroll) * m.lineHeight + m.underlineOffset}px, 0)`;
    this.cursor.dataset.phase = 'scan';
    this.cursor.dataset.span = String(frame.span);
  }

  dispose() {
    this.container.textContent = '';
    this.rows.clear();
    this.current = null;
  }
}
