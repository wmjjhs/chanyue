// 版权所有：波哥
import { strFromU8, unzipSync } from 'fflate';
import { makeId, splitLines, type Book } from './model';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TEXT = 2_000_000;

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
}

export function extractDocx(bytes: Uint8Array): string {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('这不是有效的 DOCX 文件，请用 Word 重新另存为 .docx。');
  let expanded = 0;
  const files = unzipSync(bytes, { filter(file) {
    expanded += file.originalSize;
    if (expanded > 80 * 1024 * 1024) throw new Error('Word 解压后的内容过大，请拆分文档后导入。');
    return file.name === 'word/document.xml';
  } });
  const document = files['word/document.xml'];
  if (!document) throw new Error('找不到 Word 正文，请确认文件为未加密的 .docx。');
  const xml = strFromU8(document);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持包含外部实体的 Word 文档。');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('Word 文档已损坏，无法读取正文。');
  const paragraphs = Array.from(dom.getElementsByTagNameNS('*', 'p'));
  return paragraphs.map(p => Array.from(p.getElementsByTagNameNS('*', '*'))
    .filter(node => ['t', 'tab', 'br', 'cr'].includes(node.localName))
    .map(node => node.localName === 't' ? node.textContent ?? '' : node.localName === 'tab' ? ' ' : '\n')
    .join('')).join('\n');
}

async function extractPdf(bytes: Uint8Array, onStatus: (status: string) => void): Promise<string> {
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) throw new Error('这不是有效的 PDF 文件。');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const base = `${import.meta.env.BASE_URL}pdf-assets/`;
  const task = pdfjs.getDocument({
    data: bytes, useSystemFonts: true,
    cMapUrl: `${base}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`,
  });
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; void task.destroy(); }, 90000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 2000) throw new Error('PDF 超过 2000 页，请拆分后导入。');
    let text = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      onStatus(`正在读取 PDF · ${n} / ${pdf.numPages} 页`);
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      text += '\n';
      page.cleanup();
      if (text.length > MAX_TEXT) throw new Error('正文超过 200 万字，请拆分书籍后导入。');
    }
    if (!text.trim()) throw new Error('这份 PDF 没有可提取的文字，可能是扫描件。请先使用 OCR 转成文字型 PDF。');
    return text;
  } catch (error) {
    if (timedOut) throw new Error('PDF 解析超时，请尝试较小的文件。');
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('PDF 已加密，请先解除密码保护后导入。');
    throw error;
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}

export async function importBook(file: File, onStatus: (status: string) => void): Promise<Book> {
  if (!file.size) throw new Error('文件是空的，请选择有内容的书籍。');
  if (file.size > MAX_FILE_SIZE) throw new Error('单个文件不能超过 20 MB，请拆分后导入。');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'doc') throw new Error('旧版 .doc 暂不支持，请在 Word 中另存为 .docx 后导入。');
  if (!['txt', 'docx', 'pdf'].includes(extension ?? '')) throw new Error('请选择 TXT、Word（.docx）或 PDF 文件。');
  onStatus(`正在读取 ${file.name}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = extension === 'txt' ? decodeText(bytes) : extension === 'docx' ? extractDocx(bytes) : await extractPdf(bytes, onStatus);
  } catch (error) {
    if (error instanceof Error && /zip|UTF|encoding|invalid pdf/i.test(error.message)) throw new Error('文件格式不正确或内容已损坏，请重新导出后导入。');
    throw error;
  }
  if (text.length > MAX_TEXT) throw new Error('正文超过 200 万字，请拆分书籍后导入。');
  const lines = splitLines(text);
  if (!lines.length) throw new Error('没有找到可阅读的文字，请检查文件内容。');
  return {
    id: makeId(), title: file.name.replace(/\.[^.]+$/, '').slice(0, 150) || '未命名书籍',
    author: '本地导入', format: extension === 'txt' ? 'TXT' : extension === 'docx' ? 'WORD' : 'PDF',
    lines, line: 0, offset: null, completed: false,
    createdAt: Date.now(), lastReadAt: 0, cover: Math.floor(Math.random() * 6),
  };
}
