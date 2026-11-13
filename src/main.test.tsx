// 版权所有：波哥
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

const state = vi.hoisted(() => ({ shouldThrow: false }));
vi.mock('./App', () => ({
  default: () => {
    if (state.shouldThrow) throw new Error('启动失败');
    return <div>我的书架</div>;
  },
}));

describe('应用入口与启动兜底', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    state.shouldThrow = false;
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('正常挂载应用根节点', async () => {
    await act(async () => { await import('./main'); });
    expect(document.getElementById('root')?.textContent).toContain('我的书架');
  });

  it('渲染异常时显示不丢书库的兜底提示', async () => {
    state.shouldThrow = true;
    await act(async () => { await import('./main'); });
    const fallback = document.querySelector('.startup-message');
    expect(fallback?.getAttribute('role')).toBe('alert');
    expect(fallback?.textContent).toContain('书库未被清除');
  });
});
