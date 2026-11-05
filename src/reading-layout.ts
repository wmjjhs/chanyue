// 版权所有：波哥
import type { Book, Settings } from './model';

export type ReadingDocument = {
  glyphs: string[];
  offsets: number[];
  paragraphStarts: Set<number>;
  spaces: Set<number>;
  lineStarts: number[];
  length: number;
};
export type ReadingRow = { start: number; end: number; columns: number[]; paragraph: boolean };
export type ReadingLayout = { rows: ReadingRow[]; rowOf: Uint32Array; columns: number };

function* graphemes(text: string): Generator<{ segment: string; index: number }> {
  if (typeof Intl.Segmenter !== 'function') {
    let index = 0;
    for (const segment of text) { yield { segment, index }; index += segment.length; }
    return;
  }
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  let carry = '';
  let base = 0;
  for (let offset = 0; offset < text.length; offset += 4096) {
    const part = carry + text.slice(offset, offset + 4096);
    let pending: { segment: string; index: number } | undefined;
    for (const segment of segmenter.segment(part)) {
      if (pending) yield { segment: pending.segment, index: base + pending.index };
      pending = segment;
    }
    carry = pending?.segment ?? '';
    base += part.length - carry.length;
  }
  if (carry) yield { segment: carry, index: base };
}

export function createDocument(lines: string[]): ReadingDocument {
  const document: ReadingDocument = { glyphs: [], offsets: [], paragraphStarts: new Set(), spaces: new Set(), lineStarts: [], length: 0 };
  for (const line of lines) {
    document.lineStarts.push(document.length);
    let first = true;
    let space = false;
    for (const { segment, index } of graphemes(line)) {
      if (/^\s+$/u.test(segment)) { space = true; continue; }
      const position = document.glyphs.length;
      if (first) document.paragraphStarts.add(position);
      else if (space) document.spaces.add(position);
      document.glyphs.push(segment);
      document.offsets.push(document.length + index);
      first = false;
      space = false;
    }
    document.length += line.length + 1;
  }
  document.length = Math.max(0, document.length - 1);
  return document;
}

export function floorIndex(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function glyphPosition(document: ReadingDocument, source: number): number {
  if (source >= document.length) return document.glyphs.length;
  const index = floorIndex(document.offsets, Math.max(0, source));
  const start = document.offsets[index] ?? 0;
  const end = document.offsets[index + 1] ?? document.length;
  return index + Math.max(0, Math.min(0.999999, (source - start) / Math.max(1, end - start)));
}

export function sourcePosition(document: ReadingDocument, position: number): number {
  if (position >= document.glyphs.length) return document.length;
  const index = Math.max(0, Math.floor(position));
  const start = document.offsets[index] ?? 0;
  const end = document.offsets[index + 1] ?? document.length;
  return start + (position - index) * (end - start);
}

export function initialPosition(book: Book, document: ReadingDocument): number {
  if (book.completed) return document.glyphs.length;
  if (typeof book.character === 'number' && Number.isFinite(book.character)) return glyphPosition(document, book.character);
  return glyphPosition(document, document.lineStarts[Math.max(0, Math.min(book.line, document.lineStarts.length - 1))] ?? 0);
}

const word = /^[\p{L}\p{N}'’-]$/u;
const latin = /^[\p{Script=Latin}\p{N}'’-]$/u;
const closing = /^[，。！？；：、）》】」』”’…,.!?;:%]$/u;

export function layoutDocument(document: ReadingDocument, width: number, mode: Settings['layoutMode']): ReadingLayout {
  const columns = Math.max(2, Math.floor(width));
  const rows: ReadingRow[] = [];
  const rowOf = new Uint32Array(document.glyphs.length);
  let row: ReadingRow = { start: 0, end: 0, columns: [], paragraph: true };
  let column = mode === 'semantic' && columns >= 6 ? 2 : 0;
  const finish = () => {
    if (row.end > row.start) rows.push(row);
    row = { start: row.end, end: row.end, columns: [], paragraph: false };
    column = 0;
  };
  for (let i = 0; i < document.glyphs.length; i++) {
    if (mode === 'semantic' && document.paragraphStarts.has(i) && i !== 0) {
      finish(); row.paragraph = true; column = columns >= 6 ? 2 : 0;
    }
    const gap = mode === 'semantic' && document.spaces.has(i) && row.columns.length > 0 ? 1 : 0;
    if (mode === 'semantic' && latin.test(document.glyphs[i]) && (i === 0 || document.spaces.has(i) || !word.test(document.glyphs[i - 1]))) {
      let end = i + 1;
      while (end < document.glyphs.length && end - i <= columns && !document.spaces.has(end) && !document.paragraphStarts.has(end) && latin.test(document.glyphs[end])) end++;
      if (end - i <= columns && column + gap + end - i > columns) finish();
    }
    if (column + (row.columns.length ? gap : 0) >= columns) finish();
    if (row.columns.length) column += gap;
    if (mode === 'semantic' && column === columns - 1 && i + 1 < document.glyphs.length && closing.test(document.glyphs[i + 1]) && !document.paragraphStarts.has(i + 1) && row.columns.length > 0) finish();
    rowOf[i] = rows.length;
    row.columns.push(column++);
    row.end = i + 1;
  }
  finish();
  return { rows, rowOf, columns };
}

export function scanFrame(layout: ReadingLayout, position: number, lineHeight: number) {
  const last = layout.rowOf.length - 1;
  const active = Math.max(0, Math.min(last, Math.floor(position)));
  const rowIndex = layout.rowOf[active] ?? 0;
  const row = layout.rows[rowIndex];
  if (!row) return { active, rowIndex: 0, column: 0, phase: 0, scroll: 0, count: 1 };
  const count = row.end - row.start;
  const phase = Math.min(1, Math.max(0, (position - row.start) / count));
  return { active, rowIndex, column: row.columns[active - row.start], phase, scroll: (rowIndex + phase) * lineHeight, count };
}

export function readingMetrics(width: number, height: number, settings: Settings) {
  const lineFactor = Math.max(1.9, settings.cursorScale + 0.55);
  const cellFactor = Math.max(1.12, settings.cursorScale + 0.12);
  const fontSize = Math.min(settings.fontSize, Math.max(10, Math.min(Math.floor(height / 2) / lineFactor, Math.floor((width - 32) / 2) / cellFactor)));
  const cellWidth = Math.ceil(fontSize * cellFactor);
  const lineHeight = Math.ceil(fontSize * lineFactor);
  const visibleLines = Math.max(2, Math.min(settings.maxLines, Math.floor(height / lineHeight)));
  const columns = Math.max(2, Math.floor((width - 32) / cellWidth));
  return { fontSize, cellWidth, lineHeight, visibleLines, columns };
}
