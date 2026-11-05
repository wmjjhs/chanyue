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
  character?: number;
  paragraphsPreserved?: boolean;
  completed: boolean;
  createdAt: number;
  lastReadAt: number;
  cover: number;
  sample?: boolean;
};

export type Settings = {
  version: 2;
  font: 'song' | 'sans' | 'kai';
  fontSize: number;
  textColor: string;
  lineColor: string;
  pageColor: string;
  speed: number;
  maxLines: number;
  layoutMode: 'semantic' | 'compact' | 'plain';
  cursorColor: string;
  cursorTransparent: boolean;
  cursorThickness: number;
  cursorWords: number;
  cursorMode: 'pointer' | 'trail';
  cursorRow: number;
};

export const fonts = {
  song: '"Songti SC", "STSong", "SimSun", serif',
  sans: '"PingFang SC", "Microsoft YaHei", sans-serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", serif',
};

export const MAX_READING_SPEED = 1600;
export const MIN_FONT_SIZE = 12;
export const MAX_VISIBLE_LINES = 30;
export const MIN_CURSOR_ROW = 2;
export const MAX_CURSOR_WORDS = 50;
export const MAX_CURSOR_THICKNESS = 6;

export const defaultSettings: Settings = {
  version: 2, font: 'song', fontSize: 28, textColor: '#364032',
  lineColor: '#eff1e7', pageColor: '#f7f7f2', speed: 240,
  maxLines: 6, layoutMode: 'semantic', cursorColor: '#7b9259', cursorTransparent: false, cursorThickness: 2, cursorWords: 1, cursorMode: 'pointer', cursorRow: 2,
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
    version: 2,
    font: v.font && Object.hasOwn(fonts, v.font) ? v.font : defaultSettings.font,
    fontSize: number(v.fontSize, MIN_FONT_SIZE, 64, defaultSettings.fontSize),
    speed: v.version === 2 ? number(v.speed, 30, MAX_READING_SPEED, defaultSettings.speed) : defaultSettings.speed,
    textColor: color(v.textColor, defaultSettings.textColor),
    lineColor: color(v.lineColor, defaultSettings.lineColor),
    pageColor: color(v.pageColor, defaultSettings.pageColor),
    maxLines: Math.round(number(v.maxLines, 2, MAX_VISIBLE_LINES, defaultSettings.maxLines)),
    layoutMode: v.layoutMode === 'compact' || v.layoutMode === 'plain' ? v.layoutMode : 'semantic',
    cursorColor: color(v.cursorColor, defaultSettings.cursorColor),
    cursorTransparent: typeof v.cursorTransparent === 'boolean' ? v.cursorTransparent : defaultSettings.cursorTransparent,
    cursorThickness: Math.round(number(v.cursorThickness, 1, MAX_CURSOR_THICKNESS, defaultSettings.cursorThickness)),
    cursorWords: Math.round(number(v.cursorWords, 1, MAX_CURSOR_WORDS, defaultSettings.cursorWords)),
    cursorMode: v.cursorMode === 'trail' ? 'trail' : 'pointer',
    cursorRow: Math.round(number(v.cursorRow, MIN_CURSOR_ROW, MAX_VISIBLE_LINES, defaultSettings.cursorRow)),
  };
}

export function splitLines(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return normalized.split(/\n+/).map(paragraph => paragraph.replace(/[\t \u00a0]+/g, ' ').trim()).filter(Boolean);
}

const lengths = new WeakMap<string[], number>();
export function textLength(lines: string[]): number {
  let length = lengths.get(lines);
  if (length === undefined) {
    length = Math.max(0, lines.reduce((sum, line) => sum + line.length + 1, 0) - 1);
    lengths.set(lines, length);
  }
  return length;
}

export function progressOf(book: Book): number {
  if (book.completed) return 100;
  if (typeof book.character === 'number' && Number.isFinite(book.character)) {
    return Math.max(0, Math.min(99, Math.floor(book.character / Math.max(1, textLength(book.lines)) * 100)));
  }
  return Math.floor(book.line / Math.max(1, book.lines.length) * 100);
}

export function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `book-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readableInk(hex: string): string {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.3 ? '#3e493d' : '#eeeee3';
}
