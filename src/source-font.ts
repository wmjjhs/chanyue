// 版权所有：波哥
export function validateSourceFont(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().replace(/^@/, '');
  return name.length > 0 && name.length <= 100 && /^[\p{L}\p{N} _().\-]+$/u.test(name) ? name : undefined;
}

export function sourceFontFamily(value: string | undefined): string | undefined {
  const font = validateSourceFont(value);
  if (!font) return undefined;
  const key = font.toLowerCase();
  let fallback: string;
  if (/楷|楷體|kaiti|kaiu|dfkai/.test(key)) fallback = '"Kaiti SC", "Kaiti TC", "STKaiti", "KaiTi", "DFKai-SB", cursive';
  else if (/仿宋|fangsong/.test(key)) fallback = '"STFangsong", "FangSong", "Songti SC", "Noto Serif CJK SC", serif';
  else if (/宋|宋體|明|song|simsun|ming|serif|times|cambria|georgia/.test(key) && !/sans/.test(key)) fallback = '"Songti SC", "Songti TC", "STSong", "SimSun", "Noto Serif CJK SC", "Noto Serif CJK", serif';
  else if (/黑|黑體|雅黑|正黑|苹方|蘋方|heiti|yahei|jhenghei|pingfang|sans|arial|calibri|aptos|helvetica|dengxian|等线/.test(key)) fallback = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  else if (/mono|courier|consolas|等宽/.test(key)) fallback = 'monospace';
  else fallback = 'serif';
  return `"${font}", ${fallback}`;
}
