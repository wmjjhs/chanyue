// 版权所有：波哥
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { BookOpen, X, RotateCcw, Check, Smartphone, ShieldCheck, MoveHorizontal, Download, HardDrive } from 'lucide-react';
import { defaultSettings, fonts, MAX_READING_SPEED, themes, type Book, type Settings } from './model';
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
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  return <Modal title="找到你的阅读节奏" eyebrow="READING PREFERENCES / 阅读设置" onClose={onClose} className="settings-modal">
    <div className="settings-preview" style={{ background: settings.pageColor }}>
      <div style={{ color: settings.textColor, background: settings.lineColor, fontFamily: fonts[settings.font], fontSize: Math.min(settings.fontSize, 36) }}>风过竹林，字如流水。</div>
      <span style={{ color: settings.textColor }}>阅读效果预览</span>
    </div>
    <section className="settings-section"><h3>文字样式</h3>
      <fieldset className="font-options"><legend className="sr-only">字体类型</legend>
        {([['song', '宋体', '温润书卷'], ['sans', '黑体', '清晰简洁'], ['kai', '楷体', '笔墨之间']] as const).map(([key, name, description]) =>
          <button type="button" key={key} className={settings.font === key ? 'selected' : ''} aria-pressed={settings.font === key} onClick={() => set('font', key)}>
            <strong style={{ fontFamily: fonts[key] }}>{name}</strong><small>{description}</small>
          </button>)}
      </fieldset>
      <label className="range-label" htmlFor="font-size">字体大小 <output>{settings.fontSize} <small>px</small></output></label>
      <input id="font-size" type="range" min="18" max="64" value={settings.fontSize} onChange={e => set('fontSize', Number(e.target.value))} />
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
    <section className="settings-section"><label className="range-label" htmlFor="reading-speed">流动速度 <output>{settings.speed} <small>px / 秒</small></output></label>
      <input id="reading-speed" type="range" min="15" max={MAX_READING_SPEED} value={settings.speed} onChange={e => set('speed', Number(e.target.value))} />
      <div className="range-ends"><span>慢下来</span><span>极速 · {MAX_READING_SPEED} px / 秒</span></div>
    </section>
    <footer className="modal-footer"><button className="text-button" onClick={() => onChange({ ...defaultSettings })}><RotateCcw size={15} />恢复默认</button><button className="primary-button" onClick={onClose}>完成设置 <Check size={16} /></button></footer>
  </Modal>;
}

export function Guide({ onClose }: { onClose: () => void }) {
  const native = Capacitor.isNativePlatform();
  return <Modal title="一行之间，自在阅读" eyebrow="A LITTLE GUIDE / 使用指南" onClose={onClose} className="guide-modal">
    <p className="modal-description">不必追赶文字，让文字慢慢来到你面前。</p>
    <div className="guide-item"><BookOpen /><div><h3>把喜欢的书带进来</h3><p>支持 TXT（UTF-8、GB18030、带 BOM 的 UTF-16）、Word（.docx）和文字型 PDF。每本不超过 20 MB / 200 万字，PDF 不超过 2000 页。旧版 .doc 请另存为 .docx；扫描 PDF 需先做 OCR。只提取正文，不保留图表和原排版。</p></div></div>
    <div className="guide-item"><MoveHorizontal /><div><h3>一行文字，缓缓流动</h3><p>按原文换行和句子分成阅读行，长段落会自动拆分。点击开始，文字从右向左连续流动，相邻阅读行直接衔接，不插入空格或等待空白；停止后保留位置。速度最高 1600 px/秒。前后按钮仍移动一行。电脑也可以使用空格和左右方向键。</p></div></div>
    <div className="guide-item"><Smartphone /><div><h3>{native ? '独立 App，打开就能读' : '在 iPhone 上，像应用一样使用'}</h3><p>{native ? '禅阅已安装在手机中，不需要 Safari 或电脑运行。关闭手机的竖排方向锁定后，转动设备即可切换横竖屏。' : '在 Safari 中打开，点「分享 → 添加到主屏幕」。关闭手机的竖排方向锁定后，转动设备即可切换横竖屏。'}</p></div></div>
    <div className="guide-item"><Download /><div><h3>把宁静留在离线时刻</h3><p>{native ? '阅读引擎、PDF 字库和示例书都随 App 安装，首次启动也无需联网。导入时选择「文件 → 我的 iPhone」中的本地文件；尚未下载的 iCloud 文件需要先联网下载。' : '正式部署到 HTTPS 后，首次访问等待资源缓存完成，即可离线打开。开发预览不启用离线缓存。若系统清理了缓存，再次联网打开即可。'}</p></div></div>
    <div className="guide-item"><ShieldCheck /><div><h3>你的书，留在你的设备上</h3><p>{native ? '书籍解析全部在本地完成，不上传服务器。正文保存在 App 私有文件夹，设置和进度存入系统持久存储。App 不提供跨设备同步；是否进入系统备份由你的 iPhone 备份设置决定。' : '书籍解析全部在本地完成，不上传服务器。书架与阅读进度保存在当前浏览器，不跨设备同步。'}</p></div></div>
    <div className="notice"><HardDrive size={18} /><span>{native ? '删除 App 会移除本机书架。Safari 网页版的数据不会自动迁移，请重新导入并保留原始书籍文件。' : '清除网站数据、浏览器自动回收存储或使用无痕模式，可能丢失书架。请保留原始书籍文件。'}</span></div>
    <button className="primary-button full-width" onClick={onClose}>知道了，去读书</button>
  </Modal>;
}
