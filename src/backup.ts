// 版权所有：波哥
import { makeId, textLength, validateSettings, type Book, type Settings } from './model';
import { validateNotes, validateContents, type ReadingNote } from './reading-tools';
import { validateTypography } from './typography';
import { validateBookState } from './book-state';

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export type BackupEntry = { book: Book; notes: ReadingNote[] };
export type Backup = { format: 'chanyue-backup'; version: 1; exportedAt: number; settings: Settings; books: BackupEntry[] };
export type RestoreResult = { added: number; skipped: number; failed: number };
const invalid = () => new Error('备份格式不完整、数据损坏或超过支持范围，尚未恢复任何内容。');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
const numeric = (value: unknown, min: number, max: number, integer = false): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw invalid();
  return value;
};
const string = (value: unknown, max: number): string => { if (typeof value !== 'string' || value.length > max) throw invalid(); return value; };
const boolean = (value: unknown): boolean => { if (typeof value !== 'boolean') throw invalid(); return value; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function validateData(value: unknown, limited: boolean): Backup {
  const data = object(value);
  if (data.format !== 'chanyue-backup' || data.version !== 1 || !Array.isArray(data.books) || (limited && data.books.length > 500)) throw invalid();
  const settings = validateSettings(object(data.settings));
  const ids = new Set<string>(); let total = 0;
  const books = data.books.map(raw => {
    const entry = object(raw), b = object(entry.book), id = string(b.id, 120);
    if (!/^[a-zA-Z0-9-]{1,120}$/.test(id) || ids.has(id) || !['TXT', 'WORD', 'PDF'].includes(String(b.format))) throw invalid();
    ids.add(id);
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 2_000_000 || !b.lines.every(line => typeof line === 'string')) throw invalid();
    const lines = b.lines as string[], length = textLength(lines);
    total += length;
    if (!length || length > 2_000_000 || (limited && total > 20_000_000)) throw invalid();
    const typography = validateTypography(b.typography ?? [], length), contents = validateContents(b.contents ?? [], length);
    if (!same(b.typography ?? [], typography) || !same(b.contents ?? [], contents)) throw invalid();
    const title = string(b.title, 500); if (!title.trim()) throw invalid();
    const book: Book = {
      id, title, author: string(b.author, 1000), format: b.format as Book['format'], lines: [...lines],
      line: numeric(b.line, 0, lines.length, true), offset: b.offset === null ? null : numeric(b.offset, 0, 1),
      completed: boolean(b.completed), createdAt: numeric(b.createdAt, 0, Number.MAX_SAFE_INTEGER), lastReadAt: numeric(b.lastReadAt, 0, Number.MAX_SAFE_INTEGER), cover: numeric(b.cover, 0, 1000, true),
      typography, contents, ...validateBookState(b, length),
    };
    if (b.character !== undefined) book.character = numeric(b.character, 0, length);
    if (b.paragraphsPreserved !== undefined) book.paragraphsPreserved = boolean(b.paragraphsPreserved);
    if (b.sample !== undefined) book.sample = boolean(b.sample);
    if (b.typographyVersion !== undefined) { if (b.typographyVersion !== 1) throw invalid(); book.typographyVersion = 1; }
    if (!Array.isArray(entry.notes)) throw invalid();
    return { book, notes: validateNotes(entry.notes, lines.join('\n')) };
  });
  return { format: 'chanyue-backup', version: 1, exportedAt: numeric(data.exportedAt, 0, Number.MAX_SAFE_INTEGER), settings, books };
}

export function validateBackup(value: unknown): Backup { return validateData(value, true); }
export function validateLocalEntries(books: BackupEntry[]): BackupEntry[] {
  return validateData({ format: 'chanyue-backup', version: 1, exportedAt: 0, settings: {}, books }, false).books;
}
export function parseBackup(text: string): Backup {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('备份超过100 MB，请使用较小的备份。');
  let parsed: unknown;
  try { parsed = JSON.parse(text, (key, value) => { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw invalid(); return value; }); }
  catch { throw invalid(); }
  return validateBackup(parsed);
}
export function createBackup(books: BackupEntry[], settings: Settings): Backup {
  return validateBackup({ format: 'chanyue-backup', version: 1, exportedAt: Date.now(), books, settings });
}
export function encodeBackup(backup: Backup): string {
  const text = JSON.stringify({ _copyright: '版权所有：波哥', ...validateBackup(backup) });
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('书库备份超过100 MB，本次未导出，请先拆分书库。');
  return text;
}
function identity(entry: BackupEntry): string {
  const { id: _id, ...book } = entry.book;
  return JSON.stringify({ book, notes: [...entry.notes].sort((a, b) => a.id.localeCompare(b.id)) });
}
export function planRestore(current: BackupEntry[], incoming: BackupEntry[]) {
  const known = new Set(current.map(identity)), ids = new Set(current.map(item => item.book.id));
  const additions: BackupEntry[] = []; let skipped = 0;
  for (const entry of incoming) {
    const key = identity(entry);
    if (known.has(key)) { skipped++; continue; }
    let id = entry.book.id;
    while (ids.has(id)) id = makeId();
    ids.add(id); known.add(key);
    additions.push({ book: { ...entry.book, id }, notes: entry.notes });
  }
  return { additions, skipped };
}
