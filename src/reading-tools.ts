// 版权所有：波哥
export type ContentsEntry = { title: string; source: number; level: number };
export type ReadingNote = { id: string; kind: 'bookmark' | 'excerpt'; start: number; end: number; quote: string; note: string; createdAt: number; updatedAt: number };
export type NoteChange = ({ type: 'put'; value: ReadingNote } | { type: 'remove'; id: string }) & { expected?: string };
export const noteRevision = (note: ReadingNote) => JSON.stringify([note.id, note.kind, note.start, note.end, note.quote, note.note, note.createdAt, note.updatedAt]);
export const MAX_NOTES = 200;
export const MAX_EXCERPT = 2000;
export const MAX_NOTE_TEXT = 500;
export const MAX_CONTENTS = 1000;

export function validateContents(value: unknown, length: number): ContentsEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ContentsEntry[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_CONTENTS)) {
    if (!item || typeof item !== 'object' || typeof item.title !== 'string' || !Number.isInteger(item.source) || item.source < 0 || item.source >= length || !Number.isInteger(item.level)) continue;
    const title = item.title.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
    const key = `${item.source}:${title}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    entries.push({ title, source: item.source, level: Math.max(1, Math.min(9, item.level)) });
  }
  return entries;
}

export function currentContentsIndex(entries: ContentsEntry[], source: number): number {
  let current = -1;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], previous = entries[current];
    if (entry.source <= source && (!previous || entry.source > previous.source || (entry.source === previous.source && entry.level > previous.level))) current = index;
  }
  return current;
}

export function safeBoundary(text: string, value: number, forward = false): number {
  let at = Math.max(0, Math.min(text.length, Math.floor(value)));
  if (at > 0 && at < text.length && /[\uDC00-\uDFFF]/.test(text[at]) && /[\uD800-\uDBFF]/.test(text[at - 1])) at += forward ? 1 : -1;
  return at;
}
export function contextAt(text: string, source: number, radius = 48) {
  const start = safeBoundary(text, source - radius), end = safeBoundary(text, source + radius, true);
  return { start, end, text: text.slice(start, end) };
}
export function excerptContextAt(text: string, from: number, to: number) {
  const start = safeBoundary(text, from - 600);
  const end = safeBoundary(text, Math.max(from + MAX_EXCERPT, to) + 600, true);
  return { start, end, text: text.slice(start, end) };
}
export function excerptAt(text: string, source: number) {
  const at = safeBoundary(text, Math.min(source, text.length - 1));
  let start = at, end = at;
  while (start > 0 && at - start < 250 && !/[。！？.!?\n]/u.test(text[start - 1])) start--;
  while (end < text.length && end - start < 500) { const char = text[end++]; if (/[。！？.!?\n]/u.test(char)) break; }
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  start = safeBoundary(text, start); end = safeBoundary(text, end, true);
  return { start, end, quote: text.slice(start, end) };
}
export type SearchHit = { start: number; end: number; before: string; match: string; after: string };
export function searchBook(text: string, query: string, limit = 200): { hits: SearchHit[]; more: boolean } {
  const needle = query.trim().slice(0, 100);
  if (!needle) return { hits: [], more: false };
  const regex = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const hits: SearchHit[] = [];
  const maximum = Math.max(1, Math.min(200, Math.floor(limit)));
  for (const match of text.matchAll(regex)) {
    if (hits.length >= maximum) return { hits, more: true };
    const start = match.index, end = start + match[0].length;
    hits.push({ start, end, before: text.slice(safeBoundary(text, start - 32), start), match: match[0], after: text.slice(end, safeBoundary(text, end + 48, true)) });
  }
  return { hits, more: false };
}

export function validateNotes(value: unknown, text: string): ReadingNote[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_NOTES) throw new Error('书签数据无法读取，原记录未修改。');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,120}$/.test(item.id) || ids.has(item.id) || !['bookmark', 'excerpt'].includes(item.kind)
      || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end < item.start || item.end > text.length
      || typeof item.quote !== 'string' || item.quote.length > MAX_EXCERPT || typeof item.note !== 'string' || item.note.length > MAX_NOTE_TEXT
      || !Number.isFinite(item.createdAt) || item.createdAt < 0 || !Number.isFinite(item.updatedAt) || item.updatedAt < 0) throw new Error('书签数据无法读取，原记录未修改。');
    if (item.kind === 'excerpt' && (!Number.isInteger(item.start) || !Number.isInteger(item.end) || !item.quote.trim() || item.quote !== text.slice(item.start, item.end) || safeBoundary(text, item.start) !== item.start || safeBoundary(text, item.end) !== item.end)) throw new Error('摘录与原文位置不匹配，原记录未修改。');
    if (item.kind === 'bookmark' && (item.end !== item.start || item.quote !== '')) throw new Error('书签位置无效。');
    ids.add(item.id);
    return { id: item.id, kind: item.kind, start: item.start, end: item.end, quote: item.quote, note: item.note, createdAt: item.createdAt, updatedAt: item.updatedAt };
  });
}
export function changeNotes(current: unknown, change: NoteChange, text: string): ReadingNote[] {
  const notes = validateNotes(current, text);
  const id = change.type === 'remove' ? change.id : change.value.id;
  const existing = notes.findIndex(item => item.id === id);
  if ((change.expected !== undefined && (existing < 0 || noteRevision(notes[existing]) !== change.expected)) || (change.type === 'put' && existing >= 0 && change.expected === undefined)) throw new Error('记录已在其他窗口修改或删除，原记录未修改。请保留草稿内容，关闭后重新打开再编辑。');
  if (change.type === 'remove') return notes.filter(note => note.id !== change.id);
  const [note] = validateNotes([change.value], text);
  if (existing >= 0) notes[existing] = { ...note, createdAt: notes[existing].createdAt };
  else {
    if (notes.some(item => item.kind === note.kind && item.start === note.start && item.end === note.end)) throw new Error('这里已有相同书签或摘录，可编辑已有记录。');
    if (notes.length >= MAX_NOTES) throw new Error('每本最多保存200条，请先删除不需要的记录。');
    notes.push(note);
  }
  return notes.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
