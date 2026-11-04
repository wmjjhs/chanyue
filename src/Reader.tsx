// 版权所有：波哥
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, SlidersHorizontal, Focus, Minimize, Leaf, RotateCcw } from 'lucide-react';
import { advanceFlow, fonts, getFlowWindow, readableInk, type Book, type Settings } from './model';

export type ReadingPosition = Pick<Book, 'line' | 'offset' | 'completed'>;

type Props = {
  book: Book; settings: Settings; onBack: () => void; onSettings: () => void;
  onProgress: (position: ReadingPosition) => void; blocked: boolean;
};

export default function Reader({ book, settings, onBack, onSettings, onProgress, blocked }: Props) {
  const [playing, setPlaying] = useState(false);
  const [focused, setFocused] = useState(false);
  const band = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const position = useRef(book.offset ?? 0);
  const dimensions = useRef({ width: 0, textWidth: 0, lineWidths: [] as number[] });
  const [windowCharacters, setWindowCharacters] = useState(2048);
  const flowLines = useMemo(() => getFlowWindow(book.lines, book.line, windowCharacters), [book.lines, book.line, windowCharacters]);
  const latest = useRef({ book, onProgress, playing });
  latest.current = { book, onProgress, playing };

  const measure = useCallback(() => {
    if (!band.current || !text.current) return;
    const width = band.current.clientWidth;
    const lineWidths = Array.from(text.current.children, child => child.getBoundingClientRect().width);
    dimensions.current = { width, textWidth: lineWidths[0] ?? 0, lineWidths };
    setWindowCharacters(Math.max(2048, Math.ceil(width * 2)));
  }, []);

  const paint = useCallback(() => {
    if (text.current) text.current.style.transform = `translate3d(${dimensions.current.width - (dimensions.current.width + dimensions.current.textWidth) * position.current}px, 0, 0)`;
  }, []);

  const flush = useCallback(() => {
    const { book: current, onProgress: update } = latest.current;
    update({ line: current.line, offset: position.current, completed: current.completed });
  }, []);

  useLayoutEffect(() => {
    measure();
    const { width, textWidth } = dimensions.current;
    const previewX = Math.max(28, (width - textWidth) / 2);
    position.current = book.offset ?? (width - Math.min(width * 0.1, previewX)) / Math.max(1, width + textWidth);
    paint();
  }, [book.id, book.line, book.completed, measure, paint]);

  useLayoutEffect(() => {
    const resize = () => { measure(); paint(); };
    const observer = new ResizeObserver(resize);
    if (band.current) observer.observe(band.current);
    if (text.current) observer.observe(text.current);
    resize();
    return () => observer.disconnect();
  }, [flowLines, settings.font, settings.fontSize, measure, paint]);

  useEffect(() => {
    if (!playing || blocked) return;
    let frame = 0;
    let last = 0;
    let lastSave = 0;
    const tick = (now: number) => {
      if (last) position.current += settings.speed * Math.min((now - last) / 1000, 0.1) / Math.max(1, dimensions.current.width + dimensions.current.textWidth);
      last = now;
      if (position.current >= 1) {
        const { book: current, onProgress: update } = latest.current;
        const { width, textWidth, lineWidths } = dimensions.current;
        const next = advanceFlow(width - (width + textWidth) * position.current, lineWidths);
        if (current.line + next.passed >= current.lines.length) {
          flushSync(() => {
            setPlaying(false);
            update({ line: current.lines.length - 1, offset: null, completed: true });
          });
          return;
        }
        position.current = (width - next.x) / Math.max(1, width + (lineWidths[next.passed] ?? 0));
        flushSync(() => update({ line: current.line + next.passed, offset: position.current, completed: false }));
        lastSave = now;
      }
      paint();
      if (now - lastSave > 1500) { flush(); lastSave = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, blocked, book.id, settings.speed, paint, flush]);

  useEffect(() => {
    if (blocked) { setPlaying(false); flush(); }
  }, [blocked, flush]);

  useEffect(() => {
    const hide = () => { if (document.hidden) { setPlaying(false); flush(); } };
    const save = () => flush();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', save);
    const nativeListener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', ({ isActive }) => { if (!isActive) { setPlaying(false); flush(); } }).catch(() => null)
      : null;
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', save);
      void nativeListener?.then(listener => listener?.remove());
    };
  }, [flush]);

  const toggle = useCallback(() => {
    if (latest.current.book.completed) {
      latest.current.onProgress({ line: 0, offset: null, completed: false });
      setPlaying(true);
    } else {
      flush();
      setPlaying(value => !value);
    }
  }, [flush]);

  const step = useCallback((direction: number) => {
    const current = latest.current.book;
    const next = Math.max(0, Math.min(current.lines.length - 1, current.line + direction));
    if (next === current.line) return;
    setPlaying(false);
    latest.current.onProgress({ line: next, offset: null, completed: false });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (blocked || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.code === 'Space') { event.preventDefault(); toggle(); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      if (event.key === 'Escape') setFocused(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [blocked, toggle, step]);

  const ink = readableInk(settings.pageColor);
  return <div className={`reader ${focused ? 'is-focused' : ''}`} style={{ background: settings.pageColor, color: ink, '--reader-ink': ink, '--reader-button-text': settings.pageColor } as CSSProperties}>
    <header className="reader-header">
      <button className="reader-back" aria-label="返回书架" onClick={() => { setPlaying(false); flush(); onBack(); }}><ArrowLeft size={19} /><span>返回书架</span></button>
      <div className="reader-book-name"><span>正在阅读</span><strong>{book.title}</strong></div>
      <div className="reader-tools"><button className="icon-button focus-toggle" aria-label={focused ? '退出专注模式' : '进入专注模式'} onClick={() => setFocused(value => !value)}>{focused ? <Minimize size={20} /> : <Focus size={20} />}</button>
        <button className="icon-button" aria-label="阅读设置" onClick={() => { setPlaying(false); flush(); onSettings(); }}><SlidersHorizontal size={20} /></button></div>
    </header>
    <div className="reader-prelude" aria-hidden="true"><Leaf size={23} strokeWidth={1.2} /><span>心无旁骛，只读这一行</span></div>
    <main className="reading-center">
      <div className="reading-band" ref={band} data-testid="reading-band" style={{ background: settings.lineColor, color: settings.textColor, fontSize: settings.fontSize, fontFamily: fonts[settings.font] }}>
        <span className="flowing-text" ref={text} data-testid="flowing-text">{flowLines.map((line, index) => <span key={book.line + index} data-flow-line={book.line + index} style={{ display: 'inline-block' }}>{line}</span>)}</span>
      </div>
      <div className="reading-under">
        <div className="line-counter" aria-live="polite">{book.completed ? '已读完 · 愿这一刻的宁静，陪你走远一点' : `第 ${book.line + 1} 行 / 共 ${book.lines.length} 行`}</div>
        <div className="reader-controls">
          <button className="step-button" disabled={book.line === 0} aria-label="后退1行" onClick={() => step(-1)}><SkipBack size={21} /><span>后退一行</span></button>
          <button className="play-button" aria-label={playing ? '停止' : book.completed ? '重新阅读' : '开始'} onClick={toggle}>{playing ? <Pause size={21} fill="currentColor" /> : book.completed ? <RotateCcw size={21} /> : <Play size={21} fill="currentColor" />}<span>{playing ? '停止' : book.completed ? '重新阅读' : '开始阅读'}</span></button>
          <button className="step-button" disabled={book.line === book.lines.length - 1} aria-label="前进1行" onClick={() => step(1)}><SkipForward size={21} /><span>前进一行</span></button>
        </div>
        <p className="reader-hint">{playing ? '文字在流动，你只需停留' : '不急，按自己的节奏来'}</p>
      </div>
    </main>
    <footer className="reader-footer"><span>禅阅 <i /> 一行之间，自有天地</span><span className="keyboard-tip">空格 开始 / 停止 <b>·</b> ← → 切换阅读行</span><span>{Math.round(book.completed ? 100 : book.line / book.lines.length * 100)}% 已读</span></footer>
    <div className="reader-progress"><i style={{ width: `${book.completed ? 100 : book.line / book.lines.length * 100}%` }} /></div>
  </div>;
}
