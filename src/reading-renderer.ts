// 版权所有：波哥
import { readableInk, type Settings } from './model';
import { type ReadingDocument, type ReadingLayout, type readingMetrics } from './reading-layout';
import { focusWeight, type motionFrame } from './reading-motion';

type Cell = { element: HTMLSpanElement; inner: HTMLSpanElement; glyph: number; column: number; focus: number };
type RowView = { element: HTMLDivElement; cells: Cell[] };
type Metrics = ReturnType<typeof readingMetrics>;
const rgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

export class ReadingRenderer {
  private rows = new Map<number, RowView>();
  private current: HTMLElement | null = null;
  private textRGB: number[];
  private cursorRGB: number[];

  constructor(
    private container: HTMLDivElement, private cursor: HTMLDivElement,
    private document: ReadingDocument, private layout: ReadingLayout,
    private metrics: Metrics, private settings: Settings,
  ) {
    this.textRGB = rgb(settings.textColor);
    this.cursorRGB = settings.cursorTransparent ? this.textRGB : rgb(readableInk(settings.cursorColor));
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
      inner.textContent = this.document.glyphs[glyph];
      span.append(inner);
      return { element: span, inner, glyph, column: row.columns[index], focus: -1 };
    });
    element.replaceChildren(...cells.map(cell => cell.element));
    return { element, cells };
  }

  paint(frame: ReturnType<typeof motionFrame>) {
    const { metrics: m, settings } = this;
    const first = Math.max(0, Math.floor(frame.scroll) - 2);
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
      const top = `${(1 + rowIndex - first) * m.lineHeight}px`;
      if (row.element.style.top !== top) row.element.style.top = top;
      for (const cell of row.cells) {
        const weight = frame.span ? focusWeight(cell.column, rowIndex, frame) : 0;
        if (Math.abs(weight - cell.focus) > 0.00005) {
          const scale = 1 + (settings.cursorScale - 1) * weight;
          cell.inner.style.transform = `scale(${scale})`;
          cell.inner.style.color = `rgb(${this.textRGB.map((color, i) => Math.round(color + (this.cursorRGB[i] - color) * weight)).join(',')})`;
          cell.element.dataset.focus = String(weight);
          cell.focus = weight;
        }
        if (this.document.wordOrdinal[cell.glyph] >= 0) {
          const distance = (cell.column + 0.5 - frame.x - frame.width / 2) ** 2 + ((rowIndex - frame.y) * 3) ** 2;
          if (distance < nearestDistance) { nearestDistance = distance; nearest = cell.element; }
        }
      }
    }
    if (nearest !== this.current) {
      this.current?.classList.remove('is-current');
      nearest?.classList.add('is-current');
      this.current = nearest;
    }
    this.cursor.hidden = !this.document.words.length || frame.span === 0;
    this.cursor.style.width = `${frame.width * m.cellWidth}px`;
    this.cursor.style.transform = `translate3d(${frame.x * m.cellWidth}px, ${(1 + frame.y - frame.scroll) * m.lineHeight}px, 0)`;
    this.cursor.dataset.phase = frame.turning ? 'return' : 'scan';
    this.cursor.dataset.span = String(frame.span);
  }

  dispose() {
    this.container.replaceChildren();
    this.rows.clear();
    this.current = null;
  }
}
