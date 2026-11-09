// 版权所有：波哥
import { safeBoundary } from './reading-tools';
export type Sentence = { start: number; end: number };

export function splitSentences(text: string): Sentence[] {
  const result: Sentence[] = [];
  const endings = /[。！？!?；;\n]+[”’」』）》】"']*|[.]+[”’」』）》】"']*|…{2,}[”’」』）》】"']*/gu;
  let start = 0;
  const append = (end: number) => {
    const segment = text.slice(start, end), leading = segment.match(/^\s*/u)?.[0].length ?? 0;
    if (/[\p{L}\p{N}\p{S}]/u.test(segment)) result.push({ start: start + leading, end });
    start = end;
  };
  for (const match of text.matchAll(endings)) {
    const end = match.index + match[0].length;
    if (match[0][0] === '.' && end < text.length && !/\s/u.test(text[end])) continue;
    append(end);
  }
  if (start < text.length) append(text.length);
  return result;
}
export function sentenceIndex(sentences: Sentence[], source: number): number {
  if (!sentences.length) return -1;
  let left = 0, right = sentences.length - 1;
  while (left < right) {
    const middle = Math.ceil((left + right) / 2);
    if (sentences[middle].start <= source) left = middle; else right = middle - 1;
  }
  return left;
}
export function sentenceStop(sentences: Sentence[], source: number, length: number): number {
  const index = sentenceIndex(sentences, source);
  return sentences[index + 1]?.start ?? length;
}
export function advanceSentence(position: number, increment: number, stop: number): { position: number; stopped: boolean } {
  return { position: Math.min(stop, position + Math.max(0, increment)), stopped: position + Math.max(0, increment) >= stop };
}
export type MaskLevel = 'full' | 'partial' | 'cue' | 'hidden';
export function maskSentence(text: string, level: MaskLevel): string {
  if (level === 'full') return text;
  const segments = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text), part => part.segment) : Array.from(text);
  let count = 0;
  return segments.map(glyph => {
    if (/^[\p{P}\p{Z}\p{M}\s]+$/u.test(glyph)) return glyph;
    const index = count++;
    return level === 'partial' && index % 2 === 0 || level === 'cue' && index < 2 ? glyph : '＿';
  }).join('');
}
export function practiceSentences(text: string, sentences: Sentence[], index: number, count: number): Sentence[] {
  const result: Sentence[] = [];
  const first = sentences[Math.max(0, index)];
  if (!first) return result;
  const limit = safeBoundary(text, first.start + 2000);
  for (const range of sentences.slice(Math.max(0, index), Math.max(0, index) + Math.min(4, Math.max(1, count)))) {
    if (range.start >= limit) break;
    result.push({ start: range.start, end: Math.min(limit, range.end) });
  }
  return result;
}
