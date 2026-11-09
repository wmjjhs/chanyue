// 版权所有：波哥
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Modal } from './components';
import { exportBackup, restoreBackup, saveSettings } from './storage';
import { encodeBackup, parseBackup, MAX_BACKUP_BYTES, type Backup } from './backup';
import type { Settings } from './model';

export function BackupPanel({ onClose, onReload, onSettingsSaved, waitWrites }: {
  onClose: () => void; onReload: () => Promise<void>; onSettingsSaved: (settings: Settings) => void; waitWrites: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [backup, setBackup] = useState<Backup | null>(null), [applySettings, setApplySettings] = useState(false);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const lock = useRef(false), input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  const perform = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await waitWrites(); await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作未完成，请检查可用空间后重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const prepare = () => void perform(async () => {
    setDownload(null);
    const encoded = encodeBackup(await exportBackup()), name = `禅阅备份-${new Date().toISOString().slice(0, 10)}.json`;
    if (Capacitor.isNativePlatform()) {
      const path = 'chanyue-library-backup.json';
      const file = await Filesystem.writeFile({ directory: Directory.Cache, path, data: encoded, encoding: Encoding.UTF8 });
      if ((await Filesystem.readFile({ directory: Directory.Cache, path, encoding: Encoding.UTF8 })).data !== encoded) throw new Error('备份文件写入不完整，未打开分享。');
      await Share.share({ title: '保存禅阅备份', files: [file.uri], dialogTitle: '选择备份保存位置' });
      setNotice('已返回分享面板。请确认备份已保存到你选择的位置；取消分享不会生成外部备份。');
    } else {
      setDownload({ url: URL.createObjectURL(new Blob([encoded], { type: 'application/json' })), name });
      setNotice('备份已准备好，请点击下面的“保存备份文件”。');
    }
  });
  const restore = () => void perform(async () => {
    if (!backup) return;
    const result = await restoreBackup(backup);
    let message = `已新增 ${result.added} 本，跳过完全相同的 ${result.skipped} 本。现有书籍和笔记未覆盖。`;
    if (result.failed) message += `另有 ${result.failed} 本未完成，请保留备份，检查空间后重试；已成功恢复的无需重做。`;
    else if (applySettings) {
      try { await saveSettings(backup.settings); onSettingsSaved(backup.settings); message += ' 已应用备份设置。'; }
      catch { message += ' 书籍已恢复，但设置保存失败，当前设置保持不变。'; }
    }
    try { await onReload(); } catch { message += ' 书架刷新失败，请重新打开应用查看已恢复内容。'; }
    setNotice(message);
    if (!result.failed) setBackup(null);
  });
  return <Modal title="备份与恢复" eyebrow="只在本机处理" onClose={() => { if (!lock.current) onClose(); }} className="backup-modal">
    <p className="modal-description">保护正文、目录、格式、阅读进度、书签摘录和阅读设置。不包含原始 PDF / Word 文件。</p>
    <p className="field-note">备份是未加密的 JSON 文件，请保存在可信位置，不要随意分享。支持最多100 MB、500本、合计2000万字符。</p>
    <div className="tools-actions"><button className="primary-button" disabled={busy} onClick={prepare}>导出当前书库</button><button className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>选择备份文件</button></div>
    {download && <a className="secondary-button backup-download" href={download.url} download={download.name}>保存备份文件</a>}
    <input ref={input} className="sr-only" type="file" accept=".json,application/json" aria-label="选择禅阅备份" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setBackup(null); setApplySettings(false);
      void perform(async () => { if (file.size > MAX_BACKUP_BYTES) throw new Error('备份超过100 MB，本次未恢复。'); setBackup(parseBackup(await file.text())); });
    }} />
    {backup && <section className="backup-preview"><h3>确认恢复</h3><p>{backup.books.length} 本书 · {backup.books.reduce((sum, entry) => sum + entry.notes.length, 0)} 条书签与摘录</p><p className="field-note">不删除、不覆盖现有书籍。数据完全相同会跳过；同一本书的进度或笔记有差异时，作为独立副本恢复，书名保持不变。手机端逐本提交，失败会说明已完成数量。</p><label className="backup-settings"><input type="checkbox" checked={applySettings} disabled={busy} onChange={event => setApplySettings(event.target.checked)} />同时应用备份中的阅读设置</label><div className="tools-actions"><button className="secondary-button" disabled={busy} onClick={() => setBackup(null)}>取消恢复</button><button className="primary-button" disabled={busy} onClick={restore}>确认恢复，不覆盖原书</button></div></section>}
    {busy && <p role="status">正在处理，请不要关闭应用…</p>}
    {error && <p className="error-note" role="alert">{error}</p>}
    {notice && <p className="tools-notice" role="status">{notice}</p>}
  </Modal>;
}
