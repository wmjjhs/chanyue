// 版权所有：波哥
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';

const state = vi.hoisted(() => ({ files: new Map<string, string>(), preferences: new Map<string, string>(), exists: false, failWrite: false, failRename: false }));
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
    rename: vi.fn(async ({ from, to }) => {
      if (state.failRename || !state.files.has(from) || state.files.has(to)) throw new Error('rename failed');
      state.files.set(to, state.files.get(from)!); state.files.delete(from);
    }),
  },
}));
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: vi.fn(async ({ key }) => ({ value: state.preferences.get(key) ?? null })),
  keys: vi.fn(async () => ({ keys: [...state.preferences.keys()] })),
  set: vi.fn(async ({ key, value }) => { state.preferences.set(key, value); }),
  remove: vi.fn(async ({ key }) => { state.preferences.delete(key); }),
} }));
import { deleteNativeBook, loadNativeBooks, loadNativeSettings, saveNativeBook, saveNativePosition, saveNativeSettings, loadNativeNotes, mutateNativeNotes } from './native-storage';
import { noteRevision, type ReadingNote } from './reading-tools';
import { Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

beforeEach(() => {
  state.files.clear(); state.preferences.clear(); state.exists = false; state.failWrite = false; state.failRename = false;
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
    const typography = [{ start: 0, end: 2, scale: 2, bold: true }, { start: 3, end: 5, scale: 0.75, bold: false }];
    const book = { ...sampleBooks[0], id: 'import-1', title: '我的书', typography, typographyVersion: 1 as const };
    await saveNativeBook(book);
    vi.mocked(Filesystem.writeFile).mockClear();
    await saveNativePosition({ ...book, line: 2, offset: 0.55, character: 36.375, lastReadAt: 123456 });
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
    await saveNativeBook({ ...book, title: '新书名' });
    expect((await loadNativeBooks()).find(b => b.id === book.id))
      .toMatchObject({ title: '新书名', line: 2, offset: 0.55, character: 36.375, lastReadAt: 123456, typography, typographyVersion: 1 });
  });
  it('删除后不会重新生成示例书', async () => {
    const books = await loadNativeBooks();
    for (const book of books) { await saveNativePosition(book); await deleteNativeBook(book.id); }
    expect(await loadNativeBooks()).toEqual([]);
    expect([...state.preferences.keys()].some(key => key.startsWith('chanyue-position:'))).toBe(false);
  });
  it('原生设置保持12px、30行、停留行、50字窗口与双模式', async () => {
    const settings = { ...defaultSettings, speed: 1600, pageColor: '#123456', fontSize: 12, maxLines: 30, cursorRow: 18, cursorWords: 50, cursorTransparent: true, cursorThickness: 6, cursorColor: '#e5b77b', layoutMode: 'plain' as const };
    for (const cursorMode of ['pointer', 'trail'] as const) {
      for (const ambientSound of ['rain', 'wind', 'stream'] as const) {
        const comfort = { ...settings, cursorMode, ambientSound, ambientEnabled: true, ambientVolume: 0, ambientContinuePaused: false, trailCurrent: 80, trailRecent: 50, trailMinimum: 0, trailFadeLines: 10, trailFadeDuration: 0.8 };
        await saveNativeSettings(comfort);
        expect(await loadNativeSettings()).toEqual(comfort);
      }
    }
  });
  it('磁盘写失败会报告错误，后续队列仍可使用', async () => {
    state.failWrite = true;
    await expect(saveNativeBook(sampleBooks[0])).rejects.toThrow('disk full');
    state.failWrite = false;
    await saveNativeBook(sampleBooks[0]);
    expect(state.files.size).toBe(1);
  });
  it('损坏或越界格式只降级为普通文字，原书和进度仍保留', async () => {
    await loadNativeBooks();
    const book = { ...sampleBooks[0], id: 'invalid-style', character: 5.25, typography: [{ start: -1, end: 999999, scale: 9, bold: true }] };
    await saveNativeBook(book);
    const restored = (await loadNativeBooks()).find(value => value.id === book.id);
    expect(restored).toMatchObject({ lines: book.lines, character: 5.25, typography: [] });
  });
  it('拒绝路径穿越与损坏书籍，不删除原始数据', async () => {
    await expect(saveNativeBook({ ...sampleBooks[0], id: '../invalid' })).rejects.toThrow('无效');
    await loadNativeBooks();
    state.files.set('Chanyue/books/sample-0.json', '{broken');
    await expect(loadNativeBooks()).rejects.toThrow();
    expect(state.files.get('Chanyue/books/sample-0.json')).toBe('{broken');
  });
  it('笔记独立保存并串行合并，不被旧书重命名或进度保存覆盖', async () => {
    const [book, other] = await loadNativeBooks();
    const note: ReadingNote = { id: 'note-1', kind: 'bookmark', start: 1.25, end: 1.25, quote: '', note: '稍后再读', createdAt: 1, updatedAt: 1 };
    expect(await loadNativeNotes(book.id)).toEqual([]);
    await Promise.all([mutateNativeNotes(book.id, { type: 'put', value: note }), mutateNativeNotes(book.id, { type: 'put', value: { ...note, id: 'note-2', start: 2, end: 2 } }), saveNativePosition({ ...book, character: 20 })]);
    await saveNativeBook({ ...book, title: '改名' });
    expect(await loadNativeNotes(book.id)).toHaveLength(2);
    expect(await loadNativeNotes(other.id)).toEqual([]);
    expect(await loadNativeBooks()).toHaveLength(3);
    await mutateNativeNotes(book.id, { type: 'remove', id: note.id });
    expect(await loadNativeNotes(book.id)).toHaveLength(1);
    expect([...state.files.keys()].filter(key => key.includes(`${book.id}.notes.`))).toHaveLength(2);
    await deleteNativeBook(book.id);
    expect([...state.files.keys()].filter(key => key.includes(`${book.id}.notes.`))).toEqual([]);
    await expect(mutateNativeNotes(book.id, { type: 'put', value: note })).rejects.toThrow();
  });
  it('写入或提交失败保留上一有效笔记，重试可恢复，路径与原文校验有效', async () => {
    const [book] = await loadNativeBooks();
    const text = book.lines.join('\n');
    const note: ReadingNote = { id: 'note-1', kind: 'excerpt', start: 0, end: 2, quote: text.slice(0, 2), note: '', createdAt: 1, updatedAt: 1 };
    await mutateNativeNotes(book.id, { type: 'put', value: note });
    state.failWrite = true;
    await expect(mutateNativeNotes(book.id, { type: 'put', expected: noteRevision(note), value: { ...note, note: '不能保存' } })).rejects.toThrow();
    state.failWrite = false; state.failRename = true;
    await expect(mutateNativeNotes(book.id, { type: 'put', expected: noteRevision(note), value: { ...note, note: '不能提交' } })).rejects.toThrow();
    expect(await loadNativeNotes(book.id)).toEqual([note]);
    state.failRename = false;
    const [restored] = await mutateNativeNotes(book.id, { type: 'put', expected: noteRevision(note), value: { ...note, note: '恢复' } });
    expect((await loadNativeNotes(book.id))[0].note).toBe('恢复');
    expect(() => loadNativeNotes('../x')).toThrow();
    await expect(mutateNativeNotes(book.id, { type: 'put', expected: noteRevision(restored), value: { ...restored, quote: '伪造' } })).rejects.toThrow('不匹配');
  });
  it('串行操作仍检查记录快照，过期更新或删除不产生新版本', async () => {
    const [book] = await loadNativeBooks();
    const note: ReadingNote = { id: 'note-1', kind: 'bookmark', start: 1, end: 1, quote: '', note: '', createdAt: 1, updatedAt: 1 };
    await mutateNativeNotes(book.id, { type: 'put', value: note });
    const expected = noteRevision(note);
    const results = await Promise.allSettled([
      mutateNativeNotes(book.id, { type: 'put', expected, value: { ...note, note: '先提交' } }),
      mutateNativeNotes(book.id, { type: 'put', expected, value: { ...note, note: '过期草稿' } }),
      mutateNativeNotes(book.id, { type: 'remove', expected, id: note.id }),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
    const [current] = await loadNativeNotes(book.id);
    expect(current.note).toBe('先提交');
    expect([...state.files.keys()].filter(key => key.includes(`${book.id}.notes.`))).toHaveLength(2);
    await mutateNativeNotes(book.id, { type: 'remove', expected: noteRevision(current), id: note.id });
    await expect(mutateNativeNotes(book.id, { type: 'put', expected, value: note })).rejects.toThrow('其他窗口');
    expect(await loadNativeNotes(book.id)).toEqual([]);
  });
  it('正文删除失败时保留原书、笔记及进度，重试删除可完成', async () => {
    const [book] = await loadNativeBooks();
    const note: ReadingNote = { id: 'note-1', kind: 'bookmark', start: 1, end: 1, quote: '', note: '', createdAt: 1, updatedAt: 1 };
    await mutateNativeNotes(book.id, { type: 'put', value: note });
    await saveNativePosition({ ...book, character: 5.25 });
    const files = new Map(state.files), preferences = new Map(state.preferences);
    vi.mocked(Filesystem.deleteFile).mockRejectedValueOnce(new Error('delete failed'));
    await expect(deleteNativeBook(book.id)).rejects.toThrow('delete failed');
    expect(state.files).toEqual(files); expect(state.preferences).toEqual(preferences);
    expect(await loadNativeNotes(book.id)).toEqual([note]);
    await deleteNativeBook(book.id);
    expect((await loadNativeBooks()).some(item => item.id === book.id)).toBe(false);
    expect([...state.files.keys()].some(key => key.includes(`${book.id}.notes.`))).toBe(false);
  });
  it('正文删除已提交后，孤立笔记及进度清理失败不会阻断书库，重开会重试', async () => {
    const [book, other] = await loadNativeBooks();
    const note: ReadingNote = { id: 'note-1', kind: 'bookmark', start: 1, end: 1, quote: '', note: '', createdAt: 1, updatedAt: 1 };
    await mutateNativeNotes(book.id, { type: 'put', value: note });
    await mutateNativeNotes(other.id, { type: 'put', value: note });
    await saveNativePosition(book); await saveNativePosition(other);
    const remove = vi.mocked(Filesystem.deleteFile);
    remove.mockImplementationOnce(async ({ path }) => { state.files.delete(path); });
    remove.mockRejectedValueOnce(new Error('note cleanup failed'));
    vi.mocked(Preferences.remove).mockRejectedValueOnce(new Error('position cleanup failed'));
    await expect(deleteNativeBook(book.id)).resolves.toBeUndefined();
    expect(state.files.has(`Chanyue/books/${book.id}.json`)).toBe(false);
    expect(state.files.has(`Chanyue/books/${book.id}.notes.1.json`)).toBe(true);
    expect(state.preferences.has(`chanyue-position:${book.id}`)).toBe(true);
    vi.mocked(Preferences.remove).mockRejectedValueOnce(new Error('position cleanup still failed'));
    expect(await loadNativeBooks()).toHaveLength(2);
    expect(state.files.has(`Chanyue/books/${book.id}.notes.1.json`)).toBe(false);
    expect(state.preferences.has(`chanyue-position:${book.id}`)).toBe(true);
    expect(await loadNativeBooks()).toHaveLength(2);
    expect(state.preferences.has(`chanyue-position:${book.id}`)).toBe(false);
    expect(await loadNativeNotes(other.id)).toEqual([note]);
    expect(state.preferences.has(`chanyue-position:${other.id}`)).toBe(true);
  });
  it('损坏笔记不会静默覆盖或阻止原书读取', async () => {
    const [book] = await loadNativeBooks();
    const path = `Chanyue/books/${book.id}.notes.1.json`;
    state.files.set(path, '{broken');
    await expect(loadNativeNotes(book.id)).rejects.toThrow();
    expect(await loadNativeBooks()).toHaveLength(3);
    expect(state.files.get(path)).toBe('{broken');
  });
});
