// 版权所有：波哥
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';

const state = vi.hoisted(() => ({ files: new Map<string, string>(), preferences: new Map<string, string>(), exists: false, failWrite: false }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Library: 'LIBRARY' }, Encoding: { UTF8: 'utf8' },
  Filesystem: {
    mkdir: vi.fn(async () => {
      if (state.exists) throw { code: 'OS-PLUG-FILE-0010' };
      state.exists = true;
    }),
    readdir: vi.fn(async () => ({ files: [...state.files.keys()].map(path => ({ name: path.split('/').pop(), type: 'file' })) })),
    writeFile: vi.fn(async ({ path, data }) => {
      if (state.failWrite) throw new Error('disk full');
      state.files.set(path, data); return { uri: path };
    }),
    readFile: vi.fn(async ({ path }) => {
      if (!state.files.has(path)) throw new Error('missing');
      return { data: state.files.get(path) };
    }),
    deleteFile: vi.fn(async ({ path }) => { state.files.delete(path); }),
  },
}));
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: vi.fn(async ({ key }) => ({ value: state.preferences.get(key) ?? null })),
  set: vi.fn(async ({ key, value }) => { state.preferences.set(key, value); }),
  remove: vi.fn(async ({ key }) => { state.preferences.delete(key); }),
} }));
import { deleteNativeBook, loadNativeBooks, loadNativeSettings, saveNativeBook, saveNativePosition, saveNativeSettings } from './native-storage';
import { Filesystem } from '@capacitor/filesystem';

beforeEach(() => {
  state.files.clear(); state.preferences.clear(); state.exists = false; state.failWrite = false;
  vi.clearAllMocks();
});

describe('原生持久化适配器（模拟插件）', () => {
  it('首次建立书库，重复打开已有目录不会失败', async () => {
    expect(await loadNativeBooks()).toHaveLength(3);
    expect(await loadNativeBooks()).toHaveLength(3);
    expect(Filesystem.writeFile).toHaveBeenCalledTimes(3);
  });
  it('保存正文、轻量进度和重命名后可恢复', async () => {
    await loadNativeBooks();
    const book = { ...sampleBooks[0], id: 'import-1', title: '我的书' };
    await saveNativeBook(book);
    vi.mocked(Filesystem.writeFile).mockClear();
    await saveNativePosition({ ...book, line: 2, offset: 0.55, character: 36.375, lastReadAt: 123456 });
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
    await saveNativeBook({ ...book, title: '新书名' });
    expect((await loadNativeBooks()).find(b => b.id === book.id))
      .toMatchObject({ title: '新书名', line: 2, offset: 0.55, character: 36.375, lastReadAt: 123456 });
  });
  it('删除后不会重新生成示例书', async () => {
    const books = await loadNativeBooks();
    for (const book of books) { await saveNativePosition(book); await deleteNativeBook(book.id); }
    expect(await loadNativeBooks()).toEqual([]);
    expect([...state.preferences.keys()].some(key => key.startsWith('chanyue-position:'))).toBe(false);
  });
  it('原生设置保持12px、15行、50字窗口、透明光标与无标点模式', async () => {
    const settings = { ...defaultSettings, speed: 1600, pageColor: '#123456', fontSize: 12, maxLines: 15, cursorWords: 50, cursorTransparent: true, layoutMode: 'plain' as const };
    await saveNativeSettings(settings);
    expect(await loadNativeSettings()).toEqual(settings);
  });
  it('磁盘写失败会报告错误，后续队列仍可使用', async () => {
    state.failWrite = true;
    await expect(saveNativeBook(sampleBooks[0])).rejects.toThrow('disk full');
    state.failWrite = false;
    await saveNativeBook(sampleBooks[0]);
    expect(state.files.size).toBe(1);
  });
  it('拒绝路径穿越与损坏书籍，不删除原始数据', async () => {
    await expect(saveNativeBook({ ...sampleBooks[0], id: '../invalid' })).rejects.toThrow('无效');
    await loadNativeBooks();
    state.files.set('Chanyue/books/sample-0.json', '{broken');
    await expect(loadNativeBooks()).rejects.toThrow();
    expect(state.files.get('Chanyue/books/sample-0.json')).toBe('{broken');
  });
});
