// 版权所有：波哥
import { floorIndex, type ReadingDocument, type ReadingLayout } from './reading-layout';
import { MAX_CURSOR_WORDS } from './model';

export type Curve = { times: number[]; values: number[]; slopes: number[] };
export type MotionRow = {
  rowIndex: number; start: number; end: number; span: number;
  left: Curve; right: Curve; ink: Curve;
};
export type ReadingMotion = { rows: MotionRow[]; starts: number[]; scroll: Curve; total: number };

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function monotoneCurve(times: number[], values: number[]): Curve {
  const slopes = new Array(times.length).fill(0);
  const intervals = times.slice(1).map((time, i) => time - times[i]);
  const secants = intervals.map((duration, i) => (values[i + 1] - values[i]) / duration);
  slopes[0] = secants[0] ?? 0;
  slopes[slopes.length - 1] = secants.at(-1) ?? 0;
  for (let i = 1; i < times.length - 1; i++) {
    if (secants[i - 1] * secants[i] <= 0) continue;
    const w1 = 2 * intervals[i] + intervals[i - 1];
    const w2 = intervals[i] + 2 * intervals[i - 1];
    slopes[i] = (w1 + w2) / (w1 / secants[i - 1] + w2 / secants[i]);
  }
  return { times, values, slopes };
}

export function curveAt(curve: Curve, time: number): number {
  if (!curve.times.length) return 0;
  if (time <= curve.times[0]) return curve.values[0];
  if (time >= curve.times[curve.times.length - 1]) return curve.values[curve.values.length - 1];
  const i = floorIndex(curve.times, time);
  const duration = curve.times[i + 1] - curve.times[i];
  const t = (time - curve.times[i]) / duration;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * curve.values[i] + (t3 - 2 * t2 + t) * duration * curve.slopes[i]
    + (-2 * t3 + 3 * t2) * curve.values[i + 1] + (t3 - t2) * duration * curve.slopes[i + 1];
}

export function buildMotion(document: ReadingDocument, layout: ReadingLayout, requestedSpan: number): ReadingMotion {
  const rows: MotionRow[] = [];
  for (let rowIndex = 0; rowIndex < layout.rows.length; rowIndex++) {
    const row = layout.rows[rowIndex];
    if (row.wordEnd === row.wordStart) continue;
    const wordColumns = row.glyphs.flatMap((glyph, i) => document.wordOrdinal[glyph] >= 0 ? [row.columns[i]] : []);
    const span = Math.min(wordColumns.length, Math.max(1, Math.min(MAX_CURSOR_WORDS, Math.round(requestedSpan))));
    const times = Array.from({ length: wordColumns.length - span + 1 }, (_, i) => i);
    const left = times.map(i => wordColumns[i]);
    const right = times.map(i => wordColumns[i + span - 1] + 1);
    left[0] = row.columns[0];
    right[right.length - 1] = row.columns[row.columns.length - 1] + 1;
    const ink = [row.columns[0], ...wordColumns.slice(1), row.columns[row.columns.length - 1] + 1];
    rows.push({ rowIndex, start: row.wordStart, end: row.wordEnd, span,
      left: monotoneCurve(times, left), right: monotoneCurve(times, right),
      ink: monotoneCurve(ink.map((_, i) => i), ink) });
  }
  const total = document.words.length;
  const starts = rows.map(row => row.start);
  const scroll = rows.length ? monotoneCurve([...starts, total], [...rows.map(row => row.rowIndex), rows[rows.length - 1].rowIndex + 1]) : monotoneCurve([], []);
  return { rows, starts, scroll, total };
}

export function motionFrame(motion: ReadingMotion, clock: number) {
  const index = Math.min(motion.rows.length - 1, floorIndex(motion.starts, clock));
  const row = motion.rows[index];
  if (!row) return { rowIndex: 0, x: 0, y: 0, width: 1, inkX: 0, scroll: 0, span: 0, progress: 0, completed: false };
  const phase = clamp((clock - row.start) / (row.end - row.start));
  const offset = phase * Math.max(0, row.end - row.start - row.span);
  const left = curveAt(row.left, offset);
  const right = curveAt(row.right, offset);
  return { rowIndex: row.rowIndex, x: left, y: row.rowIndex, width: right - left,
    inkX: curveAt(row.ink, clock - row.start), scroll: curveAt(motion.scroll, clock), span: row.span,
    progress: clamp(clock / Math.max(1, motion.total)), completed: clock >= motion.total };
}

export function trailRange(layout: ReadingLayout, rowIndex: number, frame: ReturnType<typeof motionFrame>) {
  const row = layout.rows[rowIndex];
  if (!row) return { x: 0, width: 0 };
  const start = row.columns[0];
  const end = row.columns[row.columns.length - 1] + 1;
  const pen = frame.completed || rowIndex < frame.rowIndex ? end : rowIndex === frame.rowIndex && frame.span > 0 ? frame.inkX : start;
  return { x: start, width: Math.max(0, Math.min(end, pen) - start) };
}
