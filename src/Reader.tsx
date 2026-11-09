// 版权所有：波哥
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, SlidersHorizontal, RotateCcw, CornerDownLeft, ChevronDown, ArrowUpLeft } from 'lucide-react';
import { fonts, readableInk, type Book, type Settings } from './model';
import { createDocument, floorIndex, initialPosition, layoutDocument, pagination, pageTarget, readingMetrics, rowAtSource, sourcePosition } from './reading-layout';
import { buildMotion, motionFrame } from './reading-motion';
import { ReadingRenderer } from './reading-renderer';
import { ambientAudio } from './ambient-audio';
import { ReadingTools, type ReadingToolsView } from './ReadingTools';
import { glyphPosition } from './reading-layout';
import { splitSentences, sentenceIndex, sentenceStop, advanceSentence } from './sentence-reading';
import { RecitationPanel } from './RecitationPanel';
import { fixedPracticeUnits } from './practice-layout';
import { preferencesFor, type BookState, type ReadingPreference } from './book-state';

export type ReadingPosition = Pick<Book, 'line' | 'offset' | 'character' | 'completed'>;
type Props = { book: Book; settings: Settings; onBack: () => void; onSettings: () => void; onProgress: (position: ReadingPosition) => void; blocked: boolean; onBookState: (state: BookState) => Promise<void> };

export default function Reader({ book, settings, onBack, onSettings, onProgress, blocked, onBookState }: Props) {
  const documentModel = useMemo(() => createDocument(book.lines, book.typography), [book.lines, book.typography]);
  const sentences = useMemo(() => splitSentences(book.lines.join('\n')), [book.lines]);
  const sentenceTarget = useRef<number | null>(null);
  const [practiceSource, setPracticeSource] = useState<number | null>(() => book.readingPreference?.mode === 'practice' ? book.practice?.source ?? sourcePosition(documentModel, initialPosition(book, documentModel)) : null);
  const [focused, setFocused] = useState(false);
  const revealControl = useRef<HTMLButtonElement>(null), titleControl = useRef<HTMLButtonElement>(null);
  const revealControls = useCallback(() => { setFocused(false); requestAnimationFrame(() => titleControl.current?.focus({ preventScroll: true })); }, []);
  useEffect(() => { if (focused) revealControl.current?.focus({ preventScroll: true }); }, [focused]);
  const position = useRef(initialPosition(book, documentModel));
  const manualSource = useRef<number | null>(!book.completed && typeof book.character === 'number' && documentModel.wordOrdinal[floorIndex(documentModel.offsets, book.character)] < 0 ? book.character : null);
  const pageInput = useRef<HTMLInputElement>(null);
  const pageLabel = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [toolsSource, setToolsSource] = useState<number | null>(null);
  const resumeAfterTools = useRef(false);
  const [toolsView, setToolsView] = useState<ReadingToolsView>({ tab: book.contents?.length ? 'contents' : 'search', query: '', hit: null });
  const [returnPoint, setReturnPoint] = useState<{ source: number; completed: boolean } | null>(null);
  const [bounds, setBounds] = useState({ width: 320, height: 320 });
  const space = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLDivElement>(null);
  const previousButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const progressLabel = useRef<HTMLSpanElement>(null);
  const progressFill = useRef<HTMLElement>(null);
  const renderer = useRef<ReadingRenderer | null>(null);
  const metrics = useMemo(() => readingMetrics(bounds.width, bounds.height, settings, documentModel.maxScale), [bounds, settings, documentModel.maxScale]);
  const layout = useMemo(() => layoutDocument(documentModel, metrics.columns, settings.layoutMode), [documentModel, metrics.columns, settings.layoutMode]);
  const motion = useMemo(() => buildMotion(documentModel, layout, settings.cursorWords), [documentModel, layout, settings.cursorWords]);
  const latest = useRef({ onProgress, documentModel, layout, metrics, motion, settings, sentences });
  latest.current = { onProgress, documentModel, layout, metrics, motion, settings, sentences };
  const hasWords = documentModel.words.length > 0;
  const completed = hasWords && position.current >= documentModel.words.length && manualSource.current === null;
  const pageCount = pagination(layout.rows.length, metrics.visibleLines, 0).total;

  const setRunning = useCallback((value: boolean) => {
    playingRef.current = value; setPlaying(value);
    ambientAudio.configure(latest.current.settings, value);
  }, []);
  useEffect(() => { ambientAudio.configure(settings, playingRef.current); }, [settings]);
  useEffect(() => () => { ambientAudio.stopSession(); }, []);
  const persist = useCallback(() => {
    const { documentModel: doc, onProgress: save } = latest.current;
    if (!doc.glyphs.length) return;
    const character = manualSource.current ?? sourcePosition(doc, position.current);
    save({ character, line: floorIndex(doc.lineStarts, character), offset: null, completed: doc.words.length > 0 && position.current >= doc.words.length && manualSource.current === null });
  }, []);
  const currentSource = () => manualSource.current ?? sourcePosition(latest.current.documentModel, position.current);
  const currentRow = useCallback(() => {
    const { documentModel: doc, layout: lines, motion: path } = latest.current;
    if (manualSource.current !== null) return rowAtSource(doc, lines, manualSource.current);
    if (path.total && position.current >= path.total) return Math.max(0, lines.rows.length - 1);
    return motionFrame(path, position.current).rowIndex;
  }, []);
  const paint = useCallback(() => {
    const { motion: path, documentModel: doc, metrics: m, layout: lines } = latest.current;
    const frame = motionFrame(path, position.current);
    const rowIndex = currentRow();
    if (manualSource.current !== null && rowIndex !== frame.rowIndex) {
      frame.rowIndex = rowIndex; frame.y = rowIndex; frame.scroll = rowIndex;
      frame.x = lines.rows[rowIndex]?.columns[0] ?? 0;
      frame.width = 1; frame.span = 0; frame.inkX = frame.x;
    }
    if (manualSource.current !== null) frame.completed = false;
    const pages = pagination(lines.rows.length, m.visibleLines, rowIndex);
    renderer.current?.paint(frame);
    const word = Math.min(doc.words.length - 1, Math.floor(position.current));
    if (band.current) {
      band.current.dataset.position = String(position.current);
      band.current.dataset.source = String(manualSource.current ?? sourcePosition(doc, position.current));
      band.current.dataset.scroll = String(frame.scroll * m.lineHeight);
      band.current.dataset.total = String(doc.words.length);
      band.current.dataset.row = String(rowIndex);
      band.current.dataset.page = String(pages.current);
      band.current.dataset.pages = String(pages.total);
      band.current.dataset.rows = String(lines.rows.length);
    }
    const label = !doc.words.length ? '没有可计数的文字（仅有标点或空白）' : position.current >= doc.words.length && manualSource.current === null
      ? '已读完 · 愿这一刻的宁静，陪你走远一点'
      : `第 ${rowIndex + 1} 行 / 共 ${lines.rows.length} 行 · 第 ${word + 1} / ${doc.words.length} 字（不含标点）`;
    if (counter.current && counter.current.textContent !== label) counter.current.textContent = label;
    const pageText = `第 ${pages.current} / ${pages.total} 页`;
    if (pageLabel.current && pageLabel.current.textContent !== pageText) pageLabel.current.textContent = pageText;
    if (pageInput.current) pageInput.current.placeholder = String(pages.current || 1);
    const sentence = sentenceIndex(latest.current.sentences, manualSource.current ?? sourcePosition(doc, position.current));
    if (previousButton.current) previousButton.current.disabled = latest.current.settings.sentenceMode ? sentence < 0 || (sentence === 0 && position.current === 0) : pages.current <= 1;
    if (nextButton.current) nextButton.current.disabled = latest.current.settings.sentenceMode ? sentence < 0 || sentence >= latest.current.sentences.length - 1 : pages.current >= pages.total;
    const percent = `${Math.floor(frame.progress * 100)}% 已读`;
    if (progressLabel.current && progressLabel.current.textContent !== percent) progressLabel.current.textContent = percent;
    if (progressFill.current) progressFill.current.style.width = `${frame.progress * 100}%`;
  }, [currentRow]);

  useLayoutEffect(() => {
    const target = space.current;
    if (!target) return;
    const measure = () => setBounds(previous => previous.width === target.clientWidth && previous.height === target.clientHeight ? previous : { width: target.clientWidth, height: target.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(target); measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!text.current || !cursor.current) return;
    renderer.current = new ReadingRenderer(text.current, cursor.current, documentModel, layout, metrics, settings);
    paint();
    return () => { renderer.current?.dispose(); renderer.current = null; };
  }, [documentModel, layout, metrics, settings, paint]);
  useLayoutEffect(() => { paint(); });

  useEffect(() => {
    if (!playing || blocked) return;
    let animation = 0;
    let last: number | null = null;
    let saved = 0;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      const limit = latest.current.settings.sentenceMode && sentenceTarget.current !== null ? glyphPosition(documentModel, sentenceTarget.current) : documentModel.words.length;
      if (last !== null) position.current = advanceSentence(position.current, settings.speed / 60 * Math.min((now - last) / 1000, 0.1), limit).position;
      last = now;
      paint();
      if (position.current >= limit) { setRunning(false); persist(); return; }
      if (now - saved >= 1500) { persist(); saved = now; }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, blocked, settings.speed, documentModel, paint, persist, setRunning]);

  const pause = useCallback(() => { setRunning(false); persist(); }, [persist, setRunning]);
  useEffect(() => { if (blocked) pause(); }, [blocked, pause]);
  useLayoutEffect(() => {
    const back = (event: Event) => {
      event.preventDefault();
      if (focused) { revealControls(); return; }
      pause(); ambientAudio.stopSession(true); onBack();
    };
    window.addEventListener('chanyue-back', back);
    return () => window.removeEventListener('chanyue-back', back);
  }, [pause, onBack, focused, revealControls]);
  useEffect(() => {
    const leave = () => { ambientAudio.stopSession(true); pause(); };
    const hide = () => { if (document.hidden) leave(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    const listener = Capacitor.isNativePlatform() ? NativeApp.addListener('appStateChange', ({ isActive }) => { if (!isActive) leave(); }).catch(() => null) : null;
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      void listener?.then(handle => handle?.remove());
    };
  }, [pause]);

  const seek = useCallback((next: number, source: number | null = null) => {
    setRunning(false); position.current = next; manualSource.current = source; persist(); paint();
  }, [persist, paint, setRunning]);
  const openTools = () => {
    resumeAfterTools.current = playingRef.current;
    pause();
    setToolsSource(currentSource());
  };
  const selectMode = async (mode: ReadingPreference['mode']) => {
    pause();
    const preference = preferencesFor(latest.current.settings, mode);
    if (mode === 'reciting') preference.sentenceMode = false;
    const change: BookState = { readingPreference: preference };
    if (mode === 'practice' && !book.practice) {
      const units = fixedPracticeUnits(book.lines.join('\n'), 'paragraph');
      change.practice = { source: units[Math.max(0, sentenceIndex(units, currentSource()))]?.start ?? 0, span: 1, mask: 'full', unit: 'paragraph' };
    }
    await onBookState(change);
    if (mode === 'practice') setPracticeSource(currentSource());
    setToolsSource(null);
  };
  const jumpFromTools = (source: number) => {
    const doc = latest.current.documentModel;
    if (!Number.isFinite(source) || source < 0 || source > doc.length) return;
    const origin = { source: currentSource(), completed: position.current >= doc.words.length && manualSource.current === null };
    setReturnPoint(value => value ?? origin);
    seek(glyphPosition(doc, source), source);
    setToolsSource(null);
  };
  const returnFromTools = () => {
    if (!returnPoint) return;
    const doc = latest.current.documentModel;
    seek(returnPoint.completed ? doc.words.length : glyphPosition(doc, returnPoint.source), returnPoint.completed ? null : returnPoint.source);
    setReturnPoint(null); setToolsSource(null);
  };
  const toggle = useCallback(() => {
    if (!latest.current.documentModel.words.length) return;
    if (playingRef.current) { pause(); return; }
    if (position.current >= latest.current.documentModel.words.length && manualSource.current === null) seek(0);
    const { documentModel: doc, sentences, settings: preferences } = latest.current;
    sentenceTarget.current = preferences.sentenceMode ? sentenceStop(sentences, manualSource.current ?? sourcePosition(doc, position.current), doc.length) : null;
    manualSource.current = null;
    ambientAudio.start(latest.current.settings);
    setRunning(true);
  }, [pause, seek, setRunning]);
  const goToPage = useCallback((page: number) => {
    const { layout: lines, metrics: m, documentModel: doc } = latest.current;
    const target = pageTarget(lines, m.visibleLines, page);
    if (!target) return;
    seek(target.position, doc.offsets[lines.rows[target.rowIndex].start]);
    if (pageInput.current) pageInput.current.value = '';
  }, [seek]);
  const step = useCallback((direction: number) => {
    const { layout: lines, metrics: m, documentModel: doc, sentences, settings: preferences } = latest.current;
    if (preferences.sentenceMode) {
      const index = sentenceIndex(sentences, manualSource.current ?? sourcePosition(doc, position.current));
      const finished = position.current >= doc.words.length && manualSource.current === null;
      const target = sentences[Math.max(0, Math.min(sentences.length - 1, finished && direction < 0 ? index : index + direction))];
      if (target) seek(glyphPosition(doc, target.start), target.start);
      return;
    }
    const pages = pagination(lines.rows.length, m.visibleLines, currentRow());
    const next = Math.max(1, Math.min(pages.total, pages.current + direction));
    if (next !== pages.current) goToPage(next);
  }, [goToPage, currentRow, seek]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (focused && event.key === 'Escape' && !blocked && toolsSource === null && practiceSource === null) { event.preventDefault(); revealControls(); return; }
      if (blocked || toolsSource !== null || practiceSource !== null || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest('input,button,select,textarea,[contenteditable=true]'))) return;
      if (event.code === 'Space') { event.preventDefault(); toggle(); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [blocked, toolsSource, practiceSource, toggle, step, focused, revealControls]);

  const ink = readableInk(settings.pageColor);
  const width = metrics.columns * metrics.cellWidth;
  return <div className={`reader reader-v2${focused ? ' reader-focused' : ''}`} style={{ background: settings.pageColor, color: ink, '--reader-ink': ink, '--reader-button-text': settings.pageColor, '--cursor-color': settings.cursorTransparent ? 'transparent' : settings.cursorColor } as CSSProperties}>
    <header className="reader-header" hidden={focused}>
      <button className="reader-back" aria-label="返回书架" title="返回书架" onClick={() => { pause(); onBack(); }}><ArrowLeft size={20} /></button>
      <div className="reader-book-name reader-tools-entry"><button ref={titleControl} className="reader-title-button" aria-label="目录、搜索与书签" title="目录、搜索与书签" aria-haspopup="dialog" onClick={openTools}><strong>{book.title}</strong><ChevronDown size={14} /></button>{returnPoint && <button className="reader-return" aria-label="返回刚才的阅读位置" title="返回刚才的阅读位置" onClick={returnFromTools}><ArrowUpLeft size={16} /></button>}</div>
      <button className="icon-button reader-settings" aria-label="阅读设置" title="阅读设置" onClick={() => { pause(); onSettings(); }}><SlidersHorizontal size={20} /></button>
    </header>
    {focused && <button ref={revealControl} className="focus-restore" aria-label="显示操作区" title="显示操作区（Esc）" onClick={revealControls}><SlidersHorizontal size={19} /><span className="sr-only">显示操作区</span></button>}
    <main className="reading-workspace" onClick={event => { if (focused && event.target instanceof Element && !event.target.closest('.flowing-text,.scan-cursor') && !window.getSelection()?.toString()) revealControls(); }} ref={space} style={practiceSource !== null ? { visibility: 'hidden' } : undefined} aria-hidden={practiceSource !== null}>
      <div className="reading-band multiline-band" ref={band} data-testid="reading-band" data-max-lines={settings.maxLines} data-visible-lines={metrics.visibleLines} data-line-height={metrics.lineHeight} data-cell-width={metrics.cellWidth} data-columns={metrics.columns} data-mode={settings.layoutMode} data-cursor-words={settings.cursorWords} data-cursor-mode={settings.cursorMode} data-cursor-row={metrics.cursorRow} data-requested-cursor-row={settings.cursorRow} data-underline-offset={metrics.underlineOffset}
        style={{ width: width + 32, height: '100%', background: settings.lineColor, color: settings.textColor, fontSize: metrics.fontSize, fontFamily: fonts[settings.font], '--cell-width': `${metrics.cellWidth}px`, '--line-height': `${metrics.lineHeight}px` } as CSSProperties}>
        <div className="reading-grid" style={{ width }}>
          <div className="flowing-text multiline-text" ref={text} aria-label="阅读正文" />
          <div className="scan-cursor" ref={cursor} aria-hidden="true" />
        </div>
      </div>
    </main>
    <div className="reading-under v2-controls" hidden={focused}>
      <div className="line-counter sr-only" ref={counter} aria-live={playing ? 'off' : 'polite'} />
      <div className="reader-controls"><button className="step-button" ref={previousButton} aria-label={settings.sentenceMode ? '回退一句' : '后退一页'} onClick={() => step(-1)}><SkipBack size={21} /><span>{settings.sentenceMode ? '回退一句' : '后退一页'}</span></button><button className="play-button" disabled={!hasWords} aria-label={playing ? '停止' : completed ? '重新阅读' : settings.sentenceMode ? '开始本句' : '开始'} onClick={toggle}>{playing ? <Pause size={21} fill="currentColor" /> : completed ? <RotateCcw size={21} /> : <Play size={21} fill="currentColor" />}<span>{playing ? '停止' : completed ? '重新阅读' : settings.sentenceMode ? '开始本句' : '开始阅读'}</span></button><button className="step-button" ref={nextButton} aria-label={settings.sentenceMode ? '前进一句' : '前进一页'} onClick={() => step(1)}><SkipForward size={21} /><span>{settings.sentenceMode ? '前进一句' : '前进一页'}</span></button></div>
      <form className="page-navigation" aria-label="页码跳转" onSubmit={event => {
        event.preventDefault();
        const input = pageInput.current;
        if (!input) return;
        goToPage(input.valueAsNumber);
        input.blur();
      }}>
        <span ref={pageLabel} aria-live={playing ? 'off' : 'polite'} />
        <label htmlFor="reading-page" className="sr-only">跳转页码</label>
        <input id="reading-page" ref={pageInput} type="number" inputMode="numeric" enterKeyHint="go" min="1" max={pageCount || 1} step="1" required disabled={!pageCount} onFocus={pause} aria-label="跳转页码" />
        <button type="submit" aria-label="跳转" title="跳转到指定页" disabled={!pageCount}><CornerDownLeft size={16} /></button>
        <span className="reading-progress-label" ref={progressLabel} />
      </form>
      <div className="reader-progress" aria-hidden="true"><i ref={progressFill} /></div>
    </div>
    {toolsSource !== null && <ReadingTools book={book} source={toolsSource} view={toolsView} onViewChange={change => setToolsView(value => ({ ...value, ...change }))} onClose={() => setToolsSource(null)} onJump={jumpFromTools} canReturn={returnPoint !== null} onReturn={returnFromTools} onPractice={() => selectMode('practice')} onMode={selectMode} onFocus={() => { setToolsSource(null); setFocused(true); if (resumeAfterTools.current) toggle(); }} />}
    {practiceSource !== null && <RecitationPanel book={book} source={practiceSource} settings={settings} onSave={practice => onBookState({ practice })} onClose={() => setPracticeSource(null)} />}
  </div>;
}
