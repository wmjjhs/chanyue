// 版权所有：波哥
import { sentenceIndex, splitSentences, type Sentence } from './sentence-reading';
import type { ListeningState } from './book-state';
import type { SpeechDriver } from './system-speech';

export type ListeningSnapshot = ListeningState & { active: boolean; speaking: boolean; focus: number; error: string };
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
  private stopped: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private state: ListeningSnapshot;
  constructor(private text: string, private driver: SpeechDriver, initial: ListeningState, private save: (state: ListeningState) => Promise<void>) {
    this.sentences = splitSentences(text);
    this.state = { ...initial, active: false, speaking: false, focus: initial.source, error: '' };
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
    this.update({ active: true, error: '' });
    try {
      await this.stopped;
      if (epoch !== this.epoch) return;
      await this.driver.prepare();
      if (epoch !== this.epoch) return;
      if (!this.sentences.length) throw new Error('本书没有可朗读的文字。');
      let index = this.state.completed ? 0 : sentenceIndex(this.sentences, this.state.source);
      for (; index < this.sentences.length; index++) {
        if (epoch !== this.epoch) return;
        const range = this.sentences[index];
        const next = { source: range.start, completed: false, rate: this.state.rate };
        await this.persist(next);
        if (epoch !== this.epoch) return;
        this.update({ ...next, focus: range.start, speaking: false });
        for (const chunk of speechChunks(this.text, range)) {
          if (epoch !== this.epoch) return;
          await this.driver.speak(this.text.slice(chunk.start, chunk.end), this.state.rate, () => {
            if (epoch === this.epoch) this.update({ speaking: true, focus: chunk.start });
          });
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
    this.update({ ...next, focus: next.source, error: '' });
    try { await this.persist(next); }
    catch (error) { if (epoch === this.epoch) this.update({ error: '听读位置尚未保存，请检查空间后重试。' }); throw error; }
  }
  step(direction: number) {
    const index = sentenceIndex(this.sentences, this.state.source);
    const target = this.sentences[Math.max(0, Math.min(this.sentences.length - 1, this.state.completed && direction < 0 ? index : index + direction))];
    if (target) void this.seek(target.start).catch(() => {});
  }
}
