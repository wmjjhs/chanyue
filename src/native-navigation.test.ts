// 版权所有：波哥
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeAndroidBack, listenForAndroidBack } from './native-navigation';

const native = vi.hoisted(() => ({ platform: 'android', addListener: vi.fn(), minimizeApp: vi.fn(async () => {}), remove: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => native.platform } }));
vi.mock('@capacitor/app', () => ({ App: native }));
const doc = (dialogs: EventTarget[]) => ({ querySelectorAll: () => dialogs }) as unknown as Pick<Document, 'querySelectorAll'>;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); native.platform = 'android'; });

describe('Android返回层级', () => {
  it('先交给最顶层弹窗，保留取消关闭与写入中阻塞保护', () => {
    const first = new EventTarget(), top = new EventTarget(), target = new EventTarget(), minimize = vi.fn(), close = vi.fn();
    first.addEventListener('cancel', close);
    top.addEventListener('cancel', event => event.preventDefault());
    const dispatch = vi.spyOn(top, 'dispatchEvent');
    routeAndroidBack(doc([first, top]), target, minimize);
    expect(dispatch).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled(); expect(minimize).not.toHaveBeenCalled();
  });
  it('阅读页处理返回时不同时退到后台', () => {
    const target = new EventTarget(), saveAndBack = vi.fn(), minimize = vi.fn();
    target.addEventListener('chanyue-back', event => { event.preventDefault(); saveAndBack(); });
    routeAndroidBack(doc([]), target, minimize);
    expect(saveAndBack).toHaveBeenCalledOnce(); expect(minimize).not.toHaveBeenCalled();
  });
  it('书架返回只最小化，不退出进程中断保存', () => {
    const minimize = vi.fn(); routeAndroidBack(doc([]), new EventTarget(), minimize);
    expect(minimize).toHaveBeenCalledOnce();
  });
  it.each(['web', 'ios'])('%s不注册Android监听', platform => {
    native.platform = platform; listenForAndroidBack()(); expect(native.addListener).not.toHaveBeenCalled();
  });
  it('提前卸载仍清理迟到的原生监听，迟到回调不触发导航', async () => {
    let resolve!: (value: { remove: typeof native.remove }) => void;
    native.addListener.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const dispose = listenForAndroidBack(); dispose();
    native.addListener.mock.calls[0][1]();
    expect(native.minimizeApp).not.toHaveBeenCalled();
    resolve({ remove: native.remove }); await Promise.resolve(); await Promise.resolve();
    expect(native.remove).toHaveBeenCalledOnce();
  });
  it('监听注册失败不会留下未处理拒绝', async () => {
    native.addListener.mockRejectedValueOnce(new Error('unavailable'));
    const dispose = listenForAndroidBack(); await Promise.resolve(); dispose(); await Promise.resolve();
    expect(native.minimizeApp).not.toHaveBeenCalled();
  });
});
