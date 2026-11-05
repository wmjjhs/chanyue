// 版权所有：波哥
import { floorIndex, type ReadingDocument, type ReadingLayout } from './reading-layout';

export type Curve = { times: number[]; values: number[]; slopes: number[] };
export type MotionRow = {
  rowIndex: number; start: number; end: number; scanEnd: number; span: number;
  left: Curve; right: Curve;
};
export type ReadingMotion = { rows: MotionRow[]; starts: number[]; scroll: Curve; total: number };

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const smoothstep = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

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
    const span = Math.min(wordColumns.length, Math.max(1, Math.min(10, Math.round(requestedSpan))));
    const times = Array.from({ length: wordColumns.length - span + 1 }, (_, i) => i);
    const left = times.map(i => wordColumns[i]);
    const right = times.map(i => wordColumns[i + span - 1] + 1);
    left[0] = row.columns[0];
    right[right.length - 1] = row.columns[row.columns.length - 1] + 1;
    rows.push({ rowIndex, start: row.wordStart, end: row.wordEnd, scanEnd: row.wordEnd, span,
      left: monotoneCurve(times, left), right: monotoneCurve(times, right) });
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const count = rows[i].end - rows[i].start;
    rows[i].scanEnd -= Math.min(1.5, count * 0.3);
  }
  const total = document.words.length;
  const starts = rows.map(row => row.start);
  const scroll = rows.length ? monotoneCurve([...starts, total], [...rows.map(row => row.rowIndex), rows[rows.length - 1].rowIndex + 1]) : monotoneCurve([], []);
  return { rows, starts, scroll, total };
}

export function motionFrame(motion: ReadingMotion, clock: number) {
  const index = Math.min(motion.rows.length - 1, floorIndex(motion.starts, clock));
  const row = motion.rows[index];
  if (!row) return { rowIndex: 0, x: 0, y: 0, width: 1, scroll: 0, turning: false, span: 0, progress: 0 };
  const next = motion.rows[index + 1];
  const turn = Boolean(next && clock > row.scanEnd);
  let left: number;
  let right: number;
  let y = row.rowIndex;
  if (turn && next) {
    const phase = clamp((clock - row.scanEnd) / (row.end - row.scanEnd));
    const blend = smoothstep(phase);
    left = mix(row.left.values[row.left.values.length - 1], next.left.values[0], blend);
    right = mix(row.right.values[row.right.values.length - 1], next.right.values[0], blend);
    y = mix(row.rowIndex, next.rowIndex, blend) + Math.sin(Math.PI * phase) ** 2 * 0.22;
  } else {
    const phase = smoothstep((clock - row.start) / (row.scanEnd - row.start));
    const offset = phase * Math.max(0, row.end - row.start - row.span);
    left = curveAt(row.left, offset);
    right = curveAt(row.right, offset);
  }
  return { rowIndex: row.rowIndex, x: left, y, width: right - left,
    scroll: curveAt(motion.scroll, clock), turning: turn, span: row.span,
    progress: clamp(clock / Math.max(1, motion.total)) };
}

export function focusWeight(column: number, rowIndex: number, frame: ReturnType<typeof motionFrame>): number {
  const radius = Math.max(0.8, frame.width / 2);
  const dx = Math.abs(column + 0.5 - (frame.x + frame.width / 2)) / radius;
  const dy = Math.abs(rowIndex - frame.y) / 0.9;
  const kernel = (distance: number) => distance >= 1 ? 0 : (1 - distance * distance) ** 2;
  return kernel(dx) * kernel(dy);
}
