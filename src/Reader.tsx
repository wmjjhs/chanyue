// 版权所有：波哥
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, SlidersHorizontal, RotateCcw, CornerDownLeft } from 'lucide-react';
import { fonts, readableInk, type Book, type Settings } from './model';
import { createDocument, floorIndex, initialPosition, layoutDocument, pagination, pageTarget, readingMetrics, rowAtSource, sourcePosition } from './reading-layout';
import { buildMotion, motionFrame } from './reading-motion';
import { ReadingRenderer } from './reading-renderer';

export type ReadingPosition = Pick<Book, 'line' | 'offset' | 'character' | 'completed'>;
type Props = { book: Book; settings: Settings; onBack: () => void; onSettings: () => void; onProgress: (position: ReadingPosition) => void; blocked: boolean };

export default function Reader({ book, settings, onBack, onSettings, onProgress, blocked }: Props) {
  const documentModel = useMemo(() => createDocument(book.lines), [book.lines]);
  const position = useRef(initialPosition(book, documentModel));
  const manualSource = useRef<number | null>(!book.completed && typeof book.character === 'number' && documentModel.wordOrdinal[floorIndex(documentModel.offsets, book.character)] < 0 ? book.character : null);
  const pageInput = useRef<HTMLInputElement>(null);
  const pageLabel = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
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
  const metrics = useMemo(() => readingMetrics(bounds.width, bounds.height, settings), [bounds, settings]);
  const layout = useMemo(() => layoutDocument(documentModel, metrics.columns, settings.layoutMode), [documentModel, metrics.columns, settings.layoutMode]);
  const motion = useMemo(() => buildMotion(documentModel, layout, settings.cursorWords), [documentModel, layout, settings.cursorWords]);
  const latest = useRef({ onProgress, documentModel, layout, metrics, motion });
  latest.current = { onProgress, documentModel, layout, metrics, motion };
  const hasWords = documentModel.words.length > 0;
  const completed = hasWords && position.current >= documentModel.words.length && manualSource.current === null;
  const pageCount = pagination(layout.rows.length, metrics.visibleLines, 0).total;

  const setRunning = useCallback((value: boolean) => { playingRef.current = value; setPlaying(value); }, []);
  const persist = useCallback(() => {
    const { documentModel: doc, onProgress: save } = latest.current;
    if (!doc.glyphs.length) return;
    const character = manualSource.current ?? sourcePosition(doc, position.current);
    save({ character, line: floorIndex(doc.lineStarts, character), offset: null, completed: doc.words.length > 0 && position.current >= doc.words.length && manualSource.current === null });
  }, []);
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
    if (previousButton.current) previousButton.current.disabled = pages.current <= 1;
    if (nextButton.current) nextButton.current.disabled = pages.current >= pages.total;
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
      if (last !== null) position.current = Math.min(documentModel.words.length, position.current + settings.speed / 60 * Math.min((now - last) / 1000, 0.1));
      last = now;
      paint();
      if (position.current >= documentModel.words.length) { setRunning(false); persist(); return; }
      if (now - saved >= 1500) { persist(); saved = now; }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, blocked, settings.speed, documentModel, paint, persist, setRunning]);

  const pause = useCallback(() => { setRunning(false); persist(); }, [persist, setRunning]);
  useEffect(() => { if (blocked) pause(); }, [blocked, pause]);
  useEffect(() => {
    const hide = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', pause);
    const listener = Capacitor.isNativePlatform() ? NativeApp.addListener('appStateChange', ({ isActive }) => { if (!isActive) pause(); }).catch(() => null) : null;
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', pause);
      void listener?.then(handle => handle?.remove());
    };
  }, [pause]);

  const seek = useCallback((next: number, source: number | null = null) => {
    setRunning(false); position.current = next; manualSource.current = source; persist(); paint();
  }, [persist, paint, setRunning]);
  const toggle = useCallback(() => {
    if (!latest.current.documentModel.words.length) return;
    if (playingRef.current) { pause(); return; }
    if (position.current >= latest.current.documentModel.words.length && manualSource.current === null) seek(0);
    manualSource.current = null;
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
    const { layout: lines, metrics: m } = latest.current;
    const pages = pagination(lines.rows.length, m.visibleLines, currentRow());
    const next = Math.max(1, Math.min(pages.total, pages.current + direction));
    if (next !== pages.current) goToPage(next);
  }, [goToPage, currentRow]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (blocked || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest('input,button,select,textarea,[contenteditable=true]'))) return;
      if (event.code === 'Space') { event.preventDefault(); toggle(); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [blocked, toggle, step]);

  const ink = readableInk(settings.pageColor);
  const width = metrics.columns * metrics.cellWidth;
  return <div className="reader reader-v2" style={{ background: settings.pageColor, color: ink, '--reader-ink': ink, '--reader-button-text': settings.pageColor, '--cursor-color': settings.cursorTransparent ? 'transparent' : settings.cursorColor } as CSSProperties}>
    <header className="reader-header">
      <button className="reader-back" aria-label="返回书架" title="返回书架" onClick={() => { pause(); onBack(); }}><ArrowLeft size={20} /></button>
      <div className="reader-book-name"><strong title={book.title}>{book.title}</strong></div>
      <button className="icon-button reader-settings" aria-label="阅读设置" title="阅读设置" onClick={() => { pause(); onSettings(); }}><SlidersHorizontal size={20} /></button>
    </header>
    <main className="reading-workspace" ref={space}>
      <div className="reading-band multiline-band" ref={band} data-testid="reading-band" data-max-lines={settings.maxLines} data-visible-lines={metrics.visibleLines} data-line-height={metrics.lineHeight} data-cell-width={metrics.cellWidth} data-columns={metrics.columns} data-mode={settings.layoutMode} data-cursor-words={settings.cursorWords} data-cursor-mode={settings.cursorMode} data-cursor-row={metrics.cursorRow} data-requested-cursor-row={settings.cursorRow} data-underline-offset={metrics.underlineOffset}
        style={{ width: width + 32, height: '100%', background: settings.lineColor, color: settings.textColor, fontSize: metrics.fontSize, fontFamily: fonts[settings.font], '--cell-width': `${metrics.cellWidth}px`, '--line-height': `${metrics.lineHeight}px` } as CSSProperties}>
        <div className="reading-grid" style={{ width }}>
          <div className="flowing-text multiline-text" ref={text} aria-label="阅读正文" />
          <div className="scan-cursor" ref={cursor} aria-hidden="true" />
        </div>
      </div>
    </main>
    <div className="reading-under v2-controls">
      <div className="line-counter sr-only" ref={counter} aria-live={playing ? 'off' : 'polite'} />
      <div className="reader-controls"><button className="step-button" ref={previousButton} aria-label="后退一页" onClick={() => step(-1)}><SkipBack size={21} /><span>后退一页</span></button><button className="play-button" disabled={!hasWords} aria-label={playing ? '停止' : completed ? '重新阅读' : '开始'} onClick={toggle}>{playing ? <Pause size={21} fill="currentColor" /> : completed ? <RotateCcw size={21} /> : <Play size={21} fill="currentColor" />}<span>{playing ? '停止' : completed ? '重新阅读' : '开始阅读'}</span></button><button className="step-button" ref={nextButton} aria-label="前进一页" onClick={() => step(1)}><SkipForward size={21} /><span>前进一页</span></button></div>
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
  </div>;
}
