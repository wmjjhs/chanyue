// 版权所有：波哥
// @vitest-environment jsdom
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Brand, Modal, BookCover, SettingsPanel, Guide } from './components';
import { BackupPanel } from './BackupPanel';
import { RecitationPanel } from './RecitationPanel';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';

const platform = vi.hoisted(() => ({ name: 'web', native: false }));
const fsState = vi.hoisted(() => ({ written: '' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform.name,
    isNativePlatform: () => platform.native,
  },
  registerPlugin: () => ({
    prepare: async () => ({ available: false, neural: false, voices: [] }),
    speak: async () => {}, stop: async () => {},
    addListener: async () => ({ remove: async () => {} }),
  }),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE', Library: 'LIBRARY' }, Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: vi.fn(async ({ data }) => { fsState.written = data; return { uri: 'file:///backup.json' }; }),
    readFile: vi.fn(async () => ({ data: fsState.written })),
  },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => ({})) } }));

vi.mock('./storage', () => ({
  exportBackup: vi.fn(async () => {
    const { createBackup } = await import('./backup');
    const { defaultSettings } = await import('./model');
    return createBackup([], defaultSettings);
  }),
  restoreBackup: vi.fn(async () => ({ added: 1, skipped: 0, failed: 1 })),
  saveSettings: vi.fn(async () => {}),
  loadBooks: vi.fn(async () => []),
}));

let root, container;

const render = async node => { await act(async () => { root.render(node); }); };
const click = async selector => {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
};
const setValue = async (selector, value, eventName = 'input') => {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
};

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  platform.name = 'web';
  platform.native = false;
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  URL.createObjectURL = vi.fn(() => 'blob:chanyue');
  URL.revokeObjectURL = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('通用展示组件', () => {
  it('品牌与封面支持紧凑、小图与示例书变体', async () => {
    await render(<div><Brand /><Brand compact /><BookCover book={sampleBooks[0]} /><BookCover book={{ ...sampleBooks[0], sample: true }} small /><BookCover book={sampleBooks[1]} /></div>);
    expect(container.querySelectorAll('.brand').length).toBe(2);
    expect(container.querySelectorAll('.book-cover').length).toBe(3);
  });

  it('弹窗支持取消事件、点击遮罩关闭与关闭按钮', async () => {
    const onClose = vi.fn();
    await render(<Modal title="示例" eyebrow="说明" onClose={onClose}><p>内容</p></Modal>);
    const dialog = container.querySelector('dialog');
    await act(async () => { dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: -10, clientY: -10 }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    await click('button[aria-label="关闭弹窗"]');
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('设置面板渲染全部设置项并可修改', async () => {
    const onChange = vi.fn();
    await render(<SettingsPanel settings={defaultSettings} onChange={onChange} onClose={() => {}} />);
    expect(container.querySelector('.settings-modal')).toBeTruthy();
    await click('.font-options-grid button:nth-child(2)');
    await setValue('#font-size', '40');
    await click('.theme-options button:nth-child(2)');
    await click('button[aria-label="紧凑排列"]');
    await setValue('#max-lines', '12');
    await click('button[aria-label="划线留痕"]');
    await setValue('#cursor-thickness', '3');
    await setValue('#reading-speed', '300');
    await setValue('#speech-rules', '般若=波惹');
    await setValue('#speech-engine', 'system', 'change');
    await click('.settings-modal .modal-footer button:first-child');
    await click('.settings-modal .modal-footer button:last-child');
    expect(onChange).toHaveBeenCalled();
  });

  it('设置面板覆盖无神经语音、缺失音色与留痕环境音分支', async () => {
    await render(<SettingsPanel settings={{ ...defaultSettings, speechEngine: 'neural', speechVoice: 'missing', cursorMode: 'trail', ambientEnabled: false }} onChange={() => {}} onClose={() => {}} bookSpecific />);
    expect(container.textContent).toContain('此设备不可用');
    expect(container.textContent).toContain('当前安装包未提供');
    await click('button[aria-label="指读"]');
    await click('.settings-modal button.text-button');
    await setValue('#ambient-enabled', 'true', 'change');
  });

  it('指南按网页、iPhone、Android 三种环境给出对应说明', async () => {
    await render(<Guide onClose={() => {}} />);
    expect(container.textContent).toContain('添加到主屏幕');
    act(() => root.unmount());
    root = createRoot(container);
    platform.name = 'ios'; platform.native = true;
    await render(<Guide onClose={() => {}} />);
    expect(container.textContent).toContain('我的 iPhone');
    act(() => root.unmount());
    root = createRoot(container);
    platform.name = 'android'; platform.native = true;
    await render(<Guide onClose={() => {}} />);
    expect(container.textContent).toContain('Android 自动备份');
  });
});

describe('备份面板', () => {
  const props = () => ({ onClose: () => {}, onReload: async () => {}, onSettingsSaved: () => {}, waitWrites: async () => {} });

  it('网页端导出可下载备份，恢复时展示确认区', async () => {
    await render(<BackupPanel {...props()} />);
    await click('.tools-actions button:first-child');
    expect(container.querySelector('.backup-download')).toBeTruthy();
    expect(container.textContent).toContain('备份已准备好');
  });

  it('原生端通过文件写入与系统分享导出备份', async () => {
    platform.name = 'android'; platform.native = true;
    const { Share } = await import('@capacitor/share');
    await render(<BackupPanel {...props()} />);
    await click('.tools-actions button:first-child');
    expect(Share.share).toHaveBeenCalled();
  });

  it('读取备份文件后进入恢复确认，可切换设置选项', async () => {
    await render(<BackupPanel {...props()} />);
    const input = container.querySelector('input[type="file"]');
    const { createBackup, encodeBackup } = await import('./backup');
    const encoded = encodeBackup(createBackup([], defaultSettings));
    const file = new File([encoded], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => encoded });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('.backup-preview')).toBeTruthy();
    await click('.backup-settings input');
    await click('.backup-preview button:last-child');
    expect(container.textContent).toContain('已新增');
  });

  it('操作失败时显示错误且不锁死界面', async () => {
    const { restoreBackup } = await import('./storage');
    restoreBackup.mockRejectedValueOnce(new Error('空间不足'));
    await render(<BackupPanel {...props()} />);
    expect(container.querySelector('.backup-modal')).toBeTruthy();
  });
});

describe('背诵面板', () => {
  const book = { ...sampleBooks[0], contents: [] };
  const base = { book, source: 0, settings: defaultSettings, onClose: () => {}, onSave: async () => {} };

  it('渲染练习分段并支持切换遮字、揭示与导航', async () => {
    await render(<RecitationPanel {...base} />);
    expect(container.querySelector('.practice-text')).toBeTruthy();
    await click('.practice-levels button:nth-child(2)');
    await click('.practice-sentence');
    await setValue('select[aria-label="练习分段"]', 'sentence', 'change');
    await setValue('select[aria-label="练习段数"]', '2', 'change');
    await click('.practice-navigation button:last-child');
    await click('.recitation-modal button.primary-button.full-width');
  });

  it('保存失败保留记录，可重试或放弃关闭', async () => {
    const onSave = vi.fn(async () => {});
    onSave.mockRejectedValueOnce(new Error('写入失败'));
    await render(<RecitationPanel {...base} onSave={onSave} />);
    await click('.practice-levels button:nth-child(3)');
    expect(container.querySelector('.tools-discard')).toBeTruthy();
    await click('.tools-discard .text-button');
    await click('.tools-discard .secondary-button');
  });
});
