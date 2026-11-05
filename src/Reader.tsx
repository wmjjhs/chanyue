// 版权所有：波哥
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, SlidersHorizontal, Focus, Minimize, RotateCcw } from 'lucide-react';
import { fonts, readableInk, type Book, type Settings } from './model';
import { createDocument, floorIndex, initialPosition, layoutDocument, readingMetrics, scanFrame, sourcePosition } from './reading-layout';

export type ReadingPosition = Pick<Book, 'line' | 'offset' | 'character' | 'completed'>;
type Props = { book: Book; settings: Settings; onBack: () => void; onSettings: () => void; onProgress: (position: ReadingPosition) => void; blocked: boolean };

export default function Reader({ book, settings, onBack, onSettings, onProgress, blocked }: Props) {
  const documentModel = useMemo(() => createDocument(book.lines), [book.lines]);
  const position = useRef(initialPosition(book, documentModel));
  const [active, setActive] = useState(() => Math.min(documentModel.glyphs.length - 1, Math.floor(position.current)));
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [bounds, setBounds] = useState({ width: 320, height: 320 });
  const space = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const progressFill = useRef<HTMLElement>(null);
  const metrics = useMemo(() => readingMetrics(bounds.width, bounds.height, settings), [bounds, settings]);
  const layout = useMemo(() => layoutDocument(documentModel, metrics.columns, settings.layoutMode), [documentModel, metrics.columns, settings.layoutMode]);
  const currentRow = layout.rowOf[Math.max(0, active)] ?? 0;
  const startRow = Math.max(0, currentRow - 1);
  const visibleRows = layout.rows.slice(startRow, startRow + metrics.visibleLines);
  const latest = useRef({ book, onProgress, documentModel, layout, metrics, startRow });
  latest.current = { book, onProgress, documentModel, layout, metrics, startRow };

  const setRunning = useCallback((value: boolean) => { playingRef.current = value; setPlaying(value); }, []);
  const persist = useCallback(() => {
    const { documentModel: doc, onProgress: save } = latest.current;
    const character = sourcePosition(doc, position.current);
    save({ character, line: floorIndex(doc.lineStarts, character), offset: null, completed: position.current >= doc.glyphs.length });
  }, []);
  const paint = useCallback(() => {
    const { layout: lines, metrics: m, startRow: start } = latest.current;
    const frame = scanFrame(lines, Math.min(position.current, lines.rowOf.length - 0.000001), m.lineHeight);
    const y = m.lineHeight - frame.scroll;
    if (text.current) text.current.style.transform = `translate3d(0, ${y + start * m.lineHeight}px, 0)`;
    if (cursor.current) {
      cursor.current.style.transform = `translate3d(${frame.column * m.cellWidth}px, ${y + frame.rowIndex * m.lineHeight}px, 0)`;
      cursor.current.style.setProperty('--sweep', `${(position.current % 1) * 100}%`);
    }
    if (band.current) {
      band.current.dataset.position = String(position.current);
      band.current.dataset.scroll = String(frame.scroll);
    }
    if (progressFill.current) progressFill.current.style.width = `${position.current / Math.max(1, lines.rowOf.length) * 100}%`;
  }, []);

  useLayoutEffect(() => {
    const target = space.current;
    if (!target) return;
    const measure = () => setBounds({ width: target.clientWidth, height: target.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(target); measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { paint(); }, [active, layout, metrics, paint]);

  useEffect(() => {
    if (!playing || blocked) return;
    let animation = 0;
    let last: number | null = null;
    let saved = 0;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      if (last !== null) position.current = Math.min(documentModel.glyphs.length, position.current + settings.speed / 60 * Math.min((now - last) / 1000, 0.1));
      last = now;
      const next = Math.max(0, Math.min(documentModel.glyphs.length - 1, Math.floor(position.current)));
      if (next !== activeRef.current) {
        activeRef.current = next;
        flushSync(() => setActive(next));
      }
      paint();
      if (position.current >= documentModel.glyphs.length) { setRunning(false); persist(); return; }
      if (now - saved >= 1500) { persist(); saved = now; }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, blocked, settings.speed, documentModel, paint, persist, setRunning]);
  const activeRef = useRef(active);
  activeRef.current = active;

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

  const seek = useCallback((next: number) => {
    setRunning(false);
    position.current = next;
    activeRef.current = Math.floor(next);
    setActive(Math.floor(next));
    persist();
    requestAnimationFrame(paint);
  }, [persist, paint, setRunning]);
  const toggle = useCallback(() => {
    if (playingRef.current) { pause(); return; }
    if (position.current >= latest.current.documentModel.glyphs.length) seek(0);
    setRunning(true);
  }, [pause, seek, setRunning]);
  const step = useCallback((direction: number) => {
    const lines = latest.current.layout;
    const row = lines.rowOf[Math.min(lines.rowOf.length - 1, Math.floor(position.current))] ?? 0;
    const next = Math.max(0, Math.min(lines.rows.length - 1, row + direction));
    if (next !== row) seek(lines.rows[next].start);
  }, [seek]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (blocked || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest('input,button,select,textarea,[contenteditable=true]'))) return;
      if (event.code === 'Space') { event.preventDefault(); toggle(); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      if (event.key === 'Escape') setFocused(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [blocked, toggle, step]);

  const ink = readableInk(settings.pageColor);
  const cursorInk = readableInk(settings.cursorColor);
  const completed = position.current >= documentModel.glyphs.length;
  const percentage = completed ? 100 : Math.floor(active / Math.max(1, documentModel.glyphs.length) * 100);
  const width = metrics.columns * metrics.cellWidth;
  return <div className={`reader reader-v2 ${focused ? 'is-focused' : ''}`} style={{ background: settings.pageColor, color: ink, '--reader-ink': ink, '--reader-button-text': settings.pageColor, '--cursor-color': settings.cursorColor, '--cursor-ink': cursorInk, '--cursor-scale': settings.cursorScale } as CSSProperties}>
    <header className="reader-header">
      <button className="reader-back" aria-label="返回书架" onClick={() => { pause(); onBack(); }}><ArrowLeft size={19} /><span>返回书架</span></button>
      <div className="reader-book-name"><span>循字而读 · 不必追赶</span><strong>{book.title}</strong></div>
      <div className="reader-tools"><button className="icon-button focus-toggle" aria-label={focused ? '退出专注模式' : '进入专注模式'} onClick={() => setFocused(value => !value)}>{focused ? <Minimize size={20} /> : <Focus size={20} />}</button><button className="icon-button" aria-label="阅读设置" onClick={() => { pause(); onSettings(); }}><SlidersHorizontal size={20} /></button></div>
    </header>
    <div className="reader-mode-info"><span>{settings.layoutMode === 'semantic' ? '语义段落' : '紧凑排列'}</span><i />{settings.speed} 字/分钟<i />显示 {metrics.visibleLines} / 最多 {settings.maxLines} 行{metrics.fontSize < settings.fontSize - 1 && <span> · 已适配屏幕字号</span>}</div>
    <main className="reading-workspace" ref={space}>
      <div className="reading-band multiline-band" ref={band} data-testid="reading-band" data-max-lines={settings.maxLines} data-visible-lines={metrics.visibleLines} data-line-height={metrics.lineHeight} data-columns={metrics.columns} data-mode={settings.layoutMode}
        style={{ width: width + 32, height: metrics.lineHeight * metrics.visibleLines, background: settings.lineColor, color: settings.textColor, fontSize: metrics.fontSize, fontFamily: fonts[settings.font], '--cell-width': `${metrics.cellWidth}px`, '--line-height': `${metrics.lineHeight}px` } as CSSProperties}>
        <div className="reading-grid" style={{ width }}>
          <div className="flowing-text multiline-text" ref={text} aria-label="阅读正文">
            {visibleRows.map((row, rowIndex) => <div className={`reading-row ${row.paragraph ? 'paragraph-start' : ''}`} key={`${settings.layoutMode}-${row.start}`} data-row={startRow + rowIndex} style={{ height: metrics.lineHeight }}>
              {documentModel.glyphs.slice(row.start, row.end).map((glyph, index) => <span key={row.start + index} data-char={row.start + index} data-source={documentModel.offsets[row.start + index]} className={`reading-glyph ${row.start + index === active ? 'is-current' : ''}`} style={{ left: row.columns[index] * metrics.cellWidth }}><span>{glyph}</span></span>)}
            </div>)}
          </div>
          <div className="scan-cursor" ref={cursor} aria-hidden="true" data-active={active}><span className="cursor-sweep" /></div>
        </div>
      </div>
    </main>
    <div className="reading-under v2-controls">
      <div className="line-counter" aria-live={playing ? 'off' : 'polite'}>{completed ? '已读完 · 愿这一刻的宁静，陪你走远一点' : `第 ${currentRow + 1} 行 / 共 ${layout.rows.length} 行 · 第 ${active + 1} / ${documentModel.glyphs.length} 字`}</div>
      <div className="reader-controls"><button className="step-button" disabled={currentRow === 0} aria-label="后退1行" onClick={() => step(-1)}><SkipBack size={21} /><span>后退一行</span></button><button className="play-button" aria-label={playing ? '停止' : completed ? '重新阅读' : '开始'} onClick={toggle}>{playing ? <Pause size={21} fill="currentColor" /> : completed ? <RotateCcw size={21} /> : <Play size={21} fill="currentColor" />}<span>{playing ? '停止' : completed ? '重新阅读' : '开始阅读'}</span></button><button className="step-button" disabled={currentRow >= layout.rows.length - 1} aria-label="前进1行" onClick={() => step(1)}><SkipForward size={21} /><span>前进一行</span></button></div>
      <p className="reader-hint">{playing ? '跟随整字光标，文字缓缓上移' : '先慢一点；感到不适时，请暂停休息'}</p>
    </div>
    <footer className="reader-footer"><span>禅阅 <i /> 每一个字，都从容</span><span className="keyboard-tip">空格 开始 / 停止 <b>·</b> ← → 切换视觉行</span><span>{percentage}% 已读</span></footer>
    <div className="reader-progress"><i ref={progressFill} /></div>
  </div>;
}
