// 版权所有：波哥
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Search, Quote, Pencil, Trash2, ArrowUpLeft } from 'lucide-react';
import { Modal } from './components';
import { makeId, type Book } from './model';
import { loadNotes, mutateNotes } from './storage';
import { contextAt, excerptAt, excerptContextAt, currentContentsIndex, searchBook, safeBoundary, noteRevision, MAX_EXCERPT, MAX_NOTE_TEXT, MAX_NOTES, type ReadingNote, type NoteChange } from './reading-tools';

export type ReadingToolsView = { tab: 'contents' | 'search' | 'notes'; query: string; hit: number | null };
type Draft = { value: ReadingNote; context: ReturnType<typeof excerptContextAt>; editing: boolean; dirty: boolean; expected?: string };
export function ReadingTools({ book, source, view, onViewChange, onClose, onJump, canReturn, onReturn, onPractice, onMode, onFocus, onSpeechRate }: {
  book: Book; source: number; view: ReadingToolsView; onViewChange: (change: Partial<ReadingToolsView>) => void;
  onClose: () => void; onJump: (source: number) => void; canReturn: boolean; onReturn: () => void; onPractice: () => Promise<void>;
  onMode: (mode: 'reading' | 'reciting' | 'practice' | 'listening') => Promise<void>; onFocus: () => void; onSpeechRate: (rate: number) => Promise<void>;
}) {
  const text = useMemo(() => book.lines.join('\n'), [book.lines]);
  const { tab, query } = view;
  const setTab = (tab: ReadingToolsView['tab']) => { onViewChange({ tab }); setRemove(null); };
  const setQuery = (query: string) => onViewChange({ query, hit: null });
  const [settledQuery, setSettledQuery] = useState(query), [composing, setComposing] = useState(false);
  const composition = useRef(false);
  const searching = composing || query !== settledQuery;
  const [notes, setNotes] = useState<ReadingNote[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null), [discard, setDiscard] = useState<'close' | 'editor' | null>(null), [remove, setRemove] = useState<string | null>(null);
  const alive = useRef(true), inFlight = useRef(false), selection = useRef<HTMLTextAreaElement>(null);
  const currentEntry = useRef<HTMLButtonElement>(null), lastHit = useRef<HTMLButtonElement>(null);
  const activeContents = useMemo(() => currentContentsIndex(book.contents ?? [], source), [book.contents, source]);
  const results = useMemo(() => searchBook(text, settledQuery), [text, settledQuery]);
  useEffect(() => {
    if (draft || discard) return;
    const target = tab === 'contents' ? currentEntry.current : tab === 'search' ? lastHit.current : null;
    target?.scrollIntoView({ block: 'nearest' });
  }, [tab, draft, discard]);
  useEffect(() => {
    if (composing) return;
    const timeout = setTimeout(() => { if (!composition.current) setSettledQuery(query); }, 180);
    return () => clearTimeout(timeout);
  }, [query, composing]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError(false);
    void loadNotes(book.id).then(value => { if (!cancelled) setNotes(value); }).catch(() => {
      if (!cancelled) { setLoadError(true); setError('书签与摘录暂时无法读取，原记录未修改。请关闭后重试。'); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [book.id]);
  const close = () => {
    if (inFlight.current) return;
    if (draft?.dirty) { setDiscard('close'); return; }
    onClose();
  };
  const persist = async (change: NoteChange) => {
    if (inFlight.current || loading || loadError) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const next = await mutateNotes(book.id, change);
      if (!alive.current) return;
      setNotes(next); setDraft(null); setRemove(null); setTab('notes');
      setNotice(change.type === 'remove' ? '已删除记录' : '已保存到本书，阅读进度未改变');
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error && /每本最多|相同书签|原记录未修改|不匹配/.test(reason.message) ? reason.message : '保存失败，请检查可用空间后重试。当前编辑内容仍保留。');
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const begin = (kind: ReadingNote['kind'], at = source, end?: number) => {
    const range = kind === 'excerpt' ? end === undefined ? excerptAt(text, at) : { start: at, end, quote: text.slice(at, end) } : { start: at, end: at, quote: '' };
    if (kind === 'excerpt' && !range.quote.trim()) { setError('当前位置没有可摘录的文字，请先定位到正文。'); return; }
    const existing = notes.find(note => note.kind === kind && note.start === range.start && note.end === range.end);
    setDraft({ value: existing ?? { id: makeId(), kind, ...range, note: '', createdAt: Date.now(), updatedAt: Date.now() }, context: excerptContextAt(text, range.start, range.end), editing: !!existing, dirty: !existing, expected: existing ? noteRevision(existing) : undefined });
    setError(''); setNotice(''); setRemove(null);
  };
  const edit = (value: ReadingNote) => { setDraft({ value: { ...value }, context: excerptContextAt(text, value.start, value.end), editing: true, dirty: false, expected: noteRevision(value) }); setError(''); setNotice(''); };
  const selectExcerpt = () => {
    const area = selection.current;
    if (!area || !draft || inFlight.current) return;
    const start = draft.value.start - draft.context.start;
    area.focus({ preventScroll: true });
    area.setSelectionRange(start, draft.value.end - draft.context.start);
    const style = getComputedStyle(area), ruler = document.createElement('div'), marker = document.createElement('span');
    ruler.setAttribute('aria-hidden', 'true');
    Object.assign(ruler.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', width: `${area.clientWidth}px`, boxSizing: 'border-box', font: style.font, letterSpacing: style.letterSpacing, padding: style.padding, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: style.wordBreak, tabSize: style.tabSize });
    ruler.textContent = area.value.slice(0, start); marker.textContent = '\u200b';
    ruler.append(marker); document.body.append(ruler);
    try { area.scrollTop = Math.max(0, marker.offsetTop - area.clientHeight / 3); }
    finally { ruler.remove(); }
  };
  const applySelection = () => {
    const area = selection.current;
    if (!area || !draft || inFlight.current) return;
    const start = safeBoundary(text, draft.context.start + area.selectionStart);
    const end = safeBoundary(text, draft.context.start + area.selectionEnd, true);
    if (end <= start || !text.slice(start, end).trim()) { setError('请先在原文框中选中要摘录的文字。'); return; }
    if (end - start > MAX_EXCERPT) { setError(`单条摘录最多${MAX_EXCERPT}个字符，请缩小选区。`); return; }
    if (start !== draft.value.start || end !== draft.value.end) setDraft({ ...draft, value: { ...draft.value, start, end, quote: text.slice(start, end) }, dirty: true });
    setError('');
  };
  const useMode = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await action(); }
    catch { if (alive.current) setError('本书使用方式未保存，请检查空间后重试。'); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  const percentage = (at: number) => `${Math.min(100, Math.floor(at / Math.max(1, text.length) * 100))}%`;
  const disabled = loading || loadError || busy;
  const jump = (target: number) => {
    if (inFlight.current) return;
    if (tab === 'search') onViewChange({ hit: target });
    onJump(target);
  };
  return <Modal title={draft ? draft.value.kind === 'bookmark' ? '保存书签' : '保存摘录' : '阅读工具'} eyebrow={book.title} className="reading-tools-modal" onClose={close}>
    <div className="tools-summary"><span>定位后保持暂停，随时回到原处</span>{canReturn && !draft && <button className="text-button" disabled={busy} onClick={() => { if (!inFlight.current) onReturn(); }}><ArrowUpLeft size={14} />返回刚才</button>}</div>
    {error && <p className="error-note" role="alert">{error}</p>}
    {notice && <p className="tools-notice" role="status">{notice}</p>}
    {discard ? <div className="tools-discard"><p>有尚未保存的编辑，要放弃吗？</p><div className="tools-actions"><button className="secondary-button" onClick={() => setDiscard(null)}>继续编辑</button><button className="danger-button" onClick={() => { if (discard === 'close') onClose(); else { setDraft(null); setDiscard(null); } }}>{discard === 'close' ? '放弃并关闭' : '放弃编辑'}</button></div></div> : draft ? <div className="tools-editor">
      <p className="field-note">原文位置 {percentage(draft.value.start)} · {draft.editing ? '修改已有记录' : '新增记录'}</p>
      {draft.value.kind === 'excerpt' ? <>
        <blockquote className="tools-quote">{draft.value.quote}</blockquote><p className="field-note">{draft.value.quote.length} / {MAX_EXCERPT} 字符</p>
        <details className="tools-selection" key={draft.value.id}>
          <summary onClick={event => {
            const details = event.currentTarget.parentElement;
            if (details instanceof HTMLDetailsElement && !details.open) {
              event.preventDefault(); details.open = true; selectExcerpt();
            }
          }}>调整摘录范围</summary>
          <label htmlFor="excerpt-context">原文选区 <span className="field-note">已预选当前摘录，可重新选择</span></label>
          <textarea ref={selection} id="excerpt-context" readOnly rows={5} value={draft.context.text} aria-describedby="excerpt-help" />
          <button className="secondary-button" disabled={busy} onClick={applySelection}>使用选中文字</button>
          <p id="excerpt-help" className="field-note">只摘录原文，不修改正文；单条最多{MAX_EXCERPT}个字符。</p>
        </details>
      </> : <blockquote className="tools-quote">{contextAt(text, draft.value.start).text}</blockquote>}
      <label htmlFor="reading-note">简短备注 <span className="field-note">选填，最多{MAX_NOTE_TEXT}字</span></label>
      <textarea id="reading-note" rows={3} maxLength={MAX_NOTE_TEXT} disabled={busy} value={draft.value.note} onChange={event => setDraft({ ...draft, value: { ...draft.value, note: event.target.value }, dirty: true })} placeholder="记下为什么值得再读…" />
      <div className="tools-actions"><button className="secondary-button" disabled={busy} onClick={() => { if (draft.dirty) setDiscard('editor'); else setDraft(null); }}>取消</button><button className="primary-button" disabled={disabled} onClick={() => void persist({ type: 'put', expected: draft.expected, value: { ...draft.value, updatedAt: Date.now() } })}>{busy ? '正在保存…' : '保存到本书'}</button></div>
    </div> : <>
      <div className="tools-tabs" role="tablist" aria-label="阅读工具分类">{([['contents', '目录'], ['search', '搜索'], ['notes', '书签·摘录']] as const).map(([id, label], index, all) => <button key={id} id={`tools-tab-${id}`} disabled={busy} role="tab" aria-selected={tab === id} aria-controls={`tools-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => { setTab(id); setRemove(null); }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; setTab(all[next][0]); document.getElementById(`tools-tab-${all[next][0]}`)?.focus(); } }}>{label}</button>)}</div>
      <section className="tools-panel" id={`tools-panel-${tab}`} role="tabpanel" aria-labelledby={`tools-tab-${tab}`}>
        {tab === 'contents' && <>{book.contents?.length ? <><p className="field-note">{book.contents.length} 项{book.contents.length >= 1000 ? '（最多显示1000项）' : ''} · {book.format === 'PDF' ? '文件内置书签，定位至对应页正文开头' : '按原文标题层级定位'}</p><ol className="tools-list">{book.contents.map((entry, i) => <li key={`${entry.source}-${i}`}><button ref={i === activeContents ? currentEntry : undefined} className="tools-result" aria-current={i === activeContents ? 'location' : undefined} style={{ paddingLeft: `${12 + Math.min(4, entry.level - 1) * 14}px` }} onClick={() => jump(entry.source)}><span>{entry.title}</span><small>{i === activeContents ? '当前章节' : percentage(entry.source)}</small></button></li>)}</ol></> : <div className="tools-empty">这本书没有可识别目录。<p>Word使用标题或大纲级别，PDF使用文件内置书签；不按字号猜章节。旧书可重新导入原文件补充目录，也可以使用正文搜索。</p><button className="secondary-button" onClick={() => setTab('search')}>搜索正文</button></div>}</>}
        {tab === 'search' && <>
          <label className="tools-search" htmlFor="book-search"><Search size={18} /><input id="book-search" type="search" enterKeyHint="search" maxLength={100} value={query}
            onChange={event => setQuery(event.target.value)}
            onCompositionStart={() => { composition.current = true; setComposing(true); }}
            onCompositionEnd={event => { composition.current = false; setComposing(false); setQuery(event.currentTarget.value); }}
            onBlur={() => { composition.current = false; setComposing(false); }}
            onKeyDown={event => {
              if (event.key !== 'Enter' || composition.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault(); setSettledQuery(event.currentTarget.value);
            }} placeholder="在本书中查找文字" autoComplete="off" /></label>
          <p role="status" className="field-note">{composing ? '正在输入，选字后查找…' : searching ? '正在查找…' : !settledQuery.trim() ? '输入关键词或短句，忽略英文大小写；不支持正则表达式。' : results.more ? '匹配较多，展示前200条，请增加关键词。' : `${results.hits.length} 条匹配`}</p>
          <ol className="tools-list">{!searching && results.hits.map(hit => <li key={hit.start}><button ref={view.hit === hit.start ? lastHit : undefined} className="tools-result search-result" aria-current={view.hit === hit.start ? 'true' : undefined} onClick={() => jump(hit.start)}><span>{hit.before}<mark>{hit.match}</mark>{hit.after}</span><small>{view.hit === hit.start ? '上次查看' : percentage(hit.start)}</small></button><button className="text-button tools-save-result" disabled={disabled} onClick={() => begin('excerpt', hit.start, hit.end)}><Quote size={14} />摘录匹配文字</button></li>)}</ol>
          {settledQuery.trim() && !results.hits.length && !searching && <p className="tools-empty">没有找到，试试更短的关键词。</p>}
        </>}
        {tab === 'notes' && <><div className="tools-actions"><button className="secondary-button" disabled={disabled || notes.length >= MAX_NOTES} onClick={() => begin('bookmark')}><Bookmark size={16} />记住当前位置</button><button className="secondary-button" disabled={disabled || notes.length >= MAX_NOTES} onClick={() => begin('excerpt')}><Quote size={16} />摘录当前句</button></div><p className="field-note">{loading ? '正在读取本书记录…' : `${notes.length} / ${MAX_NOTES} 条 · 仅保存于当前设备，删除书籍也会删除这些记录`}</p>{!loading && !notes.length && !loadError && <p className="tools-empty">把值得再读的位置留下来。<br />不打卡，不催促，只为下次找得到。</p>}<ol className="tools-list">{notes.map(note => <li key={note.id} className="tools-note"><button className="tools-result" onClick={() => jump(note.start)} disabled={busy}><span><small>{note.kind === 'bookmark' ? '书签' : '摘录'} · {percentage(note.start)}</small><span className="tools-note-preview">{note.kind === 'excerpt' ? note.quote : contextAt(text, note.start).text}</span>{note.note && <em className="tools-note-preview">{note.note}</em>}</span></button>{remove === note.id ? <div className="tools-actions"><span>删除这条记录？</span><button className="text-button" disabled={busy} onClick={() => setRemove(null)}>取消</button><button className="text-button danger" disabled={busy} onClick={() => void persist({ type: 'remove', id: note.id, expected: noteRevision(note) })}>确认删除</button></div> : <div className="tools-note-actions"><button className="text-button" disabled={disabled} onClick={() => edit(note)}><Pencil size={14} />编辑</button><button className="text-button" disabled={disabled} onClick={() => { setRemove(note.id); setNotice(''); }}><Trash2 size={14} />删除</button></div>}</li>)}</ol></>}
      </section>
      <div className="book-mode"><label>本书方式 <select aria-label="本书使用方式" disabled={busy} value={book.readingPreference?.mode ?? 'reading'} onChange={event => void useMode(() => onMode(event.target.value as 'reading' | 'reciting' | 'practice' | 'listening'))}><option value="reading">阅读</option><option value="reciting">连续念诵</option><option value="practice">背诵</option><option value="listening">听书</option></select></label><button className="text-button" disabled={busy} onClick={() => { if (!inFlight.current) onFocus(); }}>收起操作区</button></div>
      {book.readingPreference?.mode === 'listening' && <div className="listening-options"><label>听书语速 <select aria-label="听书语速" disabled={busy} value={book.listening?.rate ?? 1} onChange={event => void useMode(() => onSpeechRate(Number(event.target.value)))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate} 倍</option>)}</select></label><p className="field-note">可在右上角「阅读设置 → 听书朗读」切换系统语音或本地神经语音、挑选音色并补充多音字读音。两种引擎都在手机本地合成，不上传正文、不使用云端语音。按句同步，暂停后重读当前句；进入后台或锁屏暂停。听书期间不播放环境音，阅读设置中的字/分钟不影响听书。</p></div>}
      <button className="text-button practice-entry" disabled={busy} onClick={() => void useMode(onPractice)}>{book.practice ? '继续上次背诵' : '从当前位置练习小段背诵'}</button>
    </>}
  </Modal>;
}
