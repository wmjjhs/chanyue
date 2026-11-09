// 版权所有：波哥
import { validateSourceFont } from './source-font';
export type TextRun = { start: number; end: number; scale: number; bold: boolean; font?: string };
export type TextPiece = { text: string; size?: number; bold?: boolean; font?: string; anchor?: string };
export type FormattedText = { lines: string[]; typography: TextRun[]; anchors?: Record<string, number>; contents?: import('./reading-tools').ContentsEntry[] };
export const MAX_STYLE_RUNS = 200_000;
export const MIN_TEXT_SCALE = 0.7;
export const MAX_TEXT_SCALE = 2;

const same = (a: TextRun, b: TextRun) => a.bold === b.bold && a.scale === b.scale && a.font === b.font;
function append(runs: TextRun[], run: TextRun) {
  const last = runs[runs.length - 1];
  if (last && last.end === run.start && same(last, run)) last.end = run.end;
  else runs.push(run);
}

export function validateTypography(value: unknown, length: number): TextRun[] {
  if (!Array.isArray(value) || value.length > MAX_STYLE_RUNS) return [];
  const result: TextRun[] = [];
  let end = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    if (!Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < end || item.end <= item.start || item.end > length) continue;
    if (typeof item.scale !== 'number' || !Number.isFinite(item.scale) || item.scale <= 0 || typeof item.bold !== 'boolean') continue;
    const font = validateSourceFont(item.font);
    const run: TextRun = { start: item.start, end: item.end, scale: Math.round(Math.max(MIN_TEXT_SCALE, Math.min(MAX_TEXT_SCALE, item.scale)) * 1000) / 1000, bold: item.bold, ...(font ? { font } : {}) };
    end = item.end;
    if (run.scale !== 1 || run.bold || run.font) append(result, run);
  }
  return result;
}

export function normalizeFormatted(pieces: TextPiece[]): FormattedText {
  const text: string[] = [];
  const raw: { start: number; end: number; size: number; bold: boolean; font?: string; weight: number }[] = [];
  let length = 0, paragraph = false, newLine = false;
  const anchors: Record<string, number> = Object.create(null);
  const pending = new Set<string>();
  let spaces = '';
  let spaceStyle: TextPiece = { text: '' };
  const emit = (value: string, piece: Pick<TextPiece, 'size' | 'bold' | 'font'>) => {
    text.push(value);
    const size = typeof piece.size === 'number' && Number.isFinite(piece.size) && piece.size > 0 ? Math.min(400, Math.max(1, piece.size)) : 12;
    const bold = piece.bold === true, font = piece.font;
    const weight = /^\s+$/u.test(value) ? 0 : value.length;
    const last = raw[raw.length - 1];
    if (last && last.end === length && last.size === size && last.bold === bold && last.font === font) { last.end += value.length; last.weight += weight; }
    else raw.push({ start: length, end: length + value.length, size, bold, font, weight });
    length += value.length;
    if (length > 2_000_000) throw new Error('正文超过 200 万字，请拆分书籍后导入。');
    if (raw.length > MAX_STYLE_RUNS) throw new Error('文档字体变化过多，请拆分文档后导入。');
  };
  for (const piece of pieces) {
    if (piece.anchor) pending.add(piece.anchor);
    for (const char of piece.text) {
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(char)) continue;
      if (char === '\r' || char === '\n') {
        if (paragraph) newLine = true;
        paragraph = false; spaces = ''; continue;
      }
      if (/\s/u.test(char)) {
        if (paragraph) {
          const horizontal = /[\t \u00a0]/.test(char);
          if (!horizontal || !spaces.endsWith(' ')) spaces += horizontal ? ' ' : char;
          spaceStyle = piece;
        }
        continue;
      }
      if (newLine) { emit('\n', {}); newLine = false; }
      if (spaces) { emit(spaces, spaceStyle); spaces = ''; }
      for (const anchor of pending) anchors[anchor] = length;
      pending.clear();
      emit(char, piece); paragraph = true;
    }
  }
  const normalized = text.join('');
  const sizes = new Map<number, number>();
  for (const run of raw) {
    if (!run.bold && run.weight > 0) sizes.set(run.size, (sizes.get(run.size) ?? 0) + run.weight);
  }
  if (!sizes.size) for (const run of raw) if (run.weight > 0) sizes.set(run.size, (sizes.get(run.size) ?? 0) + run.weight);
  const base = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 12;
  return { lines: normalized ? normalized.split('\n') : [], typography: validateTypography(raw.map(run => ({ start: run.start, end: run.end, bold: run.bold, scale: run.size / base, ...(run.font ? { font: run.font } : {}) })), length), anchors };
}
