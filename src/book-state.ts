// 版权所有：波哥
import type { Book, Settings } from './model';
import type { MaskLevel } from './sentence-reading';
export type PracticeState = { source: number; span: number; mask: MaskLevel; unit: 'paragraph' | 'sentence' };
export type ListeningState = { source: number; completed: boolean; rate: number };
export type ReadingPreference = { mode: 'reading' | 'reciting' | 'practice' | 'listening'; sentenceMode: boolean; fontSize: number; speed: number };
export type BookState = { practice?: PracticeState; readingPreference?: ReadingPreference; listening?: ListeningState };

export function validateBookState(value: unknown, length: number): BookState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('每书使用记录格式无效。');
  const data = value as Record<string, unknown>, result: BookState = {};
  if (data.practice !== undefined) {
    const p = data.practice as PracticeState;
    if (!p || typeof p !== 'object' || !Number.isInteger(p.source) || p.source < 0 || p.source > length || !Number.isInteger(p.span) || p.span < 1 || p.span > 4 || !['full', 'partial', 'cue', 'hidden'].includes(p.mask) || !['paragraph', 'sentence'].includes(p.unit)) throw new Error('背诵记录格式无效。');
    result.practice = { source: p.source, span: p.span, mask: p.mask, unit: p.unit };
  }
  if (data.listening !== undefined) {
    const p = data.listening as ListeningState;
    if (!p || typeof p !== 'object' || !Number.isInteger(p.source) || p.source < 0 || p.source > length || typeof p.completed !== 'boolean' || !Number.isFinite(p.rate) || p.rate < 0.5 || p.rate > 2 || (p.completed && p.source !== length)) throw new Error('听读记录格式无效。');
    result.listening = { source: p.source, completed: p.completed, rate: p.rate };
  }
  if (data.readingPreference !== undefined) {
    const p = data.readingPreference as ReadingPreference;
    if (!p || typeof p !== 'object' || !['reading', 'reciting', 'practice', 'listening'].includes(p.mode) || typeof p.sentenceMode !== 'boolean' || !Number.isFinite(p.fontSize) || p.fontSize < 12 || p.fontSize > 64 || !Number.isFinite(p.speed) || p.speed < 30 || p.speed > 1600) throw new Error('本书阅读偏好格式无效。');
    result.readingPreference = { mode: p.mode, sentenceMode: p.sentenceMode, fontSize: p.fontSize, speed: p.speed };
  }
  return result;
}
export function preferencesFor(settings: Settings, mode: ReadingPreference['mode'] = 'reading'): ReadingPreference {
  return { mode, sentenceMode: settings.sentenceMode, fontSize: settings.fontSize, speed: settings.speed };
}
export function effectiveSettings(settings: Settings, book?: Book): Settings {
  const p = book?.readingPreference;
  return p ? { ...settings, fontSize: p.fontSize, speed: p.speed, sentenceMode: p.mode === 'reciting' ? false : p.sentenceMode } : settings;
}
