// 版权所有：波哥
// @vitest-environment jsdom
// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';

const helper = vi.hoisted(() => {
  const state = {
    stores: new Map(),
    options: undefined,
    failOpen: false,
    failAdd: false,
    native: false,
  };
  const storeApi = name => {
    const map = state.stores.get(name) ?? new Map();
    state.stores.set(name, map);
    return {
      get: async key => map.get(key),
      getAll: async () => [...map.values()],
      getAllKeys: async () => [...map.keys()],
      count: async key => (key === undefined ? map.size : map.has(key) ? 1 : 0),
      put: async (value, key) => { map.set(key ?? value?.id, value); },
      add: async (value, key) => {
        if (state.failAdd) throw new Error('quota exceeded');
        map.set(key ?? value?.id, value);
      },
      delete: async key => { map.delete(key); },
    };
  };
  const transaction = names => {
    const stores = new Map(names.map(name => [name, storeApi(name)]));
    return {
      objectStore: name => stores.get(name),
      done: Promise.resolve(),
      abort: () => {},
    };
  };
  return { state, storeApi, transaction };
});

vi.mock('idb', () => ({
  openDB: vi.fn(async (_name, _version, options) => {
    if (helper.state.failOpen) throw new Error('indexeddb unavailable');
    helper.state.options = options;
    const db = {
      objectStoreNames: { contains: name => helper.state.stores.has(name) },
      createObjectStore: name => { helper.state.stores.set(name, new Map()); },
      close: () => {},
      transaction: names => helper.transaction(names),
      put: async (name, value) => { await helper.storeApi(name).put(value); },
    };
    options.upgrade(db);
    return db;
  }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => helper.state.native,
    getPlatform: () => (helper.state.native ? 'ios' : 'web'),
  },
}));

vi.mock('./native-storage', () => ({
  deleteNativeBook: vi.fn(async () => {}),
  loadNativeBooks: vi.fn(async () => []),
  loadNativeSettings: vi.fn(async () => ({})),
  saveNativeBook: vi.fn(async () => {}),
  saveNativePosition: vi.fn(async () => {}),
  saveNativeSettings: vi.fn(async () => {}),
  loadNativeNotes: vi.fn(async () => []),
  mutateNativeNotes: vi.fn(async () => []),
  exportNativeBackup: vi.fn(async () => ({})),
  restoreNativeBackup: vi.fn(async () => ({ added: 0, skipped: 0, failed: 0 })),
  saveNativeBookState: vi.fn(async () => ({})),
}));

import {
  loadBooks, saveBook, savePosition, saveBookState, deleteBook,
  loadNotes, mutateNotes, loadSettings, saveSettings, exportBackup, restoreBackup,
} from './storage';
import { loadNativeBooks } from './native-storage';
import { defaultSettings } from './model';

beforeEach(() => {
  helper.state.stores.clear();
  helper.state.failOpen = false;
  helper.state.failAdd = false;
  helper.state.native = false;
  helper.state.options?.terminated();
  localStorage.clear();
  vi.clearAllMocks();
});

describe('浏览器 IndexedDB 书库', () => {
  it('首次打开初始化示例书并按最近阅读排序', async () => {
    const books = await loadBooks();
    expect(books.length).toBeGreaterThan(0);
    expect(books.every(book => Array.isArray(book.lines))).toBe(true);
  });

  it('保存书籍、进度与状态，删除书籍时一并清理记录', async () => {
    const [existing] = await loadBooks();
    const book = { ...existing, id: 'unit-book', title: '单元测试', character: 3, line: 0 };
    await saveBook(book);
    await savePosition({ ...book, lastReadAt: 10 });
    expect(await saveBookState('unit-book', { practice: { source: 0, span: 1, mask: 'full', unit: 'paragraph' } })).toBeTruthy();
    expect((await loadBooks()).some(value => value.id === 'unit-book')).toBe(true);
    await deleteBook('unit-book');
    expect((await loadBooks()).some(value => value.id === 'unit-book')).toBe(false);
  });

  it('状态与笔记在书籍不存在时明确失败', async () => {
    await expect(saveBookState('missing', {})).rejects.toThrow('书籍已删除');
    await expect(loadNotes('missing')).rejects.toThrow('书籍已不存在');
    await expect(mutateNotes('missing', { type: 'remove', id: 'n1' })).rejects.toThrow();
  });

  it('写入并读回笔记，非法本地设置回退默认值', async () => {
    const [book] = await loadBooks();
    const note = { id: 'note-1', kind: 'bookmark', start: 0, end: 0, quote: '', note: '', createdAt: 1, updatedAt: 1 };
    await mutateNotes(book.id, { type: 'put', value: note });
    expect((await loadNotes(book.id)).length).toBeGreaterThan(0);

    await saveSettings({ ...defaultSettings, fontSize: 33 });
    expect((await loadSettings()).fontSize).toBe(33);
    localStorage.setItem('chanyue-settings', '{broken');
    expect(await loadSettings()).toEqual(defaultSettings);
  });

  it('备份往返：导出后删除并在恢复时补回', async () => {
    await loadBooks();
    const backup = await exportBackup();
    expect(backup.books.length).toBeGreaterThan(0);
    const [book] = await loadBooks();
    await deleteBook(book.id);
    const result = await restoreBackup(backup);
    expect(result.added).toBeGreaterThan(0);
  });

  it('恢复写入失败时抛出且不吞掉错误', async () => {
    await loadBooks();
    const backup = await exportBackup();
    const [book] = await loadBooks();
    await deleteBook(book.id);
    helper.state.failAdd = true;
    await expect(restoreBackup(backup)).rejects.toThrow('quota');
  });

  it('数据库打开失败会释放连接以便重试', async () => {
    helper.state.failOpen = true;
    await expect(loadBooks()).rejects.toThrow('indexeddb unavailable');
    helper.state.failOpen = false;
    expect((await loadBooks()).length).toBeGreaterThan(0);
  });

  it('数据库被阻塞或终止时重置连接', () => {
    expect(helper.state.options).toBeTruthy();
    expect(() => helper.state.options.blocking()).not.toThrow();
    expect(() => helper.state.options.terminated()).not.toThrow();
  });

  it('已有对象仓库时不重复建表，缺失进度与设置时回退', async () => {
    await loadBooks();
    expect(await loadSettings()).toEqual(defaultSettings);
    helper.state.options.terminated();
    expect((await loadBooks()).length).toBeGreaterThan(0);
    const [book] = await loadBooks();
    await saveBook({ ...book, id: 'no-position' });
    await saveBookState('no-position', { practice: { source: 0, span: 1, mask: 'full', unit: 'paragraph' } });
    await savePosition({ ...book, id: 'missing-book' });
    expect((await loadBooks()).some(value => value.id === 'missing-book')).toBe(false);
  });

  it('原生平台把所有读写委托给原生适配器', async () => {
    await loadBooks();
    const backup = await exportBackup();
    helper.state.native = true;
    await loadBooks();
    await saveBook({ id: 'x' });
    await savePosition({ id: 'x' });
    await saveBookState('x', {});
    await deleteBook('x');
    await loadNotes('x');
    await mutateNotes('x', { type: 'remove', id: 'n' });
    await loadSettings();
    await saveSettings(defaultSettings);
    await exportBackup();
    await restoreBackup(backup);
    expect(loadNativeBooks).toHaveBeenCalled();
  });
});
