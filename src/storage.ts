// 版权所有：波哥
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Book, Settings } from './model';
import { defaultSettings, textLength, validateSettings } from './model';
import { validateTypography } from './typography';
import { sampleBooks } from './samples';
import { Capacitor } from '@capacitor/core';
import { deleteNativeBook, loadNativeBooks, loadNativeSettings, saveNativeBook, saveNativePosition, saveNativeSettings, loadNativeNotes, mutateNativeNotes } from './native-storage';
import { changeNotes, validateNotes, validateContents, type ReadingNote, type NoteChange } from './reading-tools';
import { createBackup, validateBackup, validateLocalEntries, planRestore, type Backup, type RestoreResult } from './backup';
import { exportNativeBackup, restoreNativeBackup, saveNativeBookState } from './native-storage';
import { validateBookState, type BookState } from './book-state';

type Position = Pick<Book, 'id' | 'line' | 'offset' | 'character' | 'completed' | 'lastReadAt'> & BookState;
interface LibraryDB extends DBSchema {
  books: { key: string; value: Book };
  positions: { key: string; value: Position };
  meta: { key: string; value: boolean };
  notes: { key: string; value: ReadingNote[] };
}
let connection: Promise<IDBPDatabase<LibraryDB>> | undefined;
const database = () => connection ??= openDB<LibraryDB>('chanyue-library', 3, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    if (!db.objectStoreNames.contains('positions')) db.createObjectStore('positions', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes');
  },
  terminated() { connection = undefined; },
  blocking() { void connection?.then(db => db.close()); connection = undefined; },
}).catch(error => { connection = undefined; throw error; });

export async function loadBooks(): Promise<Book[]> {
  if (Capacitor.isNativePlatform()) return loadNativeBooks();
  const db = await database();
  const tx = db.transaction(['books', 'meta', 'positions'], 'readwrite');
  if (!(await tx.objectStore('meta').get('initialized'))) {
    for (const book of sampleBooks) await tx.objectStore('books').put(book);
    await tx.objectStore('meta').put(true, 'initialized');
  }
  const books = await tx.objectStore('books').getAll();
  const positions = new Map((await tx.objectStore('positions').getAll()).map(position => [position.id, position]));
  await tx.done;
  return books.map(book => ({ ...book, typography: validateTypography(book.typography, textLength(book.lines)), contents: validateContents(book.contents, textLength(book.lines)), ...positions.get(book.id), ...validateBookState({ ...book, ...positions.get(book.id) }, textLength(book.lines)) }))
    .sort((a, b) => b.lastReadAt - a.lastReadAt || a.createdAt - b.createdAt);
}

export async function saveBook(book: Book) {
  if (Capacitor.isNativePlatform()) return saveNativeBook(book);
  const db = await database();
  await db.put('books', book);
}

export async function savePosition(book: Book) {
  if (Capacitor.isNativePlatform()) return saveNativePosition(book);
  const { id, line, offset, character, completed, lastReadAt } = book;
  const db = await database();
  const tx = db.transaction(['books', 'positions'], 'readwrite');
  if (await tx.objectStore('books').count(id)) {
    await tx.objectStore('positions').put({ ...await tx.objectStore('positions').get(id), id, line, offset, character, completed, lastReadAt });
  }
  await tx.done;
}

export async function saveBookState(id: string, change: BookState): Promise<BookState> {
  if (Capacitor.isNativePlatform()) return saveNativeBookState(id, change);
  const db = await database(), tx = db.transaction(['books', 'positions'], 'readwrite');
  try {
    const book = await tx.objectStore('books').get(id);
    if (!book) throw new Error('书籍已删除，使用记录未保存。');
    const previous = await tx.objectStore('positions').get(id) ?? { id, line: book.line, offset: book.offset, character: book.character, completed: book.completed, lastReadAt: book.lastReadAt };
    const state = { ...validateBookState({ ...book, ...previous }, textLength(book.lines)), ...validateBookState(change, textLength(book.lines)) };
    await tx.objectStore('positions').put({ ...previous, ...state });
    await tx.done; return state;
  } catch (error) {
    try { tx.abort(); } catch {}
    await tx.done.catch(() => {}); throw error;
  }
}

export async function deleteBook(id: string) {
  if (Capacitor.isNativePlatform()) return deleteNativeBook(id);
  const db = await database();
  const tx = db.transaction(['books', 'positions', 'notes'], 'readwrite');
  await tx.objectStore('books').delete(id);
  await tx.objectStore('positions').delete(id);
  await tx.objectStore('notes').delete(id);
  await tx.done;
}

export async function loadNotes(id: string): Promise<ReadingNote[]> {
  if (Capacitor.isNativePlatform()) return loadNativeNotes(id);
  const db = await database(), tx = db.transaction(['books', 'notes'], 'readonly');
  const book = await tx.objectStore('books').get(id);
  const value = await tx.objectStore('notes').get(id);
  await tx.done;
  if (!book) throw new Error('书籍已不存在，请返回书架。');
  return validateNotes(value, book.lines.join('\n'));
}
export async function mutateNotes(id: string, change: NoteChange): Promise<ReadingNote[]> {
  if (Capacitor.isNativePlatform()) return mutateNativeNotes(id, change);
  const db = await database(), tx = db.transaction(['books', 'notes'], 'readwrite');
  try {
    const book = await tx.objectStore('books').get(id);
    if (!book) throw new Error('书籍已不存在，请返回书架。');
    const next = changeNotes(await tx.objectStore('notes').get(id), change, book.lines.join('\n'));
    await tx.objectStore('notes').put(next, id);
    await tx.done;
    return next;
  } catch (error) {
    try { tx.abort(); } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}

export async function loadSettings(): Promise<Settings> {
  if (Capacitor.isNativePlatform()) return loadNativeSettings();
  try { return validateSettings(JSON.parse(localStorage.getItem('chanyue-settings') ?? 'null')); }
  catch { return { ...defaultSettings }; }
}

export async function exportBackup(): Promise<Backup> {
  if (Capacitor.isNativePlatform()) return exportNativeBackup();
  const settings = validateSettings(JSON.parse(localStorage.getItem('chanyue-settings') ?? 'null'));
  const db = await database(), tx = db.transaction(['books', 'positions', 'notes'], 'readonly');
  const [books, positions, notes, noteKeys] = await Promise.all([tx.objectStore('books').getAll(), tx.objectStore('positions').getAll(), tx.objectStore('notes').getAll(), tx.objectStore('notes').getAllKeys()]);
  await tx.done;
  const progress = new Map(positions.map(value => [value.id, value])), records = new Map(noteKeys.map((key, index) => [key, notes[index]]));
  return createBackup(books.map(book => ({ book: { ...book, ...progress.get(book.id) }, notes: records.get(book.id) ?? [] })), settings);
}
export async function restoreBackup(value: Backup): Promise<RestoreResult> {
  const backup = validateBackup(value);
  if (Capacitor.isNativePlatform()) return restoreNativeBackup(backup);
  const db = await database(), tx = db.transaction(['books', 'positions', 'notes', 'meta'], 'readwrite');
  try {
    const [books, positions, notes, noteKeys] = await Promise.all([tx.objectStore('books').getAll(), tx.objectStore('positions').getAll(), tx.objectStore('notes').getAll(), tx.objectStore('notes').getAllKeys()]);
    const progress = new Map(positions.map(value => [value.id, value])), records = new Map(noteKeys.map((key, index) => [key, notes[index]]));
    const current = validateLocalEntries(books.map(book => ({ book: { ...book, ...progress.get(book.id) }, notes: records.get(book.id) ?? [] })));
    const { additions, skipped } = planRestore(current, backup.books);
    for (const { book, notes: records } of additions) {
      await tx.objectStore('positions').delete(book.id);
      await tx.objectStore('books').add(book);
      await tx.objectStore('notes').put(records, book.id);
    }
    await tx.objectStore('meta').put(true, 'initialized');
    await tx.done;
    return { added: additions.length, skipped, failed: 0 };
  } catch (error) {
    try { tx.abort(); } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}

export async function saveSettings(settings: Settings) {
  if (Capacitor.isNativePlatform()) return saveNativeSettings(settings);
  localStorage.setItem('chanyue-settings', JSON.stringify(settings));
}
