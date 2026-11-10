// 版权所有：波哥
import { sentenceIndex, splitSentences, type Sentence } from './sentence-reading';
import type { ListeningState } from './book-state';
import type { SpeechDriver } from './system-speech';

export type ListeningSnapshot = ListeningState & {
  active: boolean; speaking: boolean; focus: number; error: string; seekId: number;
  startedId: number; duration: number; spokenEnd: number;
};
/** 无精确音频时长时，rate=1 下的估算朗读速度（字/秒）。 */
export const DEFAULT_SPEECH_SPEED = 4.2;
export const MIN_SPEECH_SPEED = 1.5;
export const MAX_SPEECH_SPEED = 12;
const clampSpeed = (value: number) => Math.max(MIN_SPEECH_SPEED, Math.min(MAX_SPEECH_SPEED, value));

/** 用原生给出的真实音频时长换算滚动速度；缺时长或非法数据返回 null。 */
export function measuredSpeechSpeed(words: number, seconds: number): number | null {
  if (!Number.isFinite(words) || !Number.isFinite(seconds) || words <= 0 || seconds < 0.05 || seconds > 600) return null;
  return clampSpeed(words / seconds);
}

/** 按上一句的实际朗读耗时校正滚动速度；无效样本保持现有速度，避免跳变。 */
export function adaptiveSpeechSpeed(current: number, words: number, seconds: number, rate: number): number {
  const safe = clampSpeed(Number.isFinite(current) ? current : DEFAULT_SPEECH_SPEED);
  if (!Number.isFinite(words) || !Number.isFinite(seconds) || !Number.isFinite(rate) || words <= 1 || seconds <= 0.25 || rate <= 0) return safe;
  const measured = words / seconds / Math.max(0.5, Math.min(2, rate));
  return clampSpeed(safe * 0.55 + measured * 0.45);
}

/** 每帧朝目标速度靠拢，句界不出现瞬时加速/减速，残差交给下一句自然消化。 */
export function smoothSpeechSpeed(current: number, target: number, seconds: number): number {
  const step = 6 * Math.max(0, Math.min(0.1, seconds));
  return current + Math.max(-step, Math.min(step, target - current));
}
export function speechChunks(text: string, range: Sentence): Sentence[] {
  const chunks: Sentence[] = [];
  for (let start = range.start; start < range.end;) {
    let end = Math.min(start + 1000, range.end);
    if (end < range.end && /[\uDC00-\uDFFF]/.test(text[end]) && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push({ start, end }); start = end;
  }
  return chunks;
}
export class SentenceListening {
  readonly sentences: Sentence[];
  private epoch = 0;
  private seekId = 0;
  private startedId = 0;
  private stopped: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private state: ListeningSnapshot;
  constructor(private text: string, private driver: SpeechDriver, initial: ListeningState, private save: (state: ListeningState) => Promise<void>) {
    this.sentences = splitSentences(text);
    this.state = { ...initial, active: false, speaking: false, focus: initial.source, error: '', seekId: 0, startedId: 0, duration: 0, spokenEnd: initial.source };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<ListeningSnapshot>) { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  private persist(state: ListeningState) {
    return this.save(state).catch(() => { throw new Error('听读位置尚未保存，请检查空间后重试。'); });
  }
  pause = () => {
    this.epoch++;
    this.update({ active: false, speaking: false });
    this.stopped = this.stopped.catch(() => {}).then(() => this.driver.stop());
    void this.stopped.catch(() => {});
  };
  async start() {
    this.pause();
    const epoch = this.epoch;
    // 开始/重开都从当前句句首重读，属于主动定位，允许界面回到句首。
    // 已听完重听时从首句开始，不能用书末的保存位置来定位。
    let index = this.state.completed ? 0 : Math.max(0, sentenceIndex(this.sentences, this.state.source));
    const focus = this.sentences[index]?.start ?? 0;
    this.seekId++;
    this.update({ active: true, error: '', seekId: this.seekId, focus, speaking: false, duration: 0, spokenEnd: focus });
    try {
      await this.stopped;
      if (epoch !== this.epoch) return;
      await this.driver.prepare();
      if (epoch !== this.epoch) return;
      if (!this.sentences.length) throw new Error('本书没有可朗读的文字。');
      for (; index < this.sentences.length; index++) {
        if (epoch !== this.epoch) return;
        const range = this.sentences[index];
        const next = { source: range.start, completed: false, rate: this.state.rate };
        await this.persist(next);
        if (epoch !== this.epoch) return;
        this.update({ ...next, focus: range.start, speaking: false, duration: 0, spokenEnd: range.end });
        const chunks = speechChunks(this.text, range);
        const followingSentence = this.sentences[index + 1];
        const upcoming = followingSentence ? speechChunks(this.text, followingSentence)[0] : undefined;
        for (let position = 0; position < chunks.length; position++) {
          if (epoch !== this.epoch) return;
          const chunk = chunks[position];
          const following = chunks[position + 1] ?? upcoming;
          await this.driver.speak(
            this.text.slice(chunk.start, chunk.end),
            this.state.rate,
            seconds => {
              if (epoch !== this.epoch) return;
              const duration = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 && seconds <= 600 ? seconds : 0;
              this.startedId++;
              this.update({ speaking: true, focus: chunk.start, duration, spokenEnd: chunk.end, startedId: this.startedId });
            },
            following ? this.text.slice(following.start, following.end) : '',
          );
        }
      }
      if (epoch !== this.epoch) return;
      const done = { source: this.text.length, completed: true, rate: this.state.rate };
      await this.persist(done);
      if (epoch === this.epoch) this.update({ ...done, active: false, speaking: false });
    } catch (error) {
      if (epoch === this.epoch) {
        this.pause();
        this.update({ error: error instanceof Error ? error.message : '朗读中断，请重新开始当前句。' });
      }
    }
  }
  async seek(source: number, rate = this.state.rate) {
    this.pause();
    const epoch = this.epoch;
    const index = sentenceIndex(this.sentences, source);
    const next = { source: this.sentences[index]?.start ?? 0, completed: false, rate: Math.max(0.5, Math.min(2, rate)) };
    this.seekId++;
    this.update({ ...next, focus: next.source, error: '', seekId: this.seekId, duration: 0, spokenEnd: next.source, speaking: false });
    try { await this.persist(next); }
    catch (error) { if (epoch === this.epoch) this.update({ error: '听读位置尚未保存，请检查空间后重试。' }); throw error; }
  }
  step(direction: number) {
    const index = sentenceIndex(this.sentences, this.state.source);
    const target = this.sentences[Math.max(0, Math.min(this.sentences.length - 1, this.state.completed && direction < 0 ? index : index + direction))];
    if (target) void this.seek(target.start).catch(() => {});
  }
}
