// 版权所有：波哥
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { applyPronunciation, validatePronunciationRules, type PronunciationRule } from './speech-text';

export interface SpeechDriver {
  prepare(): Promise<void>;
  speak(text: string, rate: number, started: () => void): Promise<void>;
  stop(): Promise<void>;
}
export type SpeechOptions = {
  engine: 'system' | 'neural';
  voice: string;
  rules: PronunciationRule[];
};
export type SpeechVoice = { id: string; name: string };
export type SpeechAvailability = { available: boolean; neural: boolean; voices: SpeechVoice[] };
export const defaultSpeechOptions: SpeechOptions = { engine: 'system', voice: '', rules: [] };
export const emptySpeechAvailability: SpeechAvailability = { available: false, neural: false, voices: [] };

type SpeechPlugin = {
  prepare(): Promise<Partial<SpeechAvailability> | undefined>;
  speak(options: { text: string; rate: number; id: string; engine: 'system' | 'neural'; voice: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(name: 'speechStarted', callback: (event: { id: string }) => void): Promise<PluginListenerHandle>;
};
const plugin = registerPlugin<SpeechPlugin>('SystemSpeech');
let sequence = 0;
const VOICE_ID = /^[\p{L}\p{N}._\- ]{1,120}$/u;

function safeVoices(value: unknown): SpeechVoice[] {
  if (!Array.isArray(value)) return [];
  const result: SpeechVoice[] = [];
  for (const entry of value) {
    if (result.length >= 24) break;
    if (!entry || typeof entry !== 'object') continue;
    const { id, name } = entry as Partial<SpeechVoice>;
    if (typeof id !== 'string' || !VOICE_ID.test(id)) continue;
    if (result.some(voice => voice.id === id)) continue;
    result.push({ id, name: typeof name === 'string' ? name.slice(0, 60) : id });
  }
  return result;
}

/** 读取设备实际可用的离线音色；网页版或未实现插件时返回空结果，不联网、不发声。 */
export async function speechVoices(): Promise<SpeechAvailability> {
  if (!Capacitor.isNativePlatform()) return emptySpeechAvailability;
  try {
    const result = await plugin.prepare();
    return {
      available: result?.available === true,
      neural: result?.neural === true,
      voices: safeVoices(result?.voices),
    };
  } catch {
    return emptySpeechAvailability;
  }
}

// getOptions 在每次朗读时读取最新设置，切换音色或读音规则无需重建控制器。
export function createSystemSpeech(getOptions: () => SpeechOptions = () => defaultSpeechOptions): SpeechDriver {
  let generation = 0;
  let neuralAvailable = false;
  return {
    async prepare() {
      if (!Capacitor.isNativePlatform()) throw new Error('听书需要使用 Android 或 iPhone 安装版。');
      const result = await plugin.prepare();
      neuralAvailable = result?.neural === true;
      if (result?.available !== true && !neuralAvailable) throw new Error('没有可用的离线中文语音。请在手机系统文字转语音设置中安装中文语音后重试。');
    },
    async speak(text, rate, started) {
      const options = getOptions();
      const engine = options.engine === 'neural' && neuralAvailable ? 'neural' : 'system';
      const spoken = applyPronunciation(text, validatePronunciationRules(options.rules));
      const id = `speech-${Date.now()}-${++sequence}`, token = generation;
      const handle = await plugin.addListener('speechStarted', event => { if (event.id === id && token === generation) started(); });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (token !== generation) throw new Error('听书已暂停。');
        await Promise.race([
          plugin.speak({ text: spoken, rate, id, engine, voice: options.voice }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('语音合成超时，请重试或改用系统语音。')), 15 * 60 * 1000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        await handle.remove().catch(() => {});
      }
    },
    async stop() { generation++; if (Capacitor.isNativePlatform()) await plugin.stop(); },
  };
}
