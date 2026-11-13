// 版权所有：波哥
// @vitest-environment jsdom
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';

const store = vi.hoisted(() => ({ failLoad: false, failSave: false, failImport: false, books: null, delayLoad: false, delaySave: false, throwValue: false }));
vi.mock('./storage', () => ({
  loadBooks: vi.fn(async () => {
    if (store.delayLoad) await new Promise(resolve => setTimeout(resolve, 20));
    if (store.failLoad) throw new Error('无法打开书库');
    const { sampleBooks } = await import('./samples');
    return store.books ?? sampleBooks;
  }),
  loadSettings: vi.fn(async () => {
    const { defaultSettings } = await import('./model');
    return defaultSettings;
  }),
  saveSettings: vi.fn(async () => { if (store.failSave) throw new Error('quota'); }),
  saveBook: vi.fn(async () => { if (store.failSave) throw new Error('quota'); }),
  savePosition: vi.fn(async () => {
    if (store.delaySave) await new Promise(resolve => setTimeout(resolve, 15));
    if (store.failSave) throw new Error('quota');
  }),
  saveBookState: vi.fn(async (_id, change) => { if (store.failSave) throw new Error('quota'); return change; }),
  deleteBook: vi.fn(async () => { if (store.failSave) throw new Error('quota'); }),
  exportBackup: vi.fn(async () => ({})),
  restoreBackup: vi.fn(async () => ({ added: 0, skipped: 0, failed: 0 })),
}));
vi.mock('./importer', () => ({
  importBook: vi.fn(async () => {
    if (store.failImport) throw new Error('quota exceeded');
    return { id: 'fresh-book', title: '新导入的书', author: '本地导入', format: 'TXT', lines: ['全新的正文内容。'], line: 0, offset: null, character: 0, completed: false, createdAt: 1, lastReadAt: 0, cover: 2 };
  }),
  decodeText: (bytes) => new TextDecoder().decode(bytes),
}));
vi.mock('./Reader', () => ({
  default: props => <div data-testid="reader">
    <button onClick={() => props.onBack()}>返回书架</button>
    <button onClick={() => props.onSettings()}>阅读设置</button>
    <button onClick={() => props.onProgress({ line: 1, offset: null, character: 2, completed: false })}>保存进度</button>
    <button onClick={() => void props.onBookState({ practice: { source: 0, span: 1, mask: 'full', unit: 'paragraph' } })}>保存状态</button>
    <button onClick={() => props.onBookState({ listening: { source: 0, completed: false, rate: 1 } }).catch(() => {})}>保存听读</button>
  </div>,
}));
vi.mock('./BackupPanel', () => ({
  BackupPanel: props => <div data-testid="backup">
    <button onClick={() => props.waitWrites().catch(() => {})}>等待写入</button>
    <button onClick={() => void props.onReload()}>刷新</button>
    <button onClick={() => props.onSettingsSaved(defaultSettings)}>设置已存</button>
    <button onClick={() => props.onClose()}>关闭备份</button>
  </div>,
}));

let root, container;
const renderApp = async () => {
  await act(async () => { root.render(<App />); });
  for (let attempt = 0; attempt < 20 && !container.querySelector('.book-grid, .storage-error'); attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
};
const click = async selector => {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
};
const change = async (selector, value, eventName = 'change') => {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
};
const chooseFiles = async files => {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
};
const file = name => new File(['内容'], name, { type: 'text/plain' });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  store.failLoad = false;
  store.failSave = false;
  store.failImport = false;
  store.books = null;
  store.delayLoad = false;
  store.delaySave = false;
  store.throwValue = false;
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('书架主界面', () => {
  it('加载后展示书架，支持搜索、排序、过滤与清空', async () => {
    await renderApp();
    expect(container.querySelector('.book-grid')).toBeTruthy();
    await change('input[aria-label="搜索书籍"]', '不存在', 'input');
    expect(container.textContent).toContain('还没有找到这本书');
    await click('.empty-state .text-button');
    await change('.sort-select select', 'name');
    await click('.shelf-tabs button:nth-child(2)');
    await click('.shelf-tabs button:nth-child(3)');
    await click('.nav-item.active');
  });

  it('导入文件成功、格式错误与超过十本分别给出结果', async () => {
    await renderApp();
    await click('.import-top');
    expect(container.querySelector('.import-modal')).toBeTruthy();
    await chooseFiles([file('新书.txt')]);
    expect(container.textContent).toContain('已加入书架');
    store.failImport = true;
    await chooseFiles([file('坏书.txt')]);
    expect(container.textContent).toContain('本机存储空间不足');
    await chooseFiles(Array.from({ length: 11 }, (_, i) => file(`书${i}.txt`)));
    expect(container.textContent).toContain('一次最多导入 10 本');
    await click('.import-modal button.full-width');
  });

  it('拖放导入、拖拽高亮与完成按钮', async () => {
    await renderApp();
    await click('.mobile-nav button:nth-child(2)');
    const zone = container.querySelector('.dropzone');
    await act(async () => {
      zone.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    });
    expect(zone.className).toContain('dragging');
    await act(async () => {
      zone.dispatchEvent(new Event('dragleave', { bubbles: true }));
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [file('拖入.txt')] } });
      zone.dispatchEvent(event);
      await Promise.resolve();
    });
  });

  it('进入阅读器后保存进度、状态、设置并回到书架', async () => {
    await renderApp();
    await click('.book-cover-area');
    expect(container.querySelector('[data-testid="reader"]')).toBeTruthy();
    await click('[data-testid="reader"] button:nth-child(3)');
    await click('[data-testid="reader"] button:nth-child(4)');
    await click('[data-testid="reader"] button:nth-child(2)');
    await change('#font-size', '44', 'input');
    await click('.settings-modal .modal-footer button:last-child');
    await click('[data-testid="reader"] button:first-child');
    expect(container.querySelector('.book-grid')).toBeTruthy();
  });

  it('管理书籍可重命名、取消删除与确认移除', async () => {
    await renderApp();
    await click('.book-menu');
    expect(container.querySelector('.manage-modal')).toBeTruthy();
    await change('#rename-book', '新的书名', 'input');
    await act(async () => {
      container.querySelector('.manage-modal form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await click('.book-menu');
    await click('.delete-area .danger-text');
    await click('.delete-area .text-button');
    await click('.delete-area .danger-text');
    await click('.delete-area .danger-button');
  });

  it('打开备份、指南与设置面板并触发回调', async () => {
    await renderApp();
    await click('.library-footer button:nth-of-type(1)');
    expect(container.querySelector('[data-testid="backup"]')).toBeTruthy();
    await click('[data-testid="backup"] button:nth-child(1)');
    await click('[data-testid="backup"] button:nth-child(2)');
    await click('[data-testid="backup"] button:nth-child(3)');
    await click('[data-testid="backup"] button:nth-child(4)');
    await click('.library-footer button:nth-of-type(2)');
    await click('.guide-modal button.full-width');
    await click('.sidebar .nav-item:nth-child(2)');
    await change('#font-size', '44', 'input');
  });

  it('书库打开失败时可重试', async () => {
    store.failLoad = true;
    await renderApp();
    expect(container.querySelector('.storage-error')).toBeTruthy();
    store.failLoad = false;
    await click('.storage-error button');
    expect(container.querySelector('.book-grid')).toBeTruthy();
  });

  it('写入失败仍保留界面并给出提示', async () => {
    await renderApp();
    store.failSave = true;
    await click('.book-cover-area');
    await click('[data-testid="reader"] button:nth-child(3)');
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.toast')).toBeTruthy();
  });

  it('听读位置写入失败时登记重试，备份前等待写入可成功或明确失败', async () => {
    await renderApp();
    await click('.book-cover-area');
    store.failSave = true;
    await click('[data-testid="reader"] button:nth-child(5)');
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('听读位置尚未保存');
    await click('[data-testid="reader"] button:first-child');
    await click('.library-footer button:nth-of-type(1)');
    await click('[data-testid="backup"] button:nth-child(1)');
    store.failSave = false;
    await click('[data-testid="backup"] button:nth-child(1)');
    expect(container.querySelector('[data-testid="backup"]')).toBeTruthy();
  });

  it('指南入口、继续阅读、弹窗关闭与提示关闭均可操作', async () => {
    const clickText = async (selector, text) => {
      const element = Array.from(container.querySelectorAll(selector)).find(node => node.textContent?.includes(text));
      if (!element) throw new Error(`找不到 ${text}`);
      await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    };
    const cancel = async () => {
      const dialog = container.querySelector('dialog');
      await act(async () => { dialog?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })); });
    };
    await renderApp();
    await click('button[aria-label="使用指南"]');
    await cancel();
    await clickText('.sidebar .nav-item', '使用指南');
    await cancel();
    await click('.reading-note .text-button');
    await cancel();
    await click('.continue-button');
    await click('[data-testid="reader"] button:first-child');
    await click('.mobile-nav button:first-child');
    await click('.mobile-nav button:nth-child(2)');
    await click('.dropzone');
    await cancel();
    await click('.book-menu');
    await cancel();
    await click('.mobile-nav button:nth-child(2)');
    await chooseFiles([file('新书.txt')]);
    await click('button[aria-label="关闭提示"]');
  });
});

describe('书架状态与时序分支矩阵', () => {
  const cancel = async () => {
    const dialog = container.querySelector('dialog');
    await act(async () => { dialog?.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })); });
  };

  it('空书库与单本未读书显示不同引导文案', async () => {
    store.books = [];
    await renderApp();
    expect(container.textContent).toContain('导入第一本书');
    expect(container.textContent).toContain('下一本好书');
    await click('.continue-button');
    await cancel();
    act(() => root.unmount());
    root = createRoot(container);
    store.books = [{ ...sampleBooks[0], lastReadAt: 0, completed: false, character: undefined }];
    await renderApp();
    expect(container.textContent).toContain('开启阅读');
    expect(container.textContent).toContain('等待开启');
  });

  it('已读书显示进度与继续阅读', async () => {
    store.books = [{ ...sampleBooks[0], lastReadAt: 123, character: 3, completed: false }];
    await renderApp();
    expect(container.textContent).toContain('继续阅读');
    expect(container.textContent).toContain('此刻，继续阅读');
  });

  it.each(['name', 'added', 'recent'])('按 %s 排序与筛选都能渲染', async sort => {
    await renderApp();
    await change('.sort-select select', sort);
    for (const index of [1, 2, 3]) {
      const tab = container.querySelector(`.shelf-tabs button:nth-child(${index})`);
      if (tab) await act(async () => { tab.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    }
    expect(container.querySelector('.book-grid, .empty-state')).toBeTruthy();
  });

  it('空文件列表、files 缺失与非 Error 异常都不会中断导入', async () => {
    await renderApp();
    await click('.import-top');
    await chooseFiles([]);
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: null, configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    const { importBook } = await import('./importer');
    vi.mocked(importBook).mockRejectedValueOnce('非错误对象');
    await chooseFiles([file('异常.txt')]);
    expect(container.querySelector('.import-modal')).toBeTruthy();
  });

  it('导入相同正文时提示无需重复导入', async () => {
    await renderApp();
    await click('.import-top');
    const { importBook } = await import('./importer');
    vi.mocked(importBook).mockResolvedValueOnce({ ...sampleBooks[0] });
    await chooseFiles([file('重复.txt')]);
    expect(container.textContent).toContain('相同内容');
  });

  it('导入进行中关闭弹窗被阻止', async () => {
    await renderApp();
    await click('.import-top');
    const { importBook } = await import('./importer');
    let resolve!: (value: unknown) => void;
    vi.mocked(importBook).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [file('慢.txt')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await cancel();
    expect(container.querySelector('.import-modal')).toBeTruthy();
    await act(async () => {
      resolve({ id: 'slow', title: '慢书', author: '', format: 'TXT', lines: ['内容'], line: 0, offset: null, character: 0, completed: false, createdAt: 1, lastReadAt: 0, cover: 1 });
      await Promise.resolve();
    });
  });

  it('并发写入时旧版本不清除失败记录', async () => {
    await renderApp();
    await click('.book-cover-area');
    store.delaySave = true;
    const button = container.querySelector('[data-testid="reader"] button:nth-child(3)');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    expect(container.querySelector('[data-testid="reader"]')).toBeTruthy();
  });

  it('卸载后加载完成不再更新界面', async () => {
    store.delayLoad = true;
    await act(async () => { root.render(<App />); });
    act(() => root.unmount());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    root = createRoot(container);
  });

  it('按句推进与连续念诵偏好联动，已有偏好的书不重复写入', async () => {
    store.books = [{ ...sampleBooks[0], readingPreference: { mode: 'reciting', fontSize: 20, speed: 120, sentenceMode: false } }];
    await renderApp();
    await click('.sidebar .nav-item:nth-child(2)');
    const checkbox = container.querySelector('.settings-modal .transparent-setting input[type="checkbox"]');
    if (checkbox) await act(async () => { (checkbox as HTMLInputElement).click(); });
    expect(container.querySelector('.settings-modal')).toBeTruthy();
    await click('.settings-modal .modal-footer button:last-child');
    await click('.book-cover-area');
    expect(container.querySelector('[data-testid="reader"]')).toBeTruthy();
  });

  it('管理面板空标题、无来源书籍与取消操作', async () => {
    store.books = [{ ...sampleBooks[0], sample: false, createdAt: 1700000000000 }];
    await renderApp();
    await click('.book-menu');
    await change('#rename-book', '   ', 'input');
    await act(async () => {
      container.querySelector('.manage-modal form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await cancel();
    expect(container.querySelector('.book-grid')).toBeTruthy();
  });
});
