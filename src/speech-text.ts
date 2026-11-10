// 版权所有：波哥
export type PronunciationRule = { from: string; to: string };
export const MAX_PRONUNCIATION_RULES = 200;
export const MAX_PRONUNCIATION_LENGTH = 24;

// 只替换朗读用文本，不改原文、显示、排版与听读进度。
// 均为等长替换：朗读文本 UTF-16 长度不变，进度偏移与 1000 字上限不受影响。
// 右侧选用读音唯一或明显更不易误读的常用字，避免引入新的误读。
const BUILT_IN_RULES: readonly PronunciationRule[] = [
  { from: '南无', to: '那摩' },
  { from: '般若', to: '波惹' },
  { from: '伽蓝', to: '茄蓝' },
  { from: '僧伽', to: '僧茄' },
  { from: '唵', to: '俺' },
  { from: '吽', to: '轰' },
  { from: '梵呗', to: '梵拜' },
  { from: '经幢', to: '经床' },
  { from: '幢幡', to: '床幡' },
  { from: '刹那', to: '岔那' },
  { from: '偈语', to: '记语' },
  { from: '偈颂', to: '记颂' },
  { from: '舍利', to: '设利' },
  { from: '大藏经', to: '大葬经' },
  { from: '三藏', to: '三葬' },
  { from: '藏经', to: '葬经' },
  { from: '西藏', to: '西葬' },
  { from: '银行', to: '银航' },
  { from: '行业', to: '航业' },
  { from: '行列', to: '航列' },
  { from: '重复', to: '崇复' },
  { from: '重叠', to: '崇叠' },
  { from: '重新', to: '崇新' },
  { from: '传记', to: '赚记' },
  { from: '唱和', to: '唱贺' },
  { from: '空闲', to: '控闲' },
  { from: '少室', to: '绍室' },
  { from: '乐府', to: '月府' },
];

export function builtInPronunciationRules(): readonly PronunciationRule[] {
  return BUILT_IN_RULES;
}

const SAFE_TEXT = /^[\p{Script=Han}\p{Script=Latin}\p{N}]+$/u;

export function validatePronunciationRules(value: unknown): PronunciationRule[] {
  if (!Array.isArray(value)) return [];
  const result: PronunciationRule[] = [];
  for (const entry of value) {
    if (result.length >= MAX_PRONUNCIATION_RULES) break;
    if (!entry || typeof entry !== 'object') continue;
    const { from, to } = entry as Partial<PronunciationRule>;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (!from || !to || from === to) continue;
    if (from.length > MAX_PRONUNCIATION_LENGTH || from.length !== to.length) continue;
    if (!SAFE_TEXT.test(from) || !SAFE_TEXT.test(to)) continue;
    if (result.some(rule => rule.from === from)) continue;
    result.push({ from, to });
  }
  return result;
}

export function parsePronunciationRules(text: string): PronunciationRule[] {
  return validatePronunciationRules(text.split(/\r?\n/).map(line => {
    const separator = line.indexOf('=');
    if (separator < 1) return null;
    return { from: line.slice(0, separator).trim(), to: line.slice(separator + 1).trim() };
  }));
}

export function applyPronunciation(text: string, custom: readonly PronunciationRule[] = []): string {
  const merged = new Map<string, string>();
  for (const rule of BUILT_IN_RULES) merged.set(rule.from, rule.to);
  for (const rule of validatePronunciationRules(custom)) merged.set(rule.from, rule.to);
  const rules = [...merged].map(([from, to]) => ({ from, to }))
    .sort((a, b) => b.from.length - a.from.length);
  let result = '';
  for (let index = 0; index < text.length;) {
    const rule = rules.find(candidate => text.startsWith(candidate.from, index));
    if (rule) { result += rule.to; index += rule.from.length; }
    else { result += text[index]; index++; }
  }
  return result;
}
