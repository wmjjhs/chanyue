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
import { exportNativeBackup, restoreNativeBackup, saveNativeBookState } from './native-storage';
import { preferencesFor, type PracticeState } from './book-state';
import { createBackup } from './backup';
import { Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

beforeEach(() => {
  state.files.clear(); state.preferences.clear(); state.exists = false; state.failWrite = false; state.failRename = false;
  vi.clearAllMocks();
});

describe('原生持久化适配器（模拟插件）', () => {
  it('损坏的书籍文件会被拒绝加载', async () => {
    state.preferences.set('chanyue-native-initialized-v1', 'true');
    state.files.set('Chanyue/books/broken.json', JSON.stringify({ id: 'broken', title: '坏书', author: '', format: 'TXT', lines: [], createdAt: 1, cover: 1 }));
    await expect(loadNativeBooks()).rejects.toThrow('书籍数据已损坏');
  });
  it('听读位置与阅读/背诵独立，合并重命名与备份完整保留', async () => {
    const [book, other] = await loadNativeBooks();
    const listening = { source: 4, completed: false, rate: 1.5 };
    await Promise.all([saveNativeBookState(book.id, { listening, readingPreference: preferencesFor(defaultSettings, 'listening') }), saveNativePosition({ ...book, character: 12.5 })]);
    await saveNativeBook({ ...book, title: '听读重命名' });
    expect((await loadNativeBooks()).find(b => b.id === book.id)).toMatchObject({ listening, character: 12.5, readingPreference: { mode: 'listening' } });
    expect((await loadNativeBooks()).find(b => b.id === other.id)?.listening).toBeUndefined();
    const backup = await exportNativeBackup();
    await deleteNativeBook(book.id); await restoreNativeBackup(backup);
    expect((await loadNativeBooks()).find(b => b.title === '听读重命名')).toMatchObject({ listening, character: 12.5 });
  });
  it('每书状态独立保存，旧进度与重命名不覆盖，备份恢复完整往返', async () => {
    const [book, other] = await loadNativeBooks();
    const practice: PracticeState = { source: 5, span: 2, mask: 'hidden', unit: 'paragraph' };
    const readingPreference = preferencesFor({ ...defaultSettings, fontSize: 38, speed: 180 }, 'practice');
    await Promise.all([saveNativeBookState(book.id, { practice }), saveNativePosition({ ...book, character: 5.25 }), saveNativeBookState(book.id, { readingPreference })]);
    await saveNativeBook({ ...book, title: '原书重命名' });
    let saved = (await loadNativeBooks()).find(b => b.id === book.id)!;
    expect(saved).toMatchObject({ practice, readingPreference, character: 5.25, title: '原书重命名' });
    expect((await loadNativeBooks()).find(b => b.id === other.id)?.practice).toBeUndefined();
    const backup = await exportNativeBackup();
    expect(backup.books.find(e => e.book.id === book.id)?.book).toMatchObject({ practice, readingPreference });
    await deleteNativeBook(book.id);
    await expect(saveNativeBookState(book.id, { practice })).rejects.toThrow();
    expect(await restoreNativeBackup(backup)).toEqual({ added: 1, skipped: 2, failed: 0 });
    saved = (await loadNativeBooks()).find(b => b.title === '原书重命名')!;
    await saveNativePosition({ ...saved, character: 10.5 });
    expect((await loadNativeBooks()).find(b => b.id === saved.id)).toMatchObject({ practice, readingPreference, character: 10.5 });
    expect(await restoreNativeBackup(await exportNativeBackup())).toEqual({ added: 0, skipped: 3, failed: 0 });
  });
  it('每书状态写入失败与非法范围不覆盖旧记录，队列仍能重试', async () => {
    const [book] = await loadNativeBooks();
    const practice: PracticeState = { source: 5, span: 1, mask: 'cue', unit: 'paragraph' };
    await saveNativeBookState(book.id, { practice });
    vi.mocked(Preferences.set).mockRejectedValueOnce(new Error('full'));
    await expect(saveNativeBookState(book.id, { practice: { ...practice, source: 10 } })).rejects.toThrow();
    expect((await loadNativeBooks()).find(b => b.id === book.id)?.practice).toEqual(practice);
    await expect(saveNativeBookState(book.id, { practice: { ...practice, source: -1 } })).rejects.toThrow();
    await saveNativeBookState(book.id, { practice: { ...practice, source: 10 } });
    expect((await loadNativeBooks()).find(b => b.id === book.id)?.practice?.source).toBe(10);
  });
  it('备份排在进度写入之后，保留真实小数进度与独立笔记', async () => {
    const [book] = await loadNativeBooks();
    const note: ReadingNote = { id: 'backup-note', kind: 'bookmark', start: 1.5, end: 1.5, quote: '', note: '记住', createdAt: 1, updatedAt: 1 };
    await mutateNativeNotes(book.id, { type: 'put', value: note });
    const saving = saveNativePosition({ ...book, character: 5.25, lastReadAt: 88 });
    const backup = await exportNativeBackup(); await saving;
    expect(backup.books.find(entry => entry.book.id === book.id)).toMatchObject({ book: { character: 5.25, lastReadAt: 88 }, notes: [note] });
    expect(await restoreNativeBackup(backup)).toEqual({ added: 0, skipped: 3, failed: 0 });
  });
  it('恢复不同数据时新增副本且可重复恢复，原正文和笔记不改', async () => {
    const [book] = await loadNativeBooks();
    const original = new Map(state.files);
    const note: ReadingNote = { id: 'backup-note', kind: 'bookmark', start: 1.5, end: 1.5, quote: '', note: '恢复记录', createdAt: 1, updatedAt: 1 };
    const backup = createBackup([{ book: { ...book, character: 5.25 }, notes: [note] }], defaultSettings);
    expect(await restoreNativeBackup(backup)).toEqual({ added: 1, skipped: 0, failed: 0 });
    for (const [key, value] of original) expect(state.files.get(key)).toBe(value);
    const added = (await loadNativeBooks()).find(value => value.id !== book.id && value.character === 5.25)!;
    expect(added).toBeDefined(); expect(await loadNativeNotes(added.id)).toEqual([note]);
    expect(await restoreNativeBackup(backup)).toEqual({ added: 0, skipped: 1, failed: 0 });
    expect(await loadNativeNotes(book.id)).toEqual([]);
  });
  it('恢复提交失败保留旧库，后续重试仍能完成', async () => {
    const [book] = await loadNativeBooks(), original = new Map(state.files);
    const backup = createBackup([{ book: { ...book, title: '新备份' }, notes: [] }], defaultSettings);
    state.failRename = true;
    expect(await restoreNativeBackup(backup)).toEqual({ added: 0, skipped: 0, failed: 1 });
    expect(state.files).toEqual(original);
    state.failRename = false;
    expect(await restoreNativeBackup(backup)).toEqual({ added: 1, skipped: 0, failed: 0 });
  });
  it('逐本提交失败准确报告部分成功，再次恢复跳过已完成项', async () => {
    const [book] = await loadNativeBooks();
    const backup = createBackup([{ book: { ...book, id: 'incoming-1', title: '第一本恢复' }, notes: [] }, { book: { ...book, id: 'incoming-2', title: '第二本恢复' }, notes: [] }], defaultSettings);
    const rename = vi.mocked(Filesystem.rename), implementation = rename.getMockImplementation()!;
    rename.mockImplementationOnce(implementation).mockRejectedValueOnce(new Error('disk error'));
    expect(await restoreNativeBackup(backup)).toEqual({ added: 1, skipped: 0, failed: 1 });
    expect(await loadNativeBooks()).toHaveLength(4);
    expect(await restoreNativeBackup(backup)).toEqual({ added: 1, skipped: 1, failed: 0 });
    expect(await loadNativeBooks()).toHaveLength(5);
  });
  it('恢复回读核验失败时不发布书籍，不生成只有正文没有笔记的副本', async () => {
    const [book] = await loadNativeBooks(), original = new Map(state.files);
    const write = vi.mocked(Filesystem.writeFile), implementation = write.getMockImplementation()!;
    write.mockImplementationOnce(async options => { state.files.set(options.path, 'truncated'); return { uri: options.path }; });
    const backup = createBackup([{ book: { ...book, title: '核验' }, notes: [] }], defaultSettings);
    expect(await restoreNativeBackup(backup)).toEqual({ added: 0, skipped: 0, failed: 1 });
    expect(state.files).toEqual(original);
    write.mockImplementation(implementation);
  });
  it('首次建立书库，重复打开已有目录不会失败', async () => {
    expect(await loadNativeBooks()).toHaveLength(3);
    expect(await loadNativeBooks()).toHaveLength(3);
    expect(Filesystem.writeFile).toHaveBeenCalledTimes(3);
  });
  it('保存正文、轻量进度和重命名后可恢复', async () => {
    await loadNativeBooks();
    const typography = [{ start: 0, end: 2, scale: 2, bold: true, font: 'KaiTi' }, { start: 3, end: 5, scale: 0.75, bold: false, font: 'SimSun' }];
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
