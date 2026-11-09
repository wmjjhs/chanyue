// 版权所有：波哥
import { safeBoundary } from './reading-tools';
import { splitSentences, sentenceIndex, type Sentence } from './sentence-reading';
import type { PracticeState } from './book-state';

export function fixedPracticeUnits(text: string, unit: PracticeState['unit']): Sentence[] {
  const ranges: Sentence[] = unit === 'sentence' ? splitSentences(text) : [];
  if (unit === 'paragraph') {
    let start = 0;
    for (const paragraph of text.split('\n')) {
      if (paragraph.trim()) ranges.push({ start: start + (paragraph.match(/^\s*/u)?.[0].length ?? 0), end: start + paragraph.length });
      start += paragraph.length + 1;
    }
  }
  const result: Sentence[] = [];
  for (const range of ranges) {
    let start = range.start;
    while (start < range.end) {
      const end = safeBoundary(text, Math.min(range.end, start + 2000));
      result.push({ start, end }); start = end;
    }
  }
  return result;
}
export function practiceRange(units: Sentence[], source: number, span: number) {
  const index = Math.max(0, sentenceIndex(units, source));
  return { index, ranges: units.slice(index, index + span) };
}
export function connectPrevious(units: Sentence[], state: PracticeState): PracticeState {
  const index = sentenceIndex(units, state.source);
  if (index <= 0 || state.span >= 4) return state;
  return { ...state, source: units[index - 1].start, span: state.span + 1 };
}
