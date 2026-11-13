// 版权所有：波哥
// @vitest-environment jsdom
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPanel } from './components';
import { BackupPanel } from './BackupPanel';
import { ReadingTools } from './ReadingTools';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';

const env = vi.hoisted(() => ({
  native: false, platform: 'web', notes: [], failSave: false,
  restoreResult: { added: 1, skipped: 0, failed: 1 }, saveSettingsFails: false,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => env.platform, isNativePlatform: () => env.native },
  registerPlugin: () => ({
    prepare: async () => ({ available: true, neural: true, voices: env.native ? [{ id: 'zh-CN', name: '中文女声' }] : [] }),
    speak: async () => {}, stop: async () => {},
    addListener: async () => ({ remove: async () => {} }),
  }),
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: vi.fn(async () => ({ uri: 'file:///x' })), readFile: vi.fn(async () => ({ data: '' })) },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => ({})) } }));
vi.mock('./storage', () => ({
  loadNotes: vi.fn(async () => env.notes),
  mutateNotes: vi.fn(async () => { if (env.failSave) throw new Error('相同书签'); return env.notes; }),
  exportBackup: vi.fn(async () => {
    const { createBackup } = await import('./backup');
    const { defaultSettings } = await import('./model');
    return createBackup([], defaultSettings);
  }),
  restoreBackup: vi.fn(async () => env.restoreResult),
  saveSettings: vi.fn(async () => { if (env.saveSettingsFails) throw new Error('quota'); }),
  loadBooks: vi.fn(async () => []),
}));

let root, container;
const render = async node => { await act(async () => { root.render(node); }); };
const click = async selector => {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
};
const change = async (element, value, eventName = 'input') => {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
};
const exercise = async () => {
  for (const input of Array.from(container.querySelectorAll('.settings-modal input'))) {
    if (input.disabled) continue;
    await act(async () => {
      if (input.type === 'checkbox') input.click();
      else {
        const value = input.type === 'color' ? '#336699' : String(Math.min(Number(input.max || 100), Number(input.min || 0) + 1));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
  for (const select of Array.from(container.querySelectorAll('.settings-modal select'))) {
    const option = select.options[Math.min(1, select.options.length - 1)];
    if (option) await change(select, option.value, 'change');
  }
  for (const button of Array.from(container.querySelectorAll('.settings-modal button'))) {
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  }
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  env.native = false; env.platform = 'web'; env.notes = []; env.failSave = false;
  env.restoreResult = { added: 1, skipped: 0, failed: 1 }; env.saveSettingsFails = false;
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  URL.createObjectURL = vi.fn(() => 'blob:chanyue');
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('设置面板全部控件', () => {
  it('打开设置时焦点落在弹窗容器，关闭按钮不默认选中', async () => {
    await render(<SettingsPanel settings={defaultSettings} onChange={() => {}} onClose={() => {}} />);
    const dialog = container.querySelector('dialog');
    expect(dialog.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(container.querySelector('button[aria-label="关闭弹窗"]'));
  });

  it('指针模式下每个控件都可交互', async () => {
    await render(<SettingsPanel settings={{ ...defaultSettings, trailFadeAvailable: true }} onChange={() => {}} onClose={() => {}} />);
    await exercise();
    expect(container.querySelector('.settings-modal')).toBeTruthy();
  });

  it('留痕模式下淡出相关控件可交互', async () => {
    await render(<SettingsPanel settings={{ ...defaultSettings, cursorMode: 'trail', trailFade: true, trailFadeAvailable: true }} onChange={() => {}} onClose={() => {}} />);
    await exercise();
    expect(container.querySelector('#trail-fade')).toBeTruthy();
  });

  it('原生设备列出系统音色并允许选择', async () => {
    env.native = true; env.platform = 'ios';
    await render(<SettingsPanel settings={{ ...defaultSettings, speechEngine: 'neural' }} onChange={() => {}} onClose={() => {}} />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.querySelectorAll('#speech-voice option').length).toBeGreaterThan(1);
    await exercise();
  });
});

describe('备份面板异常分支', () => {
  const base = (overrides = {}) => ({ onClose: () => {}, onReload: async () => {}, onSettingsSaved: () => {}, waitWrites: async () => {}, ...overrides });

  it('导出失败时展示错误原因', async () => {
    await render(<BackupPanel {...base({ waitWrites: async () => { throw new Error('磁盘已满'); } })} />);
    await click('.tools-actions button:first-child');
    expect(container.textContent).toContain('磁盘已满');
  });

  it('恢复成功且勾选应用设置时写回设置', async () => {
    env.restoreResult = { added: 1, skipped: 0, failed: 0 };
    const onSettingsSaved = vi.fn();
    await render(<BackupPanel {...base({ onSettingsSaved })} />);
    const { createBackup, encodeBackup } = await import('./backup');
    const encoded = encodeBackup(createBackup([], defaultSettings));
    const input = container.querySelector('input[type="file"]');
    const file = new File([encoded], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => encoded });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    await click('.backup-settings input');
    await click('.backup-preview .primary-button');
    expect(onSettingsSaved).toHaveBeenCalled();
  });

  it('设置写回失败时保留书籍并提示', async () => {
    env.restoreResult = { added: 1, skipped: 0, failed: 0 };
    env.saveSettingsFails = true;
    await render(<BackupPanel {...base()} />);
    const { createBackup, encodeBackup } = await import('./backup');
    const encoded = encodeBackup(createBackup([], defaultSettings));
    const input = container.querySelector('input[type="file"]');
    const file = new File([encoded], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => encoded });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    await click('.backup-settings input');
    await click('.backup-preview .primary-button');
    expect(container.textContent).toContain('设置保存失败');
  });

  it('点击选择文件按钮触发系统文件选择器', async () => {
    await render(<BackupPanel {...base()} />);
    await click('.tools-actions button:nth-child(2)');
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
  });
});

describe('阅读工具边角分支', () => {
  const book = { ...sampleBooks[0], contents: [] };
  const base = (overrides = {}) => ({
    book, source: 0, view: { tab: 'contents', query: '', hit: null },
    onViewChange: vi.fn(), onClose: vi.fn(), onJump: vi.fn(), canReturn: false, onReturn: vi.fn(),
    onPractice: async () => {}, onMode: async () => {}, onFocus: vi.fn(), onSpeechRate: async () => {},
    ...overrides,
  });

  it('搜索结果列表与输入法失焦回调', async () => {
    const text = book.lines.join('\n');
    await render(<ReadingTools {...base({ view: { tab: 'search', query: text.slice(0, 1), hit: null } })} />);
    expect(container.querySelector('.search-result')).toBeTruthy();
    const input = container.querySelector('#book-search');
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  });

  it('关闭弹窗时区分普通关闭与未保存内容', async () => {
    const onClose = vi.fn();
    await render(<ReadingTools {...base({ onClose, view: { tab: 'notes', query: '', hit: null } })} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { container.querySelector('dialog').dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })); });
    expect(onClose).toHaveBeenCalled();
    await click('.tools-actions button:first-child');
    await change(container.querySelector('#reading-note'), '未保存草稿');
    await act(async () => { container.querySelector('dialog').dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })); });
    expect(container.querySelector('.tools-discard')).toBeTruthy();
  });

  it('保存笔记失败时给出提示', async () => {
    env.failSave = true;
    await render(<ReadingTools {...base({ view: { tab: 'notes', query: '', hit: null } })} />);
    await act(async () => { await Promise.resolve(); });
    await click('.tools-actions button:first-child');
    await click('.tools-editor .primary-button');
    expect(container.textContent).toContain('相同书签');
  });

  it('切换本书方式失败时给出提示', async () => {
    const onMode = vi.fn(async () => { throw new Error('quota'); });
    await render(<ReadingTools {...base({ onMode, book: { ...book, readingPreference: { mode: 'reading', fontSize: 20, speed: 120, sentenceMode: false } } })} />);
    await change(container.querySelector('select[aria-label="本书使用方式"]'), 'practice', 'change');
    expect(container.textContent).toContain('本书使用方式未保存');
  });
});

describe('设置面板与备份面板剩余分支', () => {
  it('三种排版模式、滑杆边界与关闭环境音', async () => {
    for (const layoutMode of ['plain', 'semantic', 'flow']) {
      act(() => root.unmount());
      root = createRoot(container);
      await render(<SettingsPanel settings={{ ...defaultSettings, layoutMode } as any} onChange={() => {}} onClose={() => {}} />);
      expect(container.querySelector('.settings-modal')).toBeTruthy();
    }
    act(() => root.unmount());
    root = createRoot(container);
    await render(<SettingsPanel settings={{ ...defaultSettings, cursorMode: 'pointer', cursorWords: 20, ambientEnabled: false }} onChange={() => {}} onClose={() => {}} />);
    expect(container.textContent).toContain('环境音已关闭');
    expect(container.textContent).toContain('预览仅示意');
  });

  it('未保存的修改在关闭时先确认，放弃不落库', async () => {
    const onClose = vi.fn(), onChange = vi.fn();
    await render(<SettingsPanel settings={defaultSettings} onChange={onChange} onClose={onClose} />);
    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    input.min = '5';
    input.max = '5';
    await change(input, '5');
    input.min = '12';
    input.max = '64';
    await change(container.querySelector('#font-size'), '40');
    expect(container.textContent).toContain('有尚未保存的修改');
    await click('button[aria-label="关闭弹窗"]');
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('.settings-discard')).toBeTruthy();
    await click('.settings-discard button:nth-of-type(1)');
    expect(container.querySelector('.settings-discard')).toBeNull();
    const dialog = container.querySelector('dialog');
    await act(async () => { dialog.dispatchEvent(new MouseEvent('click', { clientX: -50, clientY: -50, bubbles: true })); });
    await click('.settings-discard button:last-child');
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('只有点保存设置才把草稿提交给外部', async () => {
    const onChange = vi.fn();
    await render(<SettingsPanel settings={defaultSettings} onChange={onChange} onClose={() => {}} />);
    await change(container.querySelector('#font-size'), '40');
    expect(onChange).not.toHaveBeenCalled();
    await click('.settings-footer .primary-button');
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].fontSize).toBe(40);
  });

  it('分组导航一次只显示一组', async () => {
    await render(<SettingsPanel settings={defaultSettings} onChange={() => {}} onClose={() => {}} />);
    const visible = () => [...container.querySelectorAll('.settings-section')].filter(section => !section.hasAttribute('hidden'));
    expect(visible()).toHaveLength(1);
    await click('.settings-groups button:nth-child(4)');
    expect(visible()).toHaveLength(1);
    expect(visible()[0].textContent).toContain('下划线');
  });

  it('触摸滚动后吞掉紧随的点击，避免误触设置项', async () => {
    await render(<SettingsPanel settings={defaultSettings} onChange={() => {}} onClose={() => {}} />);
    const dialog = container.querySelector('dialog');
    const touch = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerType', { value: 'touch' });
      Object.defineProperty(event, 'clientX', { value: x });
      Object.defineProperty(event, 'clientY', { value: y });
      dialog.dispatchEvent(event);
    };
    await act(async () => {
      touch('pointerdown', 10, 10);
      touch('pointermove', 10, 60);
      touch('pointerup', 10, 60);
    });
    const button = container.querySelector('.font-options-grid button:nth-child(2)');
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    await click('.font-options-grid button:nth-child(2)');
    expect(container.querySelector('.font-options-grid button:nth-child(2)').getAttribute('aria-pressed')).toBe('true');
  });

  it('回读校验失败、非 Error 异常与超大备份文件', async () => {
    env.native = true;
    const { Filesystem } = await import('@capacitor/filesystem');
    vi.mocked(Filesystem.readFile).mockResolvedValueOnce({ data: 'mismatch' });
    await render(<BackupPanel onClose={() => {}} onReload={async () => {}} onSettingsSaved={() => {}} waitWrites={async () => {}} />);
    await click('.tools-actions button:first-child');
    expect(container.textContent).toContain('写入不完整');
    act(() => root.unmount());
    root = createRoot(container);
    await render(<BackupPanel onClose={() => {}} onReload={async () => {}} onSettingsSaved={() => {}} waitWrites={async () => { throw 'disk'; }} />);
    await click('.tools-actions button:first-child');
    expect(container.textContent).toContain('操作未完成');
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    const huge = new File(['{}'], 'huge.json', { type: 'application/json' });
    Object.defineProperty(huge, 'size', { value: 101 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [huge], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    expect(container.textContent).toContain('100 MB');
  });
});
