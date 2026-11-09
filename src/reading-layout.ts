// 版权所有：波哥
import { MAX_CURSOR_THICKNESS, MIN_FONT_SIZE, type Book, type Settings } from './model';
import { validateTypography, type TextRun } from './typography';

export type ReadingDocument = {
  glyphs: string[]; offsets: number[]; words: number[]; wordOffsets: number[]; wordOrdinal: number[];
  paragraphStarts: Set<number>; spaces: Set<number>; lineStarts: number[]; length: number;
  scales: number[]; bold: boolean[]; fonts: (string | undefined)[]; maxScale: number;
};
export type ReadingRow = {
  start: number; end: number; glyphs: number[]; columns: number[]; widths: number[]; paragraph: boolean; wordStart: number; wordEnd: number;
};
export type ReadingLayout = { rows: ReadingRow[]; rowOf: Uint32Array; columns: number };

export const isPunctuation = (glyph: string) => /^[\p{P}\p{M}\u200d]+$/u.test(glyph);
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
function* graphemes(text: string): Generator<{ segment: string; index: number }> {
  if (!segmenter) {
    let index = 0;
    for (const segment of text) { yield { segment, index }; index += segment.length; }
    return;
  }
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

export function createDocument(lines: string[], typography?: TextRun[]): ReadingDocument {
  const runs = validateTypography(typography, Math.max(0, lines.reduce((total, line) => total + line.length + 1, 0) - 1));
  let runIndex = 0;
  const document: ReadingDocument = { glyphs: [], offsets: [], words: [], wordOffsets: [], wordOrdinal: [], paragraphStarts: new Set(), spaces: new Set(), lineStarts: [], length: 0, scales: [], bold: [], fonts: [], maxScale: 1 };
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
      const source = document.length + index;
      while (runIndex < runs.length && runs[runIndex].end <= source) runIndex++;
      const run = runs[runIndex]?.start <= source ? runs[runIndex] : undefined;
      document.scales.push(run?.scale ?? 1);
      document.bold.push(run?.bold ?? false);
      document.fonts.push(run?.font);
      document.maxScale = Math.max(document.maxScale, run?.scale ?? 1);
      document.offsets.push(source);
      document.wordOrdinal.push(isPunctuation(segment) ? -1 : document.words.length);
      if (!isPunctuation(segment)) {
        document.words.push(position);
        document.wordOffsets.push(document.length + index);
      }
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
  if (!document.words.length || source >= document.length) return document.words.length;
  const index = floorIndex(document.wordOffsets, Math.max(0, source));
  const start = document.wordOffsets[index];
  const end = document.wordOffsets[index + 1] ?? document.length;
  return index + Math.max(0, Math.min(0.999999, (source - start) / Math.max(1, end - start)));
}

export function sourcePosition(document: ReadingDocument, position: number): number {
  if (position >= document.words.length) return document.length;
  const index = Math.max(0, Math.floor(position));
  const start = document.wordOffsets[index] ?? 0;
  const end = document.wordOffsets[index + 1] ?? document.length;
  return start + (position - index) * (end - start);
}

export function initialPosition(book: Book, document: ReadingDocument): number {
  if (book.completed) return document.words.length;
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
  let words = 0;
  const widthOf = (glyph: number) => Math.min(columns, document.scales[glyph] * (document.bold[glyph] ? 1.04 : 1));
  const empty = (start: number): ReadingRow => ({ start, end: start, glyphs: [], columns: [], widths: [], paragraph: false, wordStart: words, wordEnd: words });
  let row = empty(0);
  row.paragraph = true;
  let column = mode === 'semantic' && columns >= 6 ? 2 : 0;
  const finish = () => {
    if (row.glyphs.length) rows.push(row);
    row = empty(row.end);
    column = 0;
  };
  for (let i = 0; i < document.glyphs.length; i++) {
    if (mode === 'plain' && document.wordOrdinal[i] < 0) continue;
    if (mode === 'semantic' && document.paragraphStarts.has(i) && i !== 0) {
      finish(); row.paragraph = true; column = columns >= 6 ? 2 : 0;
    }
    const gap = mode === 'semantic' && document.spaces.has(i) && row.columns.length > 0 ? 1 : 0;
    if (mode === 'semantic' && latin.test(document.glyphs[i]) && (i === 0 || document.spaces.has(i) || !word.test(document.glyphs[i - 1]))) {
      let end = i + 1, wordWidth = widthOf(i);
      while (end < document.glyphs.length && wordWidth <= columns && !document.spaces.has(end) && !document.paragraphStarts.has(end) && latin.test(document.glyphs[end])) wordWidth += widthOf(end++);
      if (wordWidth <= columns && column + gap + wordWidth > columns) finish();
    }
    const glyphWidth = widthOf(i);
    if (column + (row.columns.length ? gap : 0) + glyphWidth > columns + 1e-7) finish();
    if (row.columns.length) column += gap;
    if (mode === 'semantic' && i + 1 < document.glyphs.length && closing.test(document.glyphs[i + 1]) && !document.paragraphStarts.has(i + 1) && row.columns.length > 0 && column + glyphWidth + widthOf(i + 1) > columns + 1e-7) finish();
    rowOf[i] = rows.length;
    if (!row.glyphs.length) row.start = i;
    row.glyphs.push(i);
    row.columns.push(column);
    row.widths.push(glyphWidth);
    column += glyphWidth;
    row.end = i + 1;
    if (document.wordOrdinal[i] >= 0) words++;
    row.wordEnd = words;
  }
  finish();
  return { rows, rowOf, columns };
}

export function rowAtSource(document: ReadingDocument, layout: ReadingLayout, source: number) {
  let low = 0;
  let high = layout.rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (document.offsets[layout.rows[middle].start] <= source) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function pagination(rowCount: number, visibleLines: number, rowIndex: number) {
  const size = Math.max(1, Math.floor(visibleLines));
  const total = Math.ceil(Math.max(0, rowCount) / size);
  const current = total ? Math.max(1, Math.min(total, Math.floor(Math.max(0, rowIndex) / size) + 1)) : 0;
  return { size, total, current };
}

export function pageTarget(layout: ReadingLayout, visibleLines: number, page: number) {
  const { size, total } = pagination(layout.rows.length, visibleLines, 0);
  if (!Number.isInteger(page) || page < 1 || page > total) return null;
  const rowIndex = (page - 1) * size;
  return { rowIndex, position: layout.rows[rowIndex].wordStart };
}

export function readingMetrics(width: number, height: number, settings: Settings, requestedScale = 1) {
  const maxScale = Number.isFinite(requestedScale) ? Math.max(1, Math.min(2, requestedScale)) : 1;
  const lineFactor = 1.65;
  const cellFactor = 1.12;
  const underlineSpace = 2 * (MAX_CURSOR_THICKNESS + 3);
  const halfHeight = Math.floor(height / 2);
  const fontSize = Math.min(settings.fontSize, Math.max(MIN_FONT_SIZE, Math.min(halfHeight / lineFactor, halfHeight - underlineSpace, Math.floor((width - 32) / 2) / cellFactor) / maxScale));
  const maxFontSize = fontSize * maxScale;
  const cellWidth = Math.ceil(fontSize * cellFactor);
  const minimumLineHeight = Math.ceil(Math.max(maxFontSize * lineFactor, maxFontSize + underlineSpace));
  const visibleLines = Math.max(2, Math.min(settings.maxLines, Math.floor(height / minimumLineHeight)));
  const lineHeight = Math.max(minimumLineHeight, height / visibleLines);
  const underlineOffset = (lineHeight + maxFontSize) / 2 + 2;
  const cursorRow = Math.min(settings.cursorRow, visibleLines);
  const columns = Math.max(2, Math.floor((width - 32) / cellWidth));
  return { fontSize, maxFontSize, cellWidth, lineHeight, underlineOffset, visibleLines, cursorRow, columns };
}
