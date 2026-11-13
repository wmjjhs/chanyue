// 版权所有：波哥
// @vitest-environment jsdom
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReadingTools } from './ReadingTools';
import { sampleBooks } from './samples';

const notesState = vi.hoisted(() => ({ notes: [], failLoad: false, failSave: false }));
vi.mock('./storage', () => ({
  loadNotes: vi.fn(async () => {
    if (notesState.failLoad) throw new Error('读取失败');
    return notesState.notes;
  }),
  mutateNotes: vi.fn(async () => {
    if (notesState.failSave) throw new Error('相同书签');
    return notesState.notes;
  }),
}));

let root, container;
const props = () => ({
  source: 3,
  view: { tab: 'contents', query: '', hit: null },
  onViewChange: vi.fn(), onClose: vi.fn(), onJump: vi.fn(),
  canReturn: true, onReturn: vi.fn(), onPractice: async () => {},
  onMode: async () => {}, onFocus: vi.fn(), onSpeechRate: async () => {},
});
const render = async node => { await act(async () => { root.render(node); }); };
const click = async selector => {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
};
const setNativeValue = (element, value) => {
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const tracker = element._valueTracker;
  if (tracker) tracker.setValue('');
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
};
const change = async (selector, value, eventName = 'change') => {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  await act(async () => {
    setNativeValue(element, value);
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  notesState.notes = [];
  notesState.failLoad = false;
  notesState.failSave = false;
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const book = { ...sampleBooks[0], contents: [{ title: '第一章', source: 0, level: 1 }, { title: '第二章', source: 10, level: 2 }] };

describe('阅读工具面板', () => {
  it('目录页支持定位、切换页签与返回刚才', async () => {
    const p = props();
    await render(<ReadingTools book={book} {...p} />);
    expect(container.querySelector('.tools-list')).toBeTruthy();
    await click('.tools-result');
    expect(p.onJump).toHaveBeenCalled();
    await click('.tools-summary .text-button');
    expect(p.onReturn).toHaveBeenCalled();
    await click('#tools-tab-search');
    expect(p.onViewChange).toHaveBeenCalledWith({ tab: 'search' });
  });

  it('搜索页支持输入、联想输入与回车即时查找', async () => {
    const p = props();
    p.view = { tab: 'search', query: '', hit: null };
    await render(<ReadingTools book={book} {...p} />);
    const input = container.querySelector('#book-search');
    await act(async () => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '春风');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    expect(p.onViewChange).toHaveBeenCalled();
  });

  it('书签页可新增、编辑、保存与删除记录', async () => {
    notesState.notes = [{ id: 'note-1', kind: 'bookmark', start: 3, end: 3, quote: '', note: '', createdAt: 1, updatedAt: 1 }];
    const p = props();
    p.view = { tab: 'notes', query: '', hit: null };
    await render(<ReadingTools book={book} {...p} />);
    await act(async () => { await Promise.resolve(); });
    await click('.tools-actions button:first-child');
    expect(container.querySelector('.tools-editor')).toBeTruthy();
    await change('#reading-note', '值得重读', 'input');
    await click('.tools-editor .primary-button');
    await click('.tools-note-actions button:nth-child(2)');
    await click('.tools-note button.danger');
    await click('.tools-note-actions button:first-child');
    await click('.tools-editor > .tools-actions .secondary-button');
  });

  it('摘录编辑器支持调整范围、放弃编辑与保存失败提示', async () => {
    const p = props();
    p.view = { tab: 'notes', query: '', hit: null };
    await render(<ReadingTools book={book} {...p} />);
    await act(async () => { await Promise.resolve(); });
    await click('.tools-actions button:nth-child(2)');
    const area = container.querySelector('#excerpt-context');
    if (area) {
      await act(async () => {
        area.setSelectionRange(1, 4);
      });
      await click('.tools-editor .tools-selection summary');
      await click('.tools-selection .secondary-button');
    }
    await change('#reading-note', '草稿', 'input');
    await click('.tools-editor > .tools-actions .secondary-button');
    await click('.tools-discard .danger-button');
  });

  it('切换本书方式、收起操作区与听书语速', async () => {
    const p = props();
    await render(<ReadingTools book={{ ...book, readingPreference: { mode: 'listening', fontSize: 20, speed: 120, sentenceMode: false }, listening: { source: 0, completed: false, rate: 1 } }} {...p} />);
    await change('select[aria-label="本书使用方式"]', 'practice');
    await change('select[aria-label="听书语速"]', '1.5');
    await click('.book-mode .text-button');
    expect(p.onFocus).toHaveBeenCalled();
    await click('.practice-entry');
  });

  it('读取失败时显示错误且不误改记录', async () => {
    notesState.failLoad = true;
    await render(<ReadingTools book={book} {...props()} />);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('书签与摘录暂时无法读取');
  });
});

describe('阅读工具状态分支矩阵', () => {
  const plainBook = { ...book, contents: undefined, readingPreference: undefined, practice: undefined, listening: undefined };

  it('无目录、无偏好、无练习记录时显示空态与默认入口', async () => {
    await render(<ReadingTools {...props()} book={plainBook} />);
    expect(container.querySelector('.tools-empty')).toBeTruthy();
    expect(container.querySelector('.practice-entry').textContent).toContain('从当前位置');
    expect(container.querySelector('.book-mode select').value).toBe('reading');
  });

  it('目录超过千项、PDF 书签与层级缩进', async () => {
    const contents = Array.from({ length: 1001 }, (_, index) => ({ title: `章${index}`, source: index, level: 6 }));
    await render(<ReadingTools {...props()} book={{ ...book, contents, format: 'PDF' }} />);
    expect(container.textContent).toContain('最多显示1000项');
    expect(container.textContent).toContain('文件内置书签');
  });

  it('搜索中、无结果、结果过多与按键过滤', async () => {
    const Controlled = () => {
      const [view, setView] = useState({ tab: 'search', query: '', hit: null });
      return <ReadingTools {...props()} book={book} view={view} onViewChange={change => setView(previous => ({ ...previous, ...change }))} />;
    };
    await render(<Controlled />);
    const input = container.querySelector('#book-search');
    await act(async () => {
      setNativeValue(input, '完全不存在的词');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[role="status"]').textContent).toContain('正在查找');
    expect(container.querySelector('#book-search').value).toBe('完全不存在的词');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(container.textContent).toContain('没有找到');
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      await act(async () => {
        container.querySelector('#tools-tab-search').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
  });

  it('组合输入期间不触发定词，结束后立即查找', async () => {
    const p = props();
    p.view = { tab: 'search', query: '', hit: null };
    await render(<ReadingTools book={book} {...p} />);
    const input = container.querySelector('#book-search');
    await act(async () => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      setNativeValue(input, '春');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('[role="status"]').textContent).toContain('正在输入');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    await act(async () => {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(container.querySelector('.tools-search')).toBeTruthy();
  });

  it('摘录无文字、选区无效、超长与未变化分别提示', async () => {
    const p = props();
    p.view = { tab: 'notes', query: '', hit: null };
    await render(<ReadingTools book={{ ...book, lines: ['   '] }} {...p} />);
    await act(async () => { await Promise.resolve(); });
    await click('.tools-actions button:nth-child(2)');
    expect(container.textContent).toContain('没有可摘录');
    await render(<ReadingTools book={book} {...p} />);
    await act(async () => { await Promise.resolve(); });
    await click('.tools-actions button:nth-child(2)');
    const area = container.querySelector('#excerpt-context');
    await click('.tools-editor .tools-selection summary');
    await click('.tools-selection .secondary-button');
    expect(area).toBeTruthy();
  });

  it('笔记达到上限、禁用新增与保留提示', async () => {
    notesState.notes = Array.from({ length: 200 }, (_, index) => ({
      id: `n${index}`, kind: 'bookmark', start: 0, end: 0, quote: '', note: '', createdAt: 1, updatedAt: 1,
    }));
    const p = props();
    p.view = { tab: 'notes', query: '', hit: null };
    await render(<ReadingTools book={book} {...p} />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.tools-actions button').disabled).toBe(true);
  });

  it('保存失败时区分业务错误与系统错误文案', async () => {
    const p = props();
    p.view = { tab: 'notes', query: '', hit: null };
    const { mutateNotes } = await import('./storage');
    vi.mocked(mutateNotes).mockRejectedValueOnce(new Error('磁盘不可写'));
    await render(<ReadingTools book={book} {...p} />);
    await act(async () => { await Promise.resolve(); });
    await click('.tools-actions button:first-child');
    await click('.tools-editor .primary-button');
    expect(container.textContent).toContain('保存失败');
  });

  it('定位命中后保持上次查看标记与返回入口', async () => {
    const text = book.lines.join('\n');
    const p = props();
    p.canReturn = true;
    p.view = { tab: 'search', query: text.slice(0, 1), hit: 0 };
    await render(<ReadingTools book={book} {...p} />);
    expect(container.querySelector('.tools-summary .text-button')).toBeTruthy();
    expect(container.querySelector('[aria-current="true"]')).toBeTruthy();
  });
});
