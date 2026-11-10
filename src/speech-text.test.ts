// 版权所有：波哥
import { describe, expect, it } from 'vitest';
import { applyPronunciation, builtInPronunciationRules, parsePronunciationRules, validatePronunciationRules } from './speech-text';

describe('离线发音词典', () => {
  it('内置规则修正禅宗与多音字词，且不改原文长度', () => {
    const text = '南无阿弥陀佛，般若波罗蜜多，伽蓝中诵梵呗，刹那入三藏。';
    const spoken = applyPronunciation(text);
    expect(spoken).toContain('那摩');
    expect(spoken).toContain('波惹');
    expect(spoken).toContain('茄蓝');
    expect(spoken).toContain('梵拜');
    expect(spoken).toContain('岔那');
    expect(spoken).toContain('三葬');
    expect(spoken.length).toBe(text.length);
  });
  it('不误伤含同形字的普通词', () => {
    expect(applyPronunciation('瑜伽、伽利略、 repetitions')).toBe('瑜伽、伽利略、 repetitions');
    expect(builtInPronunciationRules().every(rule => rule.from.length === rule.to.length)).toBe(true);
  });
  it('长词优先于短词，避免重叠替换', () => {
    expect(applyPronunciation('大藏经')).toBe('大葬经');
    expect(applyPronunciation('藏经')).toBe('葬经');
  });
  it('不破坏 UTF-16 代理对与普通英文', () => {
    const text = '南无😀般若 ABC 123。';
    const spoken = applyPronunciation(text);
    expect(spoken).toContain('😀');
    expect(spoken).toContain('ABC 123');
    expect(spoken.length).toBe(text.length);
  });
  it('自定义规则生效且可覆盖内置词', () => {
    const rules = parsePronunciationRules('重复=崇复\n银行=很行');
    expect(rules).toEqual([{ from: '重复', to: '崇复' }, { from: '银行', to: '很行' }]);
    expect(applyPronunciation('重复银行', rules)).toBe('崇复很行');
  });
  it('拒绝注入、不等长、空值、重复与超量规则', () => {
    expect(validatePronunciationRules([
      { from: '甲', to: '乙丙' },
      { from: '甲', to: '乙' },
      { from: '甲', to: '乙' },
      { from: '<img onerror=alert(1)>', to: 'xxxx' },
      { from: 'https://x.y', to: 'zzzzzzzzzzz' },
      { from: '', to: '' },
      { from: '甲', to: '甲' },
      { from: '长'.repeat(25), to: '乙'.repeat(25) },
      null,
      '坏数据',
    ])).toEqual([{ from: '甲', to: '乙' }]);
    expect(validatePronunciationRules(Array.from({ length: 300 }, (_, i) => ({ from: `词${i}`, to: `字${i}` })))).toHaveLength(200);
    expect(validatePronunciationRules('not an array')).toEqual([]);
  });
  it('解析忽略空行、注释样文本与多余等号', () => {
    expect(parsePronunciationRules('  \n这是说明\n甲乙=丙丁\n=无左值\n戊己=')).toEqual([{ from: '甲乙', to: '丙丁' }]);
  });
});
