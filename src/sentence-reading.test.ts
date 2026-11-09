// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { splitSentences, sentenceIndex, sentenceStop, advanceSentence, maskSentence, practiceSentences } from './sentence-reading';
import { createDocument, glyphPosition, sourcePosition } from './reading-layout';

describe('按源锚点逐句阅读和小段遮字', () => {
  it('超长不构成句尾的句点串在线性时间内处理', () => {
    const text = '.'.repeat(100_000) + '甲', start = performance.now();
    expect(splitSentences(text)).toEqual([{ start: 0, end: text.length }]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
  it('中文结束标点、连续标点、闭引号、诗歌换行及无标点结尾', () => {
    const text = '第一句。“第二句！”\n床前明月光\n疑是地上霜\n结尾';
    const spans = splitSentences(text);
    expect(spans.map(s => text.slice(s.start, s.end).trim())).toEqual(['第一句。', '“第二句！”', '床前明月光', '疑是地上霜', '结尾']);
    expect(spans.every((s, i) => i === 0 || s.start >= spans[i - 1].end)).toBe(true);
  });
  it('小数和单词内部句点不分割，英文末尾标点正常分句', () => {
    const text = 'Value 3.14. Next?! Last.';
    expect(splitSentences(text).map(s => text.slice(s.start, s.end))).toEqual(['Value 3.14.', 'Next?!', 'Last.']);
  });
  it('句边界、小数源位置、最后一句与空正文', () => {
    const text = '甲乙。丙丁。最后', spans = splitSentences(text);
    expect(sentenceIndex(spans, 2.99)).toBe(0); expect(sentenceIndex(spans, 3)).toBe(1);
    expect(sentenceStop(spans, 3, text.length)).toBe(6);
    expect(sentenceStop(spans, 6, text.length)).toBe(text.length);
    expect(splitSentences('。\n！？')).toEqual([]); expect(sentenceIndex([], 0)).toBe(-1);
  });
  it('帧时间很大也不会越过本句终点，恢复源锚点精确', () => {
    const doc = createDocument(['甲🌱。第二句。']), spans = splitSentences('甲🌱。第二句。');
    const target = sentenceStop(spans, 0, doc.length), stop = glyphPosition(doc, target);
    const next = advanceSentence(0, 100, stop);
    expect(next.stopped).toBe(true); expect(sourcePosition(doc, next.position)).toBe(target);
    expect(advanceSentence(0, .25, stop)).toEqual({ position: .25, stopped: false });
    expect(advanceSentence(.2, -1, stop).position).toBe(.2);
  });
  it('遮字不改原文，保留标点，只留句首并安全处理组合字符', () => {
    const text = '床前明月光，🌱。';
    expect(maskSentence(text, 'full')).toBe(text);
    expect(maskSentence(text, 'cue')).toBe('床前＿＿＿，＿。');
    expect(maskSentence(text, 'hidden')).toBe('＿＿＿＿＿，＿。');
    expect(maskSentence('a\u0301👨‍👩‍👧，', 'hidden')).toBe('＿＿，');
    expect(maskSentence(text, 'partial')).toBe('床＿明＿光，＿。');
  });
  it('小段限1至4句及2000字符，不切断代理对', () => {
    const text = '短句。第二句。第三句。第四句。第五句。', spans = splitSentences(text);
    expect(practiceSentences(text, spans, 0, 9)).toHaveLength(4);
    expect(practiceSentences(text, spans, 2, 1)).toEqual([spans[2]]);
    const long = '字'.repeat(1999) + '🌱最后';
    expect(practiceSentences(long, splitSentences(long), 0, 1)[0].end).toBe(1999);
    expect(practiceSentences('', [], 0, 2)).toEqual([]);
  });
});
