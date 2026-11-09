// 版权所有：波哥
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Modal } from './components';
import { fonts, type Book, type Settings } from './model';
import { maskSentence, sentenceIndex } from './sentence-reading';
import { fixedPracticeUnits, practiceRange, connectPrevious } from './practice-layout';
import type { PracticeState } from './book-state';

export function RecitationPanel({ book, source, settings, onClose, onSave }: {
  book: Book; source: number; settings: Settings; onClose: () => void; onSave: (state: PracticeState) => Promise<void>;
}) {
  const text = useMemo(() => book.lines.join('\n'), [book.lines]);
  const [state, setState] = useState<PracticeState>(() => book.practice ?? { source: Math.floor(source), span: 1, mask: 'full', unit: 'paragraph' });
  const units = useMemo(() => fixedPracticeUnits(text, state.unit), [text, state.unit]);
  const { index, ranges } = practiceRange(units, state.source, state.span);
  const [reveal, setReveal] = useState<number | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), pending = useRef<PracticeState | null>(null);
  const change = async (next: PracticeState) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); pending.current = next;
    setState(next); setReveal(null);
    try { await onSave(next); pending.current = null; }
    catch { setError('练习记录尚未保存，已保留当前练习。请重试；不要直接关闭应用。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const close = () => { if (!lock.current && !pending.current) onClose(); };
  const move = (next: number) => { const unit = units[next]; if (unit) void change({ ...state, source: unit.start }); };
  return <Modal title="小段背诵" eyebrow={book.title} onClose={close} className="recitation-modal">
    <p className="field-note">分段固定，不随字号或横竖屏改变。记住本书的练习位置和遮字程度，不改变阅读进度。长段按2000字符续分，下一段可接着练完。</p>
    <div className="practice-range"><label>分段 <select aria-label="练习分段" disabled={busy} value={state.unit} onChange={event => {
      const unit = event.target.value as PracticeState['unit'], nextUnits = fixedPracticeUnits(text, unit);
      const start = nextUnits[Math.max(0, sentenceIndex(nextUnits, state.source))]?.start ?? 0;
      void change({ ...state, unit, source: start, span: 1 });
    }}><option value="paragraph">按原文段落</option><option value="sentence">按句练习</option></select></label><label>练习范围 <select aria-label="练习段数" disabled={busy} value={state.span} onChange={event => void change({ ...state, span: Number(event.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}段</option>)}</select></label></div>
    <div className="practice-levels" aria-label="遮字程度">{([['full', '看全文'], ['partial', '遮一部分'], ['cue', '留句首'], ['hidden', '全遮']] as const).map(([id, label]) => <button key={id} className="secondary-button" disabled={busy} aria-pressed={state.mask === id} onClick={() => void change({ ...state, source: units[index]?.start ?? 0, mask: id })}>{label}</button>)}</div>
    <div className="practice-text" style={{ background: settings.lineColor, color: settings.textColor, fontFamily: fonts[settings.font], fontSize: Math.min(36, settings.fontSize) } as CSSProperties}>
      {ranges.map((range, i) => <button className="practice-sentence" key={`${range.start}-${state.mask}`} aria-label={state.mask === 'full' ? undefined : reveal === i ? `第${i + 1}段，点击重新遮住` : `第${i + 1}段，点击揭示`} disabled={state.mask === 'full'} aria-pressed={reveal === i} onClick={() => setReveal(reveal === i ? null : i)}><span>{maskSentence(text.slice(range.start, range.end), reveal === i ? 'full' : state.mask)}</span></button>)}
      {!ranges.length && <p>这里没有可练习的文字。</p>}
    </div>
    <p className="field-note" role="status">{ranges.length ? `第${index + 1}–${index + ranges.length}段 / 共${units.length}段` : '请选择有正文的书籍'}{state.mask !== 'full' && ' · 点一段揭示，再点收起'}{busy ? ' · 正在保存' : book.practice && !error ? ' · 已记住练习位置' : ''}</p>
    <div className="practice-navigation"><button className="text-button" disabled={busy || index === 0} onClick={() => move(index - 1)}>前一段</button><button className="secondary-button" disabled={busy || index === 0 || state.span >= 4} onClick={() => void change(connectPrevious(units, state))}>连同前段练</button><button className="text-button" disabled={busy || index + ranges.length >= units.length} onClick={() => move(index + ranges.length)}>下一段</button></div>
    {error && <div className="tools-discard"><p className="error-note" role="alert">{error}</p><button className="secondary-button" disabled={busy} onClick={() => void change(pending.current ?? state)}>重试保存练习</button><button className="text-button" disabled={busy} onClick={() => { pending.current = null; onClose(); }}>放弃本次记录并关闭</button></div>}
    <button className="primary-button full-width" disabled={busy || !!error} onClick={close}>结束练习，回到原处</button>
  </Modal>;
}
