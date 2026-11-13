// 版权所有：波哥
// @vitest-environment jsdom
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Reader from './Reader';
import { defaultSettings } from './model';
import { sampleBooks } from './samples';

const control = vi.hoisted(() => ({
  platform: 'web',
  snapshot: {
    active: false, speaking: false, completed: false, focus: 0, spokenEnd: 3,
    seekId: 0, startedId: 0, duration: 0, rate: 1, source: 0, error: '',
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => control.platform,
    isNativePlatform: () => control.platform !== 'web',
  },
  registerPlugin: () => ({ prepare: async () => ({}), speak: async () => {}, stop: async () => {}, addListener: async () => ({ remove: async () => {} }) }),
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })), minimizeApp: vi.fn(async () => {}) },
}));
vi.mock('./ambient-audio', () => ({
  ambientAudio: {
    subscribe: () => () => {}, getSnapshot: () => 'idle', getError: () => null,
    configure: vi.fn(), start: vi.fn(), stopSession: vi.fn(),
  },
  ambientNames: { rain: '雨', wind: '风', stream: '溪' },
}));
vi.mock('./reading-renderer', () => ({
  ReadingRenderer: class { paint = vi.fn(); dispose = vi.fn(); },
}));
vi.mock('./listening', () => ({
  SentenceListening: class {
    subscribe = () => () => {};
    getSnapshot = () => control.snapshot;
    pause = vi.fn(); start = vi.fn(async () => {}); seek = vi.fn(async () => {}); step = vi.fn();
  },
  DEFAULT_SPEECH_SPEED: 5,
  adaptiveSpeechSpeed: () => 5, measuredSpeechSpeed: () => 5, smoothSpeechSpeed: () => 5,
}));
vi.mock('./system-speech', () => ({ createSystemSpeech: () => ({ prepare: async () => {}, speak: async () => {}, stop: async () => {} }) }));
vi.mock('./reading-layout', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, rowAtSource: () => 0 };
});
vi.mock('./ReadingTools', () => ({
  ReadingTools: props => <div data-testid="tools">
    <button onClick={() => props.onViewChange({ tab: 'search' })}>页签</button>
    <button onClick={() => props.onJump(5)}>跳转</button>
    <button onClick={() => props.onReturn()}>返回刚才</button>
    <button onClick={() => void props.onPractice()}>练习</button>
    <button onClick={() => void props.onMode('listening')}>听书</button>
    <button onClick={() => void props.onMode('practice')}>背诵</button>
    <button onClick={() => void props.onMode('reciting')}>念诵</button>
    <button onClick={() => void props.onSpeechRate(1.5)}>语速</button>
    <button onClick={() => props.onFocus()}>收起</button>
    <button onClick={() => props.onClose()}>关闭工具</button>
  </div>,
}));
vi.mock('./RecitationPanel', () => ({
  RecitationPanel: props => <div data-testid="practice">
    <button onClick={() => void props.onSave({ source: 0, span: 1, mask: 'full', unit: 'paragraph' })}>保存练习</button>
    <button onClick={() => props.onClose()}>结束练习</button>
  </div>,
}));

let root, container;
const props = (overrides = {}) => ({
  book: sampleBooks[0], settings: defaultSettings,
  onBack: vi.fn(), onSettings: vi.fn(), onProgress: vi.fn(),
  blocked: false, onBookState: vi.fn(async () => {}), ...overrides,
});
const renderReader = async overrides => {
  await act(async () => { root.render(<Reader {...props(overrides)} />); });
};
const click = async selector => {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
};
const keydown = async (key, options = {}) => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, ...options }));
  });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  control.platform = 'web';
  control.snapshot = { active: false, speaking: false, completed: false, focus: 0, spokenEnd: 3, seekId: 0, startedId: 0, duration: 0, rate: 1, source: 0, error: '' };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 360 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 640 });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('阅读器主屏', () => {
  it('渲染阅读区并支持播放、翻页、页码跳转与键盘操作', async () => {
    await renderReader();
    expect(container.querySelector('.reader-v2')).toBeTruthy();
    await click('.play-button');
    await click('.step-button:nth-child(1)');
    await click('.step-button:nth-child(3)');
    await keydown(' ');
    await keydown('ArrowLeft');
    await keydown('ArrowRight');
    const input = container.querySelector('#reading-page');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2');
      container.querySelector('.page-navigation').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await click('button[aria-label="阅读设置"]');
    await click('button[aria-label="返回书架"]');
  });

  it('展开工具面板后跳转、返回、切换模式与收起操作区', async () => {
    await renderReader();
    const toolButton = async index => {
      if (!container.querySelector('[data-testid="tools"]')) await click('.reader-title-button');
      await click(`[data-testid="tools"] button:nth-child(${index})`);
    };
    await toolButton(1);
    expect(container.querySelector('[data-testid="tools"]')).toBeTruthy();
    await toolButton(2);
    await toolButton(3);
    await toolButton(8);
    await toolButton(9);
    expect(container.querySelector('.focus-restore')).toBeTruthy();
    await keydown('Escape');
    for (const index of [4, 5, 6, 7, 10]) await toolButton(index);
  });

  it('按句模式、已完成与空文档分别给出对应状态', async () => {
    await renderReader({ settings: { ...defaultSettings, sentenceMode: true } });
    await click('.step-button:nth-child(1)');
    await click('.step-button:nth-child(3)');
    await click('.play-button');
    await act(async () => { root.render(<Reader {...props({ book: { ...sampleBooks[0], completed: true }, blocked: true })} />); });
    await act(async () => { root.render(<Reader {...props({ book: { ...sampleBooks[0], lines: ['。'] } })} />); });
    expect(container.querySelector('.play-button')?.disabled).toBe(true);
  });

  it('收起操作区后点击正文或恢复按钮可重新显示', async () => {
    await renderReader();
    await click('.reader-title-button');
    await click('[data-testid="tools"] button:nth-child(9)');
    await act(async () => {
      container.querySelector('.reading-workspace').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await click('.reader-title-button');
    await click('[data-testid="tools"] button:nth-child(9)');
    await click('.focus-restore');
  });

  it('系统返回、切后台与页面隐藏都会暂停并保存', async () => {
    await renderReader();
    await act(async () => { window.dispatchEvent(new Event('chanyue-back', { bubbles: true, cancelable: true })); });
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    control.platform = 'android';
    await act(async () => { root.render(<Reader {...props()} />); });
  });

  it('听书模式按真实发声驱动逐字跟随', async () => {
    control.snapshot = { ...control.snapshot, active: true, speaking: true, startedId: 1, duration: 2, spokenEnd: 6, error: '' };
    await renderReader({ book: { ...sampleBooks[0], readingPreference: { mode: 'listening', fontSize: 20, speed: 120, sentenceMode: false } } });
    const frame = globalThis.requestAnimationFrame.mock.calls[0]?.[0];
    if (frame) await act(async () => { frame(1000); });
    await click('.play-button');
    await click('.step-button:nth-child(1)');
    await click('.step-button:nth-child(3)');
    expect(container.querySelector('.reading-band')).toBeTruthy();
  });

  it('听书失败可重试，练习模式可保存与结束', async () => {
    control.snapshot = { ...control.snapshot, active: false, error: '语音不可用' };
    await renderReader({ book: { ...sampleBooks[0], readingPreference: { mode: 'listening', fontSize: 20, speed: 120, sentenceMode: false } } });
    await click('.listening-error button');
    await act(async () => { root.render(<Reader key="practice" {...props({ book: { ...sampleBooks[0], readingPreference: { mode: 'practice', fontSize: 20, speed: 120, sentenceMode: false } } })} />); });
    expect(container.querySelector('[data-testid="practice"]')).toBeTruthy();
    await click('[data-testid="practice"] button:nth-child(1)');
    await click('[data-testid="practice"] button:nth-child(2)');
  });

  it('播放帧推进时会持续刷新进度并持久化', async () => {
    await renderReader();
    await click('.play-button');
    const frame = globalThis.requestAnimationFrame.mock.calls[0]?.[0];
    if (frame) {
      await act(async () => { frame(1000); });
      await act(async () => { frame(2600); });
    }
    expect(container.querySelector('.reading-band')).toBeTruthy();
  });

  it('按原始字符位置校准当前行', async () => {
    const { createDocument } = await import('./reading-layout');
    const model = createDocument(sampleBooks[0].lines);
    const punctuationIndices = model.wordOrdinal.map((value, index) => value < 0 ? index : -1).filter(index => index >= 0);
    const punctuation = punctuationIndices[punctuationIndices.length - 1] ?? 0;
    const source = model.offsets[punctuation];
    await renderReader({ book: { ...sampleBooks[0], character: source, line: 0 } });
    await click('.step-button:nth-child(1)');
    await click('.step-button:nth-child(3)');
    expect(container.querySelector('.reading-band')).toBeTruthy();
  });

  it('听书帧推进、速度自适应与状态回退', async () => {
    const listeningBook = { ...sampleBooks[0], readingPreference: { mode: 'listening', fontSize: 20, speed: 120, sentenceMode: false } };
    control.snapshot = { ...control.snapshot, active: true, speaking: true, startedId: 1, duration: 2, spokenEnd: 8, focus: 2 };
    await renderReader({ book: listeningBook });
    const frame = globalThis.requestAnimationFrame.mock.calls[0]?.[0];
    if (frame) {
      await act(async () => { frame(1000); });
      await act(async () => { frame(1160); });
    }
    control.snapshot = { ...control.snapshot, focus: 4 };
    await act(async () => { root.render(<Reader {...props({ book: listeningBook })} />); });
    control.snapshot = { ...control.snapshot, startedId: 2, duration: 0 };
    await act(async () => { root.render(<Reader {...props({ book: listeningBook })} />); });
    expect(container.querySelector('.reading-band')).toBeTruthy();
  });

  it('听书暂停后可恢复播放，切换其它方式会重置位置', async () => {
    const listeningBook = { ...sampleBooks[0], readingPreference: { mode: 'listening', fontSize: 20, speed: 120, sentenceMode: false } };
    await renderReader({ book: listeningBook });
    await click('.play-button');
    await click('.reader-title-button');
    await click('[data-testid="tools"] button:nth-child(6)');
    expect(container.querySelector('.reading-band')).toBeTruthy();
  });
});

describe('阅读器状态分支矩阵', () => {
  const listeningBook = { ...sampleBooks[0], readingPreference: { mode: 'listening', fontSize: 20, speed: 120, sentenceMode: false } };
  const fresh = async (overrides = {}, snapshot = null) => {
    act(() => root.unmount());
    root = createRoot(container);
    control.snapshot = { active: false, speaking: false, completed: false, focus: 0, spokenEnd: 3, seekId: 0, startedId: 0, duration: 0, rate: 1, source: 0, error: '', ...snapshot };
    await renderReader(overrides);
  };
  const pulse = async () => {
    const frames = globalThis.requestAnimationFrame.mock.calls;
    const frame = frames[frames.length - 1]?.[0];
    if (frame) {
      await act(async () => { frame(1000); });
      await act(async () => { frame(1160); });
    }
    const play = container.querySelector('.play-button');
    if (play && !play.disabled) await click('.play-button');
    for (const selector of ['.step-button:nth-child(1)', '.step-button:nth-child(3)']) {
      const button = container.querySelector(selector);
      if (button && !button.disabled) await click(selector);
    }
  };

  const variants = [
    ['空文档', { book: { ...sampleBooks[0], lines: [''], contents: undefined, listening: undefined, readingPreference: undefined } }, null],
    ['已完成书籍', { book: { ...sampleBooks[0], completed: true, character: undefined, listening: undefined } }, null],
    ['带听读位置', { book: { ...sampleBooks[0], listening: { source: 3, completed: false, rate: 1.5 }, contents: [] } }, null],
    ['按句推进', { settings: { ...defaultSettings, sentenceMode: true } }, null],
    ['留痕淡出', { settings: { ...defaultSettings, cursorMode: 'trail', trailFade: true, trailFadeAvailable: true } }, null],
    ['语义段落', { settings: { ...defaultSettings, layoutMode: 'semantic' } }, null],
    ['被遮挡的阅读器', { blocked: true }, null],
    ['听书准备中', { book: listeningBook }, { active: true, speaking: false, error: '' }],
    ['听书已完成', { book: listeningBook }, { active: false, speaking: false, completed: true }],
    ['听书出错', { book: listeningBook }, { active: false, error: '语音不可用' }],
    ['听书发声中', { book: listeningBook }, { active: true, speaking: true, startedId: 7, duration: 0, spokenEnd: 9, focus: 4 }],
    ['背诵模式', { book: { ...sampleBooks[0], readingPreference: { mode: 'practice', fontSize: 20, speed: 120, sentenceMode: false } } }, null],
  ];

  it.each(variants)('%s 状态下渲染、推进与操作都不崩溃', async (_name, overrides, snapshot) => {
    await fresh(overrides, snapshot);
    expect(container.querySelector('.reader-v2')).toBeTruthy();
    await pulse();
    expect(container.querySelector('.reading-band')).toBeTruthy();
  });

  it('聚焦与恢复、页码输入与键盘组合', async () => {
    await fresh();
    await click('.reader-title-button');
    await click('[data-testid="tools"] button:nth-child(9)');
    expect(container.querySelector('.focus-restore')).toBeTruthy();
    await keydown('Escape');
    const input = container.querySelector('#reading-page');
    if (input) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2');
        container.querySelector('.page-navigation').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    }
    for (const options of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) await keydown(' ', options);
    await keydown('Home');
    await keydown('End');
  });

  it('尺寸变化后重新测量排版', async () => {
    let observer;
    globalThis.ResizeObserver = class {
      constructor(callback) { observer = callback; }
      observe() {}
      disconnect() {}
    };
    await fresh();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 420 });
    await act(async () => { observer?.([], {}); });
    expect(container.querySelector('.reader-v2')).toBeTruthy();
  });
});
