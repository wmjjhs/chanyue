// 版权所有：波哥
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { ambientAudio, ambientNames } from './ambient-audio';
import { trailOpacity } from './trail-fade';
import { BookOpen, X, RotateCcw, Check, Smartphone, ShieldCheck, MoveHorizontal, Download, HardDrive } from 'lucide-react';
import { defaultSettings, validateSettings, fonts, MAX_READING_SPEED, MAX_CURSOR_WORDS, MAX_CURSOR_THICKNESS, MAX_VISIBLE_LINES, MIN_FONT_SIZE, MIN_CURSOR_ROW, themes, type Book, type Settings } from './model';
import { Capacitor } from '@capacitor/core';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}>
    <img src="/icon.svg" alt="" width="42" height="42" />
    <div><strong>禅阅</strong>{!compact && <span>让阅读回归宁静</span>}</div>
  </div>;
}

export function Modal({ title, eyebrow, children, onClose, className = '' }: {
  title: string; eyebrow?: string; children: ReactNode; onClose: () => void; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    } }}>
    <div className="modal-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={id}>{title}</h2></div>
      <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button>
    </div>
    {children}
  </dialog>;
}

export function BookCover({ book, small = false }: { book: Book; small?: boolean }) {
  return <div className={`book-cover cover-${book.cover % 6} ${small ? 'small' : ''}`} aria-hidden="true">
    <div className="cover-rule" /><span className="cover-edition">CHAN YUE COLLECTION</span>
    <strong>{book.title}</strong><span className="cover-author">{book.sample ? '禅阅编辑部' : '我的私人藏书'}</span>
    <div className="cover-landscape"><i /><i /><i /></div>
    <span className="cover-seal">阅</span><span className="cover-bottom">一字一句 · 自有天地</span>
  </div>;
}

export function SettingsPanel({ settings, onChange, onClose }: {
  settings: Settings; onChange: (settings: Settings) => void; onClose: () => void;
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange(validateSettings({ ...settings, [key]: value }));
  const audioState = useSyncExternalStore(ambientAudio.subscribe, ambientAudio.getSnapshot);
  const audioMessages = { idle: '开始阅读后按偏好播放', loading: '正在准备本地环境音…', playing: '环境音播放中', paused: '环境音已暂停或静音', interrupted: '声音被系统中断，请重新点击开始阅读', error: '暂时无法播放声音，请重新点击开始阅读；不影响阅读' };
  const previewWords = settings.cursorMode === 'trail' ? 10 : Math.min(settings.cursorWords, 10);
  return <Modal title="找到你的阅读节奏" eyebrow="READING PREFERENCES / 阅读设置" onClose={onClose} className="settings-modal">
    <div className="settings-preview" style={{ background: settings.pageColor }}>
      <div className="multiline-preview" style={{ color: settings.textColor, background: settings.lineColor, fontFamily: fonts[settings.font], fontSize: Math.min(settings.fontSize, 26), lineHeight: 1.65 }}>
        <span className="preview-window" style={{ fontSize: `min(1em, calc((100vw - 140px) / ${1.12 * previewWords}))` }}>{Array.from('把目光留在此刻从容读').slice(0, previewWords).map((glyph, i) => <span key={i}>{glyph}</span>)}<i className="preview-underline" aria-hidden="true" style={{ height: settings.cursorThickness, right: settings.cursorMode === 'trail' ? '35%' : 0, background: settings.cursorTransparent ? 'transparent' : settings.cursorColor }} /></span>
        <span className={settings.layoutMode === 'semantic' ? 'preview-paragraph' : ''}>{settings.layoutMode === 'plain' ? '一字一句从容读下去' : '一字一句，从容读下去。'}</span>
      </div>
      <span style={{ color: settings.textColor }}>{settings.cursorMode === 'trail' ? '划线留痕 · 读到哪里画到哪里' : `指读 · ${settings.cursorWords} 字`} · {settings.cursorThickness} px{settings.cursorMode === 'pointer' && settings.cursorWords > previewWords && ' · 预览仅示意10字'}</span>
    </div>
    <section className="settings-section"><h3>文字样式</h3>
      <fieldset className="font-options"><legend className="sr-only">字体类型</legend>
        {([['song', '宋体', '温润书卷'], ['sans', '黑体', '清晰简洁'], ['kai', '楷体', '笔墨之间']] as const).map(([key, name, description]) =>
          <button type="button" key={key} className={settings.font === key ? 'selected' : ''} aria-pressed={settings.font === key} onClick={() => set('font', key)}>
            <strong style={{ fontFamily: fonts[key] }}>{name}</strong><small>{description}</small>
          </button>)}
      </fieldset>
      <label className="range-label" htmlFor="font-size">字体大小 <output>{settings.fontSize} <small>px</small></output></label>
      <input id="font-size" type="range" min={MIN_FONT_SIZE} max="64" value={settings.fontSize} onChange={e => set('fontSize', Number(e.target.value))} />
      <div className="range-ends"><span>小</span><span>大</span></div>
      <p className="field-note">使用设备自带字体；未安装时自动使用同类字体。</p>
    </section>
    <section className="settings-section"><h3>阅读配色</h3>
      <div className="theme-options">{themes.map(theme => <button key={theme.name} aria-label={theme.name} aria-pressed={settings.pageColor === theme.pageColor && settings.lineColor === theme.lineColor && settings.textColor === theme.textColor}
        onClick={() => onChange({ ...settings, ...theme })}>
        <span style={{ background: theme.pageColor, color: theme.textColor }}><span style={{ background: theme.lineColor }}>文</span>{settings.pageColor === theme.pageColor && <Check size={12} />}</span>{theme.name}
      </button>)}</div>
      <div className="color-options">{([['textColor', '文字颜色'], ['lineColor', '文字背景'], ['pageColor', '页面背景']] as const).map(([key, label]) =>
        <label key={key}><span>{label}</span><div><input type="color" aria-label={label} value={settings[key]} onChange={e => set(key, e.target.value)} /><code>{settings[key].toUpperCase()}</code></div></label>)}
      </div>
    </section>
    <section className="settings-section"><h3>排版方式</h3><div className="layout-options">
      <button aria-label="语义段落" aria-pressed={settings.layoutMode === 'semantic'} onClick={() => set('layoutMode', 'semantic')}>语义段落<small>保留段落、缩进与单词间隔</small></button>
      <button aria-label="紧凑排列" aria-pressed={settings.layoutMode === 'compact'} onClick={() => set('layoutMode', 'compact')}>紧凑排列<small>保留标点，忽略段落空白</small></button>
      <button aria-label="无标点密排" aria-pressed={settings.layoutMode === 'plain'} onClick={() => set('layoutMode', 'plain')}>无标点密排<small>去标点、去空白，连续排满</small></button>
    </div><label className="range-label" htmlFor="max-lines">最多显示行数 <output>{settings.maxLines} <small>行</small></output></label>
      <input id="max-lines" type="range" min="2" max={MAX_VISIBLE_LINES} value={settings.maxLines} onChange={e => set('maxLines', Number(e.target.value))} />
      <p className="field-note">最多30行，空间不足时自动减少，不会为凑行数把字号缩到12px以下。行距随可用高度均匀分配，阅读区延伸至按钮上方。每页按实际显示行数计算；字号、排版或方向改变时保留阅读位置。</p>
    </section>
    <section className="settings-section"><h3>下划线与节奏</h3>
      <label className="range-label" htmlFor="cursor-row">下划线停留行 <output>第 {settings.cursorRow} <small>行</small></output></label>
      <input id="cursor-row" type="range" min={MIN_CURSOR_ROW} max={MAX_VISIBLE_LINES} step="1" value={settings.cursorRow} onChange={e => set('cursorRow', Number(e.target.value))} />
      <p className="field-note">从上往下数，可选第2–30行。每行从所选位置开始，随正文在附近平滑上移；保留上一行空间，避免文字被顶部裁切。屏幕显示不足时临时使用最后可见行，恢复空间后自动回到所选行。指读与留痕均生效。</p>
      <div className="layout-options cursor-mode-options" role="group" aria-label="下划线模式">
        <button aria-label="指读" aria-pressed={settings.cursorMode === 'pointer'} onClick={() => set('cursorMode', 'pointer')}>指读<small>像笔尖指着读，经过不留痕</small></button>
        <button aria-label="划线留痕" aria-pressed={settings.cursorMode === 'trail'} onClick={() => set('cursorMode', 'trail')}>划线留痕<small>读到哪里画到哪里，保留已读线条</small></button>
      </div>
      <p className="field-note">换行直接从下一行字下开始，不飞行。留痕按当前阅读进度恢复，后退、跳页或重读时随进度重建，不作为永久批注。</p>
      <label className="cursor-setting">下划线颜色<input type="color" aria-label="下划线颜色" disabled={settings.cursorTransparent} value={settings.cursorColor} onChange={e => set('cursorColor', e.target.value)} /></label>
      <label className="transparent-setting"><input id="cursor-transparent" type="checkbox" checked={settings.cursorTransparent} onChange={e => set('cursorTransparent', e.target.checked)} />透明（隐藏下划线）</label>
      <label className="range-label" htmlFor="cursor-thickness">下划线粗细 <output>{settings.cursorThickness} <small>px</small></output></label>
      <input id="cursor-thickness" type="range" min="1" max={MAX_CURSOR_THICKNESS} step="1" value={settings.cursorThickness} onChange={e => set('cursorThickness', Number(e.target.value))} />
      <p className="field-note">像笔尖一样在文字下方移动，不覆盖文字，不改变文字大小和颜色。</p>
      <label className="range-label" htmlFor="cursor-words">指读覆盖字数 <output>{settings.cursorWords} <small>字</small></output></label>
      <input id="cursor-words" type="range" min="1" max={MAX_CURSOR_WORDS} step="1" disabled={settings.cursorMode === 'trail'} value={settings.cursorWords} onChange={e => set('cursorWords', Number(e.target.value))} />
      <p className="field-note">指读可选1–50字，只计算文字，短行不足时覆盖全行。留痕模式从行首逐渐画到行末，不限制已画线条长度；切回指读后恢复原窗口字数。</p>
      <label className="range-label" htmlFor="reading-speed">阅读速度 <output>{settings.speed} <small>字 / 分钟</small></output></label>
      <input id="reading-speed" type="range" min="30" max={MAX_READING_SPEED} step="10" value={settings.speed} onChange={e => set('speed', Number(e.target.value))} />
      <div className="range-ends"><span>30 · 慢读</span><span>{MAX_READING_SPEED} · 快读</span></div>
      <p className="field-note">总时长只按文字数计算，标点与空白不计时；经过标点不额外停顿。指读、划线与正文上移使用同一时钟，换行直接切到下一行，不另加时间。建议先用 120–300 字/分钟；不适时请暂停。</p>
    </section>
    <section className="settings-section">
      <h3>留痕层次</h3>
      <label className="transparent-setting"><input id="trail-fade" type="checkbox" checked={settings.trailFade} disabled={settings.cursorMode !== 'trail'} onChange={e => set('trailFade', e.target.checked)} />留痕渐淡</label>
      <p className="field-note">仅作用于划线留痕。当前线清晰，前文逐渐变淡；透明开关优先隐藏全部线条。</p>
      <div className="trail-fade-preview" aria-label="留痕层次预览" style={{ background: settings.lineColor, color: settings.textColor }}>
        {[settings.trailFadeLines + 1, Math.ceil(settings.trailFadeLines / 2) + 1, 1, 0].map((age, index) => <div key={index}><span>{index === 3 ? '当前行' : index === 2 ? '刚读完' : index === 0 ? '更早前文' : '较近前文'}</span><i data-age={age} style={{ height: settings.cursorThickness, background: settings.cursorColor, opacity: trailOpacity(settings, age) }} /></div>)}
      </div>
      <fieldset className="fade-controls" disabled={!settings.trailFade || settings.cursorMode !== 'trail'}>
        <legend className="sr-only">留痕渐淡参数</legend>
        {([['trailCurrent', '当前线不透明度', 100], ['trailRecent', '刚读完线不透明度', settings.trailCurrent], ['trailMinimum', '最淡不透明度', settings.trailRecent]] as const).map(([key, label, max]) => <div key={key}>
          <label className="range-label" htmlFor={key}>{label}<output>{settings[key]}%</output></label>
          <input id={key} type="range" min="0" max={max} step="1" value={settings[key]} onChange={e => set(key, Number(e.target.value))} />
        </div>)}
        <label className="range-label" htmlFor="trail-fade-lines">渐淡跨度<output>{settings.trailFadeLines} <small>行</small></output></label>
        <input id="trail-fade-lines" type="range" min="1" max="30" step="1" value={settings.trailFadeLines} onChange={e => set('trailFadeLines', Number(e.target.value))} />
        <label className="range-label" htmlFor="trail-fade-duration">过渡时长<output>{settings.trailFadeDuration.toFixed(1)} <small>秒</small></output></label>
        <input id="trail-fade-duration" type="range" min="0" max="1" step="0.1" value={settings.trailFadeDuration} onChange={e => set('trailFadeDuration', Number(e.target.value))} />
      </fieldset>
      <p className="field-note">从刚读完的上一行起，向前经过设定行数达到最淡。越早的线不会更深；最淡设0%可隐藏远处线条。过渡跟随阅读时间，暂停时不再变化；不改变阅读速度。</p>
      <button className="text-button" onClick={() => onChange({ ...settings, trailFade: true, trailCurrent: 100, trailRecent: 65, trailMinimum: 25, trailFadeLines: 5, trailFadeDuration: 0.4 })}>恢复留痕默认</button>
    </section>
    <section className="settings-section">
      <h3>阅读环境音</h3>
      <label className="transparent-setting"><input id="ambient-enabled" type="checkbox" checked={settings.ambientEnabled} onChange={e => set('ambientEnabled', e.target.checked)} />开启自然环境音</label>
      <div className="layout-options" role="group" aria-label="环境音类型">
        {(['rain', 'wind', 'stream'] as const).map(sound => <button key={sound} aria-label={ambientNames[sound]} aria-pressed={settings.ambientSound === sound} onClick={() => set('ambientSound', sound)}>{ambientNames[sound]}<small>{sound === 'rain' ? '均匀雨幕，无雷声' : sound === 'wind' ? '轻柔风声，无风啸' : '缓缓流水，无人声'}</small></button>)}
      </div>
      <label className="range-label" htmlFor="ambient-volume">环境音量<output>{settings.ambientVolume}%</output></label>
      <input id="ambient-volume" type="range" min="0" max="100" step="1" value={settings.ambientVolume} onChange={e => set('ambientVolume', Number(e.target.value))} />
      <label className="transparent-setting"><input id="ambient-continue" type="checkbox" checked={settings.ambientContinuePaused} onChange={e => set('ambientContinuePaused', e.target.checked)} />阅读暂停时继续播放</label>
      <p className="ambient-status field-note" role="status" data-audio-state={audioState}>{settings.ambientEnabled ? audioMessages[audioState] : '环境音已关闭'}</p>
      <p className="field-note">原创合成的自然风格循环音，随应用离线提供，非实地录音。开始阅读后才播放，设置与翻页暂停也遵循上方选项；返回书架、锁屏或进入后台停止。启停柔和过渡，不随字速变化。请配合手机系统音量低音量使用；百分比不代表安全响度。</p>
    </section>
    <footer className="modal-footer"><button className="text-button" onClick={() => onChange({ ...defaultSettings })}><RotateCcw size={15} />恢复默认</button><button className="primary-button" onClick={onClose}>完成设置 <Check size={16} /></button></footer>
  </Modal>;
}

export function Guide({ onClose }: { onClose: () => void }) {
  const native = Capacitor.isNativePlatform();
  return <Modal title="一行之间，自在阅读" eyebrow="A LITTLE GUIDE / 使用指南" onClose={onClose} className="guide-modal">
    <p className="modal-description">不必追赶文字，让文字慢慢来到你面前。</p>
    <div className="guide-item"><BookOpen /><div><h3>把喜欢的书带进来</h3><p>支持 TXT（UTF-8、GB18030、带 BOM 的 UTF-16）、Word（.docx）和文字型 PDF。每本不超过 20 MB / 200 万字，PDF 不超过 2000 页。旧版 .doc 请另存为 .docx；扫描 PDF 需先做 OCR。只提取正文，不保留图表和原排版。</p></div></div>
    <div className="guide-item"><MoveHorizontal /><div><h3>多行阅读，跟随滑动窗口</h3><p>语义模式保留段落、缩进和单词间隔；紧凑模式保留标点、去掉段落空白；无标点密排再去掉标点，连续排满，原文不变。排版不使用联网 AI；PDF 依提取换行，旧版书籍段落无法完整恢复，建议重新导入。指读模式像笔尖一样在文字下方持续前移，经过不留痕；划线留痕模式从行首逐渐画到已读位置，保留各行已画线条。两种模式都在换行时直接进入下一行文字下方，不飞行；正文持续上移，文字不放大、不变色。留痕按当前源阅读进度恢复，重排后重新定位，后退和重读时也随进度回退，不保存为永久批注。总时长只计算非标点文字（含数字、字母等），标点与空白不计时，换行不另加时间。设置可选12–64px字号、1–50字线条长度、最多2–30行、下划线停留行第2–30行（不足时临时适配）、自选线条颜色或透明、1–6px粗细及30–1600字/分钟；短行不足时覆盖全行。阅读顶部仅保留返回、书名和设置；底部居中放置播放与翻页按钮，页码跳转及进度同处一行。旧放大配置会忽略，书库和源阅读进度不变。前后按钮与左右键改为翻页，每页按当前实际显示行数计算，尾部不足一页仍计一页；支持输入页码跳转，翻页后暂停。字号、排版或方向改变会重新统计页数，保留源阅读位置。空格开始或暂停。旧版像素速度会重置为舒缓默认值，旧进度从阅读行起点恢复。</p></div></div>
    <div className="guide-item"><Smartphone /><div><h3>{native ? '独立 App，打开就能读' : '在 iPhone 上，像应用一样使用'}</h3><p>{native ? '禅阅已安装在手机中，不需要 Safari 或电脑运行。关闭手机的竖排方向锁定后，转动设备即可切换横竖屏。' : '在 Safari 中打开，点「分享 → 添加到主屏幕」。关闭手机的竖排方向锁定后，转动设备即可切换横竖屏。'}</p></div></div>
    <div className="guide-item"><Download /><div><h3>把宁静留在离线时刻</h3><p>{native ? '阅读引擎、PDF 字库和示例书都随 App 安装，首次启动也无需联网。导入时选择「文件 → 我的 iPhone」中的本地文件；尚未下载的 iCloud 文件需要先联网下载。' : '正式部署到 HTTPS 后，首次访问等待资源缓存完成，即可离线打开。开发预览不启用离线缓存。若系统清理了缓存，再次联网打开即可。'}</p></div></div>
    <div className="guide-item"><ShieldCheck /><div><h3>你的书，留在你的设备上</h3><p>{native ? '书籍解析全部在本地完成，不上传服务器。正文保存在 App 私有文件夹，设置和进度存入系统持久存储。App 不提供跨设备同步；是否进入系统备份由你的 iPhone 备份设置决定。' : '书籍解析全部在本地完成，不上传服务器。书架与阅读进度保存在当前浏览器，不跨设备同步。'}</p></div></div>
    <div className="notice"><HardDrive size={18} /><span>{native ? '删除 App 会移除本机书架。Safari 网页版的数据不会自动迁移，请重新导入并保留原始书籍文件。' : '清除网站数据、浏览器自动回收存储或使用无痕模式，可能丢失书架。请保留原始书籍文件。'}</span></div>
    <button className="primary-button full-width" onClick={onClose}>知道了，去读书</button>
  </Modal>;
}
