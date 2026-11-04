// 版权所有：波哥
export type BookFormat = 'TXT' | 'WORD' | 'PDF';
export type Book = {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  lines: string[];
  line: number;
  offset: number | null;
  completed: boolean;
  createdAt: number;
  lastReadAt: number;
  cover: number;
  sample?: boolean;
};

export type Settings = {
  font: 'song' | 'sans' | 'kai';
  fontSize: number;
  textColor: string;
  lineColor: string;
  pageColor: string;
  speed: number;
};

export const fonts = {
  song: '"Songti SC", "STSong", "SimSun", serif',
  sans: '"PingFang SC", "Microsoft YaHei", sans-serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", serif',
};

export const MAX_READING_SPEED = 1600;

export const defaultSettings: Settings = {
  font: 'song', fontSize: 32, textColor: '#364032',
  lineColor: '#eff1e7', pageColor: '#f7f7f2', speed: 55,
};

export const themes = [
  { name: '竹间', pageColor: '#f7f7f2', lineColor: '#eff1e7', textColor: '#364032' },
  { name: '暖纸', pageColor: '#f6eee1', lineColor: '#efe3cf', textColor: '#594839' },
  { name: '月白', pageColor: '#f6f8fa', lineColor: '#e9eef3', textColor: '#384653' },
  { name: '夜读', pageColor: '#202722', lineColor: '#2c352e', textColor: '#dfdfcf' },
];

export function validateSettings(value: unknown): Settings {
  const v = value && typeof value === 'object' ? value as Partial<Settings> : {};
  const number = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  const color = (c: unknown, fallback: string) => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c) ? c : fallback;
  return {
    font: v.font && Object.hasOwn(fonts, v.font) ? v.font : defaultSettings.font,
    fontSize: number(v.fontSize, 18, 64, defaultSettings.fontSize),
    speed: number(v.speed, 15, MAX_READING_SPEED, defaultSettings.speed),
    textColor: color(v.textColor, defaultSettings.textColor),
    lineColor: color(v.lineColor, defaultSettings.lineColor),
    pageColor: color(v.pageColor, defaultSettings.pageColor),
  };
}

export function splitLines(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const result: string[] = [];
  for (const paragraph of normalized.split(/\n+/)) {
    const clean = paragraph.replace(/[\t \u00a0]+/g, ' ').trim();
    if (!clean) continue;
    let line = '';
    for (const sentence of clean.match(/[^。！？!?；;]+[。！？!?；;]*|[。！？!?；;]+/gu) ?? [clean]) {
      if (Array.from(line + sentence).length > 80 && line) {
        result.push(line.trim()); line = '';
      }
      const chars = Array.from(sentence);
      let start = 0;
      while (chars.length - start > 100) {
        if (line) { result.push(line.trim()); line = ''; }
        result.push(chars.slice(start, start + 80).join('').trim());
        start += 80;
      }
      line += chars.slice(start).join('');
    }
    if (line.trim()) result.push(line.trim());
  }
  return result.filter(Boolean);
}

export function getFlowWindow(lines: string[], start: number, minCharacters = 2048): string[] {
  let end = start;
  let characters = 0;
  while (end < lines.length && characters < minCharacters) {
    characters += lines[end].length;
    end++;
  }
  return lines.slice(start, end);
}

export function advanceFlow(x: number, widths: number[]): { x: number; passed: number } {
  let passed = 0;
  while (passed < widths.length && x + widths[passed] <= 0) {
    x += widths[passed];
    passed++;
  }
  return { x, passed };
}

export function progressOf(book: Book): number {
  return book.completed ? 100 : Math.floor(book.line / Math.max(1, book.lines.length) * 100);
}

export function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `book-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readableInk(hex: string): string {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.3 ? '#3e493d' : '#eeeee3';
}
