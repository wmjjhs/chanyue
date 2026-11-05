// 版权所有：波哥
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { BookOpen, Library, SlidersHorizontal, CircleHelp, Plus, ArrowUpRight, ArrowRight, Search, ChevronDown, MoreHorizontal, Upload, FileText, X, ShieldCheck, Leaf, Check, LoaderCircle, Trash2, Pencil, CheckCircle2, Coffee, Smartphone } from 'lucide-react';
import { Brand, BookCover, Modal, SettingsPanel, Guide } from './components';
import Reader, { type ReadingPosition } from './Reader';
import { importBook } from './importer';
import { defaultSettings, progressOf, textLength, type Book, type Settings } from './model';
import { loadBooks, loadSettings, saveSettings, saveBook, savePosition, deleteBook } from './storage';

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const booksRef = useRef(books);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const [settings, setSettings] = useState<Settings>({ ...defaultSettings });
  const [readingId, setReadingId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'settings' | 'guide' | 'import' | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managing, setManaging] = useState(false);
  const [filter, setFilter] = useState('全部书籍');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [busy, setBusy] = useState(false);
  const importLock = useRef(false);
  const [importStatus, setImportStatus] = useState('');
  const [importResults, setImportResults] = useState<{ name: string; error?: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [retry, setRetry] = useState(0);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  }, []);

  const replaceBooks = useCallback((next: Book[]) => { booksRef.current = next; setBooks(next); }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadBooks(), loadSettings()]).then(([result, savedSettings]) => {
      if (active) { replaceBooks(result); setSettings(savedSettings); setStorageError(false); }
    })
      .catch(() => { if (active) setStorageError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [replaceBooks, retry]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const updateBook = useCallback((book: Book) => {
    replaceBooks(booksRef.current.map(value => value.id === book.id ? book : value));
    void savePosition(book).catch(() => notify('保存失败：浏览器存储空间可能不足，请保留原始书籍文件。'));
  }, [notify, replaceBooks]);

  const readBook = (book: Book) => {
    updateBook({ ...book, lastReadAt: Date.now() });
    setReadingId(book.id);
    window.scrollTo(0, 0);
  };

  const updateSettings = (next: Settings) => {
    setSettings(next);
    void saveSettings(next).catch(() => notify('本次设置已生效，但未能保存到本机，下次打开可能需要重新设置。'));
  };

  const importFiles = async (files: File[]) => {
    if (importLock.current || !files.length) return;
    importLock.current = true;
    setBusy(true);
    setImportResults([]);
    let succeeded = 0;
    try {
      if (files.length > 10) {
        setImportResults([{ name: '本次未导入', error: '一次最多导入 10 本书，请分批选择。' }]);
        return;
      }
      for (const file of files) {
        try {
          const book = await importBook(file, setImportStatus);
          const exists = booksRef.current.some(current => current.lines.length === book.lines.length && current.lines.every((line, i) => line === book.lines[i]));
          if (exists) throw new Error('相同内容的书籍已在书架中，无需重复导入。');
          await saveBook(book);
          replaceBooks([...booksRef.current, book]);
          succeeded++;
          setImportResults(previous => [...previous, { name: file.name }]);
        } catch (error) {
          const message = error instanceof Error ? error.message : '无法读取该文件，请重新导出后重试。';
          setImportResults(previous => [...previous, { name: file.name, error: /quota/i.test(message) ? '本机存储空间不足，请删除不需要的书籍后重试。' : message }]);
        }
      }
    } finally {
      importLock.current = false;
      setBusy(false);
      setImportStatus('');
      if (fileInput.current) fileInput.current.value = '';
      if (succeeded) notify(`已将 ${succeeded} 本书放入书架`);
    }
  };

  const openImport = () => { setImportResults([]); setPanel('import'); };
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => { void importFiles(Array.from(event.target.files ?? [])); };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault(); setDragging(false);
    void importFiles(Array.from(event.dataTransfer.files));
  };
  const current = books.find(book => book.id === readingId);
  const managed = books.find(book => book.id === manageId);
  const continuing = [...books].sort((a, b) => b.lastReadAt - a.lastReadAt || a.createdAt - b.createdAt)[0];
  const filtered = books.filter(book =>
    (filter === '全部书籍' || (filter === '正在读' && book.lastReadAt > 0 && !book.completed) || (filter === '已读完' && book.completed)) &&
    `${book.title} ${book.author}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'zh-CN') : sort === 'added' ? b.createdAt - a.createdAt : b.lastReadAt - a.lastReadAt || a.createdAt - b.createdAt);
  const progress = continuing ? progressOf(continuing) : 0;

  return <>
    {current ? <Reader key={current.id} book={current} settings={settings} onBack={() => setReadingId(null)} onSettings={() => setPanel('settings')} blocked={panel !== null}
      onProgress={(position: ReadingPosition) => {
        const stored = booksRef.current.find(book => book.id === current.id);
        if (stored) updateBook({ ...stored, ...position, lastReadAt: Date.now() });
      }} /> : <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <span className="nav-label">我的阅读空间</span>
        <nav aria-label="主导航">
          <button className="nav-item active" aria-current="page" onClick={() => { setFilter('全部书籍'); setSearch(''); }}><Library size={19} /><span>我的书架</span><span className="nav-count">{books.length}</span></button>
          <button className="nav-item" onClick={() => setPanel('settings')}><SlidersHorizontal size={19} /><span>阅读设置</span></button>
          <button className="nav-item" onClick={() => setPanel('guide')}><CircleHelp size={19} /><span>使用指南</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><span className="little-branch"><Leaf size={27} strokeWidth={1} /></span><p>读书不觉已春深，<br />一寸光阴一寸金。</p><span>让心慢下来，让文字流淌。</span></div>
          <div className="local-indicator"><span /><span>本地书库 · 安心私享</span><ShieldCheck size={15} /></div>
          <div className="sidebar-version">禅阅 CHAN YUE <span>v1.1</span></div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar"><div className="breadcrumb"><Library size={16} /><span>我的空间</span><span>/</span><strong>我的书架</strong></div><div className="mobile-brand"><Brand compact /></div>
          <div className="topbar-right"><span className="today"><span className="status-dot" />今日，也宜读书</span><button className="topbar-help icon-button" aria-label="使用指南" onClick={() => setPanel('guide')}><CircleHelp size={19} /></button><button className="avatar" aria-label="阅读设置" onClick={() => setPanel('settings')}>阅</button></div>
        </header>
        <main className="library-main">
          <section className="welcome"><div><span className="eyebrow">A QUIET MOMENT, A GOOD BOOK</span><h1>把时间，留给阅读<span>。</span></h1><p>屏息喧嚣，回到文字里。每一行，都是一处风景。</p></div><button className="primary-button import-top" onClick={openImport} disabled={storageError || loading}><Plus size={18} />导入书籍</button></section>
          {storageError ? <div className="storage-error"><ShieldCheck size={28} /><h2>暂时无法打开本地书库</h2><p>请检查本机存储空间；网页端还需允许网站存储并退出无痕模式。现有数据不会被主动删除。</p><button className="primary-button" onClick={() => setRetry(value => value + 1)}>重试</button></div> : loading ? <div className="loading-state"><LoaderCircle className="spinning" />正在整理你的书架…</div> : <>
            <section className="continue-card" aria-label="继续阅读">
              <div className="continue-content"><span className="continue-eyebrow"><span />{continuing?.lastReadAt ? '此刻，继续阅读' : '从这一行，开始静下来'}</span><h2>{continuing?.title ?? '下一本好书，等你翻开'}</h2><p>{continuing ? continuing.author : '导入喜欢的文字，拥有自己的宁静角落。'}</p>
                {continuing && <div className="continue-progress"><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><span>{progress > 0 ? `已读 ${progress}%` : '等待开启'}</span><span className="progress-detail">约 {textLength(continuing.lines)} 字</span></div>}
                <button className="primary-button continue-button" onClick={() => continuing ? readBook(continuing) : openImport()}><BookOpen size={17} />{continuing?.lastReadAt ? '继续阅读' : continuing ? '开启阅读' : '导入第一本书'}<ArrowRight size={17} /></button>
              </div>
              <div className="hero-art" aria-hidden="true"><div className="zen-ring ring-one" /><div className="zen-ring ring-two" /><div className="zen-ring ring-three" /><div className="hero-vertical">一行文字<br />一念清欢</div>{continuing && <div className="hero-book"><BookCover book={continuing} /></div>}<div className="hero-caption">慢一点，读深一点。</div><span className="art-leaf leaf-one" /><span className="art-leaf leaf-two" /></div>
            </section>
            <section className="bookshelf" aria-labelledby="shelf-title">
              <div className="shelf-heading"><div><h2 id="shelf-title">我的书架</h2><span>{books.length} 本藏书</span></div><div className="shelf-controls"><div className="search-box"><Search size={16} /><input aria-label="搜索书籍" placeholder="寻找一本书…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label="清除搜索" onClick={() => setSearch('')}><X size={14} /></button>}</div><label className="sort-select"><span className="sr-only">书架排序</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="name">书名排序</option></select><ChevronDown size={14} /></label></div></div>
              <div className="shelf-tabs" role="tablist" aria-label="阅读状态">{['全部书籍', '正在读', '已读完'].map(label => <button key={label} role="tab" aria-selected={filter === label} onClick={() => setFilter(label)}>{label}{label === '全部书籍' && <span>{books.length}</span>}</button>)}</div>
              <div className="book-grid" role="tabpanel" aria-label={filter}>
                {filtered.map(book => <article className="book-card" key={book.id}>
                  <button className={`book-cover-area tone-${book.cover % 6}`} onClick={() => readBook(book)} aria-label={`阅读《${book.title}》`}><BookCover book={book} /><span className="cover-open"><BookOpen size={16} />静心阅读<ArrowUpRight size={16} /></span><span className="format-badge">{book.format === 'WORD' ? 'DOCX' : book.format}</span></button>
                  <div className="book-info"><div className="book-title-row"><button className="book-title" onClick={() => readBook(book)} title={book.title}>{book.title}</button><button className="book-menu icon-button" aria-label={`管理《${book.title}》`} onClick={() => { setManageId(book.id); setNewTitle(book.title); setConfirmDelete(false); }}><MoreHorizontal size={18} /></button></div><p>{book.author}</p><div className="book-progress-row"><span className={book.completed ? 'finished' : book.lastReadAt ? 'in-progress' : ''}>{book.completed ? <><CheckCircle2 size={12} />已读完</> : book.lastReadAt ? `已读 ${progressOf(book)}%` : '未开始'}</span><span>约 {textLength(book.lines)} 字</span></div><div className="book-progress"><i style={{ width: `${progressOf(book)}%` }} /></div></div>
                </article>)}
                {!filtered.length && (search || filter !== '全部书籍') ? <div className="empty-state"><Search size={30} strokeWidth={1.2} /><h3>{search ? '还没有找到这本书' : filter === '正在读' ? '故事，等待你的开始' : '慢慢读，不必急着读完'}</h3><p>{search ? '换个关键词，或把它带进书架。' : '阅读状态会随你的进度自动更新。'}</p><button className="text-button" onClick={() => { setSearch(''); setFilter('全部书籍'); }}>查看全部书籍 <ArrowRight size={15} /></button></div> : <button className="add-book-card" onClick={openImport}><span className="add-circle"><Plus size={27} strokeWidth={1.2} /></span><strong>带一本书进来</strong><p>给心灵，添一处风景</p><span className="supported-formats">TXT <i /> WORD <i /> PDF</span><span className="add-book-bottom">点击导入本地文件 <ArrowUpRight size={13} /></span></button>}
              </div>
            </section>
            <div className="reading-note"><div className="note-icon"><Coffee size={23} strokeWidth={1.2} /></div><div><h3>不必读得很快，只需读得自在。</h3><p>多行文字，逐字光标。保留段落或紧凑排列，让每一字都跟得上。</p></div><button className="text-button" onClick={() => setPanel('settings')}>调整我的节奏 <ArrowRight size={16} /></button></div>
          </>}
          <footer className="library-footer"><span><ShieldCheck size={14} />书籍仅保存在本机，不上传云端</span><button onClick={() => setPanel('guide')}><Smartphone size={14} />在 iPhone 上使用 <ArrowUpRight size={12} /></button></footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="手机导航"><button className="active" onClick={() => { setFilter('全部书籍'); setSearch(''); }}><Library size={20} /><span>书架</span></button><button onClick={openImport} disabled={storageError || loading}><Plus size={21} /><span>导入</span></button><button onClick={() => setPanel('settings')}><SlidersHorizontal size={20} /><span>设置</span></button><button onClick={() => setPanel('guide')}><CircleHelp size={20} /><span>指南</span></button></nav>
    </div>}
    {panel === 'settings' && <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setPanel(null)} />}
    {panel === 'guide' && <Guide onClose={() => setPanel(null)} />}
    {panel === 'import' && <Modal title="把喜欢的书，带进来" eyebrow="YOUR PRIVATE LIBRARY / 导入书籍" onClose={() => { if (!busy) setPanel(null); }} className="import-modal">
      <p className="modal-description">一本好书，就是一段属于自己的时光。</p>
      <input ref={fileInput} className="sr-only" tabIndex={-1} type="file" multiple accept=".txt,.docx,.pdf,.doc,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword" onChange={handleFile} disabled={busy} aria-label="选择书籍文件" />
      <button className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => fileInput.current?.click()} disabled={busy}
        onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
        <span className="upload-icon">{busy ? <LoaderCircle className="spinning" size={29} /> : <Upload size={29} strokeWidth={1.4} />}</span>
        <strong>{busy ? importStatus : '点击选择，或将书籍拖到这里'}</strong><p>{busy ? '正在本地解析，请稍候…' : '支持一次导入多本书籍'}</p>
        <span className="file-formats"><span><FileText size={13} />TXT</span><span><FileText size={13} />Word .docx</span><span><FileText size={13} />PDF</span></span>
      </button>
      <div className="import-limits"><span>每本 ≤ 20 MB</span><span>每次最多 10 本</span><span>仅提取文字</span></div>
      <p className="field-note">Word 仅支持 .docx，旧版 .doc 请先转换。扫描版 PDF 请先使用 OCR 识别文字。</p>
      {importResults.length > 0 && <ul className="import-results" aria-live="polite">{importResults.map((result, index) => <li key={index} className={result.error ? 'error' : 'success'}>{result.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}<div><strong>{result.name}</strong><p>{result.error ?? '已加入书架，随时开始阅读'}</p></div></li>)}</ul>}
      <div className="notice"><ShieldCheck size={18} /><span>文件只在你的设备上处理，不会被上传。请保留原始文件作为备份。</span></div>
      <button className="primary-button full-width" disabled={busy} onClick={() => setPanel(null)}>{busy ? '正在导入…' : importResults.some(result => !result.error) ? '回书架，开始阅读' : '完成'}</button>
    </Modal>}
    {managed && <Modal title="管理这本书" eyebrow="BOOK DETAILS / 书籍管理" onClose={() => { if (!managing) setManageId(null); }} className="manage-modal">
      <div className="manage-summary"><BookCover book={managed} small /><div><h3>{managed.title}</h3><p>{managed.format} · 约 {textLength(managed.lines)} 字</p><span>{managed.sample ? '禅阅原创示例，可自由移除' : `导入于 ${new Date(managed.createdAt).toLocaleDateString('zh-CN')}`}</span><span>已读 {progressOf(managed)}%</span></div></div>
      <form onSubmit={async event => {
        event.preventDefault(); if (!newTitle.trim()) return; setManaging(true);
        const renamed = { ...managed, title: newTitle.trim() };
        try { await saveBook(renamed); replaceBooks(booksRef.current.map(book => book.id === renamed.id ? renamed : book)); setManageId(null); notify('书名已更新'); }
        catch { notify('保存失败，请检查浏览器存储空间。'); } finally { setManaging(false); }
      }}><label className="input-label" htmlFor="rename-book">书籍名称</label><input className="text-input" id="rename-book" value={newTitle} onChange={event => setNewTitle(event.target.value)} required maxLength={150} />
        <button className="primary-button full-width" type="submit" disabled={managing || !newTitle.trim()}><Pencil size={16} />保存书名</button>
      </form>
      <div className="delete-area">{confirmDelete ? <><p>确定移除《{managed.title}》？本地书籍与阅读进度将被删除，原始文件不受影响。</p><div><button className="text-button" disabled={managing} onClick={() => setConfirmDelete(false)}>再想想</button><button className="danger-button" disabled={managing} onClick={async () => {
        setManaging(true);
        try { await deleteBook(managed.id); replaceBooks(booksRef.current.filter(book => book.id !== managed.id)); setManageId(null); notify('已从书架移除'); }
        catch { notify('移除失败，请稍后重试。'); } finally { setManaging(false); }
      }}>确认移除</button></div></> : <button className="text-button danger-text" disabled={managing} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />从书架移除</button>}</div>
    </Modal>}
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={16} /></button></div>}
  </>;
}
