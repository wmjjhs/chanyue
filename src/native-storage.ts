// 版权所有：波哥
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { validateSettings, type Book, type Settings } from './model';
import { sampleBooks } from './samples';

const directory = Directory.Library;
const root = 'Chanyue/books';
const initializedKey = 'chanyue-native-initialized-v1';
const settingsKey = 'chanyue-settings';
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
};
const pathFor = (id: string) => {
  if (!/^[a-zA-Z0-9-]{1,120}$/.test(id)) throw new Error('无效的书籍标识。');
  return `${root}/${id}.json`;
};
const positionKey = (id: string) => `chanyue-position:${id}`;

function parseBook(data: string, id: string): Book {
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object') throw new Error('书籍数据已损坏。');
  const book = value as Book;
  if (book.id !== id || typeof book.title !== 'string' || typeof book.author !== 'string' ||
    !['TXT', 'WORD', 'PDF'].includes(book.format) || !Array.isArray(book.lines) || !book.lines.length ||
    book.lines.some(line => typeof line !== 'string') || !Number.isFinite(book.createdAt) || !Number.isInteger(book.cover)) {
    throw new Error('书籍数据已损坏。');
  }
  return book;
}

function mergePosition(book: Book, position: Partial<Book>): Book {
  return {
    ...book,
    line: Number.isInteger(position.line) ? Math.max(0, Math.min(book.lines.length - 1, position.line!)) : 0,
    offset: typeof position.offset === 'number' && Number.isFinite(position.offset) ? Math.max(0, Math.min(1, position.offset)) : null,
    character: typeof position.character === 'number' && Number.isFinite(position.character) ? Math.max(0, position.character) : undefined,
    completed: position.completed === true,
    lastReadAt: typeof position.lastReadAt === 'number' && Number.isFinite(position.lastReadAt) ? position.lastReadAt : 0,
  };
}

async function writeBook(book: Book) {
  await Filesystem.writeFile({ directory, path: pathFor(book.id), data: JSON.stringify(book), encoding: Encoding.UTF8, recursive: true });
}

export function loadNativeBooks(): Promise<Book[]> {
  return serial(async () => {
    try { await Filesystem.mkdir({ directory, path: root, recursive: true }); }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'OS-PLUG-FILE-0010') throw error;
    }
    if (!(await Preferences.get({ key: initializedKey })).value) {
      const existing = new Set((await Filesystem.readdir({ directory, path: root })).files.map(file => file.name));
      for (const book of sampleBooks) {
        if (!existing.has(`${book.id}.json`)) await writeBook(book);
      }
      await Preferences.set({ key: initializedKey, value: 'true' });
    }
    const books: Book[] = [];
    for (const file of (await Filesystem.readdir({ directory, path: root })).files) {
      if (file.type !== 'file' || !/^[a-zA-Z0-9-]{1,120}\.json$/.test(file.name)) continue;
      const id = file.name.slice(0, -5);
      const { data } = await Filesystem.readFile({ directory, path: pathFor(id), encoding: Encoding.UTF8 });
      if (typeof data !== 'string') throw new Error('无法读取本机书籍。');
      const book = parseBook(data, id);
      const saved = (await Preferences.get({ key: positionKey(id) })).value;
      const position: unknown = saved ? JSON.parse(saved) : book;
      books.push(mergePosition(book, position && typeof position === 'object' ? position as Partial<Book> : book));
    }
    return books.sort((a, b) => b.lastReadAt - a.lastReadAt || a.createdAt - b.createdAt);
  });
}

export function saveNativeBook(book: Book) {
  return serial(() => writeBook(book));
}

export function saveNativePosition({ id, line, offset, character, completed, lastReadAt }: Book) {
  pathFor(id);
  return serial(() => Preferences.set({ key: positionKey(id), value: JSON.stringify({ line, offset, character, completed, lastReadAt }) }));
}

export function deleteNativeBook(id: string) {
  return serial(async () => {
    await Filesystem.deleteFile({ directory, path: pathFor(id) });
    await Preferences.remove({ key: positionKey(id) });
  });
}

export async function loadNativeSettings(): Promise<Settings> {
  const { value } = await Preferences.get({ key: settingsKey });
  return validateSettings(value ? JSON.parse(value) : null);
}

export function saveNativeSettings(settings: Settings) {
  return serial(() => Preferences.set({ key: settingsKey, value: JSON.stringify(validateSettings(settings)) }));
}
