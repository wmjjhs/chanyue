// 版权所有：波哥
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Book, Settings } from './model';
import { defaultSettings, validateSettings } from './model';
import { sampleBooks } from './samples';
import { Capacitor } from '@capacitor/core';
import { deleteNativeBook, loadNativeBooks, loadNativeSettings, saveNativeBook, saveNativePosition, saveNativeSettings } from './native-storage';

type Position = Pick<Book, 'id' | 'line' | 'offset' | 'character' | 'completed' | 'lastReadAt'>;
interface LibraryDB extends DBSchema {
  books: { key: string; value: Book };
  positions: { key: string; value: Position };
  meta: { key: string; value: boolean };
}
let connection: Promise<IDBPDatabase<LibraryDB>> | undefined;
const database = () => connection ??= openDB<LibraryDB>('chanyue-library', 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    if (!db.objectStoreNames.contains('positions')) db.createObjectStore('positions', { keyPath: 'id' });
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
  return books.map(book => ({ ...book, ...positions.get(book.id) }))
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
    await tx.objectStore('positions').put({ id, line, offset, character, completed, lastReadAt });
  }
  await tx.done;
}

export async function deleteBook(id: string) {
  if (Capacitor.isNativePlatform()) return deleteNativeBook(id);
  const db = await database();
  const tx = db.transaction(['books', 'positions'], 'readwrite');
  await tx.objectStore('books').delete(id);
  await tx.objectStore('positions').delete(id);
  await tx.done;
}

export async function loadSettings(): Promise<Settings> {
  if (Capacitor.isNativePlatform()) return loadNativeSettings();
  try { return validateSettings(JSON.parse(localStorage.getItem('chanyue-settings') ?? 'null')); }
  catch { return { ...defaultSettings }; }
}

export async function saveSettings(settings: Settings) {
  if (Capacitor.isNativePlatform()) return saveNativeSettings(settings);
  localStorage.setItem('chanyue-settings', JSON.stringify(settings));
}
