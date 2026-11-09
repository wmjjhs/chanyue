// 版权所有：波哥
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SpeechDriver {
  prepare(): Promise<void>;
  speak(text: string, rate: number, started: () => void): Promise<void>;
  stop(): Promise<void>;
}
type SpeechPlugin = {
  prepare(): Promise<{ available: boolean }>;
  speak(options: { text: string; rate: number; id: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(name: 'speechStarted', callback: (event: { id: string }) => void): Promise<PluginListenerHandle>;
};
const plugin = registerPlugin<SpeechPlugin>('SystemSpeech');
let sequence = 0;
export function createSystemSpeech(): SpeechDriver {
  let generation = 0;
  return {
    async prepare() {
      if (!Capacitor.isNativePlatform()) throw new Error('听书需要使用 Android 或 iPhone 安装版。');
      const result = await plugin.prepare();
      if (!result.available) throw new Error('没有可用的离线中文语音。请在手机系统文字转语音设置中安装中文语音后重试。');
    },
    async speak(text, rate, started) {
      const id = `speech-${Date.now()}-${++sequence}`, token = generation;
      const handle = await plugin.addListener('speechStarted', event => { if (event.id === id && token === generation) started(); });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (token !== generation) throw new Error('听书已暂停。');
        await Promise.race([plugin.speak({ text, rate, id }), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('系统语音未返回完成状态，请检查语音引擎后重试。')), 15 * 60 * 1000); })]);
      } finally { clearTimeout(timeout); await handle.remove(); }
    },
    async stop() { generation++; if (Capacitor.isNativePlatform()) await plugin.stop(); },
  };
}
