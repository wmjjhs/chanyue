// 版权所有：波哥
import { makeId, splitLines, type Book } from './model';
import { extractFormattedDocx } from './docx-import';
import { normalizeFormatted, type FormattedText, type TextPiece } from './typography';
import { MAX_CONTENTS, validateContents, type ContentsEntry } from './reading-tools';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TEXT = 2_000_000;

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
}

export function extractDocx(bytes: Uint8Array): string {
  return extractFormattedDocx(bytes).lines.join('\n');
}

async function extractPdf(bytes: Uint8Array, onStatus: (status: string) => void): Promise<FormattedText> {
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) throw new Error('这不是有效的 PDF 文件。');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const base = `${import.meta.env.BASE_URL}pdf-assets/`;
  const task = pdfjs.getDocument({
    data: bytes, useSystemFonts: true, disableFontFace: true,
    cMapUrl: `${base}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`,
  });
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; void task.destroy(); }, 90000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 2000) throw new Error('PDF 超过 2000 页，请拆分后导入。');
    const pieces: TextPiece[] = [];
    let length = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      onStatus(`正在读取 PDF · ${n} / ${pdf.numPages} 页`);
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      if (content.items.some(item => 'str' in item && item.str.trim())) pieces.push({ text: '', anchor: `page-${n - 1}` });
      try { await page.getOperatorList(); } catch { if (timedOut) throw new Error('PDF 解析超时'); }
      await Promise.all(Object.keys(content.styles).filter(name => !page.commonObjs.has(name)).map(name => new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 2000);
        page.commonObjs.get(name, () => { clearTimeout(timeout); resolve(); });
      })));
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const text = item.str + (item.hasEOL ? '\n' : ' ');
        const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : null;
        const family = content.styles[item.fontName]?.fontFamily ?? '';
        const size = Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.height) || 12;
        const bold = font?.bold === true || font?.black === true || Number(font?.cssFontInfo?.fontWeight) >= 600 || /bold|black|heavy|semibold/i.test(family);
        pieces.push({ text, size, bold }); length += text.length;
        if (length > MAX_TEXT) throw new Error('正文超过 200 万字，请拆分书籍后导入。');
      }
      pieces.push({ text: '\n' }); length++;
      page.cleanup();
    }
    const result = normalizeFormatted(pieces);
    if (!result.lines.length) throw new Error('这份 PDF 没有可提取的文字，可能是扫描件。请先使用 OCR 转成文字型 PDF。');
    const contents: ContentsEntry[] = [];
    try {
      const outline = await pdf.getOutline();
      const pending = (outline ?? []).slice(0, MAX_CONTENTS).map(item => ({ item, level: 1 })).reverse();
      let examined = 0;
      while (pending.length && examined++ < MAX_CONTENTS) {
        const { item, level } = pending.pop()!;
        if (level < 9) pending.push(...(item.items ?? []).slice(0, MAX_CONTENTS - examined).map(child => ({ item: child, level: level + 1 })).reverse());
        if (!item.dest || item.url || item.unsafeUrl) continue;
        try {
          const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          if (!Array.isArray(dest) || !dest.length) continue;
          const index = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]);
          const source = result.anchors?.[`page-${index}`];
          if (Number.isInteger(index) && index >= 0 && index < pdf.numPages && source !== undefined) contents.push({ title: item.title, source, level });
        } catch { if (timedOut) throw new Error('PDF 解析超时'); }
      }
    } catch { if (timedOut) throw new Error('PDF 解析超时'); }
    result.contents = validateContents(contents, result.lines.join('\n').length);
    return result;
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
  let formatted: FormattedText;
  try {
    if (extension === 'txt') {
      const text = decodeText(bytes);
      if (text.length > MAX_TEXT) throw new Error('正文超过 200 万字，请拆分书籍后导入。');
      formatted = { lines: splitLines(text), typography: [] };
    } else formatted = extension === 'docx' ? extractFormattedDocx(bytes) : await extractPdf(bytes, onStatus);
  } catch (error) {
    if (error instanceof Error && /zip|UTF|encoding|invalid pdf/i.test(error.message)) throw new Error('文件格式不正确或内容已损坏，请重新导出后导入。');
    throw error;
  }
  const { lines, typography } = formatted;
  if (!lines.length) throw new Error('没有找到可阅读的文字，请检查文件内容。');
  return {
    id: makeId(), title: file.name.replace(/\.[^.]+$/, '').slice(0, 150) || '未命名书籍',
    author: '本地导入', format: extension === 'txt' ? 'TXT' : extension === 'docx' ? 'WORD' : 'PDF',
    lines, typography, contents: formatted.contents ?? [], typographyVersion: 1, line: 0, offset: null, character: 0, paragraphsPreserved: true, completed: false,
    createdAt: Date.now(), lastReadAt: 0, cover: Math.floor(Math.random() * 6),
  };
}
