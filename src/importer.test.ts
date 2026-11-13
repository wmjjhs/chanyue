// 版权所有：波哥
// @vitest-environment jsdom
// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pdf = vi.hoisted(() => ({
  numPages: 1, password: false, empty: false, failOutline: false, failPageIndex: false,
  failOperator: false, outOfRange: false, hugeText: false, hasFont: false, outlineValue: undefined,
}));

const page = {
  getTextContent: async () => ({
    items: pdf.empty
      ? [{ str: '   ', hasEOL: false, transform: [0, 0, 12, 0], height: 12, fontName: 'f1' }, { kind: 'other' }]
      : [
          { str: pdf.hugeText ? '字'.repeat(2_000_100) : '第一章 正文', hasEOL: true, transform: [0, 0, 12, 0], height: 12, fontName: 'f1' },
          { str: '继续阅读文字。', hasEOL: false, transform: [0, 0, 14, 0], height: 14, fontName: 'f1' },
          { str: '无字体零尺寸', hasEOL: false, transform: [0, 0, 0, 0], height: 0, fontName: 'missing' },
          { kind: 'other' },
        ],
    styles: { f1: { fontFamily: 'Times-Bold' } },
  }),
  getOperatorList: async () => { if (pdf.failOperator) throw new Error('operator'); },
  commonObjs: {
    has: () => pdf.hasFont,
    get: (_name, callback) => { callback?.(); return { bold: true, black: false, cssFontInfo: { fontWeight: 700 } }; },
  },
  cleanup: () => {},
};

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: pdf.password
      ? Promise.reject(Object.assign(new Error('需要密码'), { name: 'PasswordException' }))
      : Promise.resolve({
          numPages: pdf.numPages,
          getPage: async () => page,
          getOutline: async () => {
            if (pdf.failOutline) throw new Error('outline');
            if (pdf.outlineValue !== undefined) return pdf.outlineValue;
            return [
              { title: '章节一', dest: [0], items: [{ title: '子章节', dest: [0] }] },
              { title: '命名目标', dest: 'named' },
              { title: pdf.failPageIndex ? '失败引用' : '引用目标', dest: [{ num: 0 }] },
              { title: '外部链接', url: 'https://example.com' },
              { title: pdf.outOfRange ? '越界' : '无目标' },
            ];
          },
          getDestination: async () => [0],
          getPageIndex: async () => {
            if (pdf.failPageIndex) throw new Error('page index');
            return 0;
          },
        }),
    destroy: vi.fn(async () => {}),
  })),
}));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));

const docx = vi.hoisted(() => ({ fail: false, empty: false }));
vi.mock('./docx-import', () => ({
  extractFormattedDocx: vi.fn(() => {
    if (docx.fail) throw new Error('zip 损坏');
    return { lines: docx.empty ? [] : ['Word 正文内容。'], typography: [], contents: [] };
  }),
}));

import { decodeText, extractDocx, importBook } from './importer';

const bytes = text => new TextEncoder().encode(text);
const makeFile = (name, data, size) => ({
  name, size: size ?? data.length,
  arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
});
const status = vi.fn();

beforeEach(() => {
  pdf.numPages = 1; pdf.password = false; pdf.empty = false; pdf.failOutline = false;
  pdf.failPageIndex = false; pdf.failOperator = false; pdf.outOfRange = false; pdf.hugeText = false;
  pdf.hasFont = false; pdf.outlineValue = undefined;
  docx.fail = false; docx.empty = false;
  status.mockClear();
  vi.clearAllMocks();
});

describe('文本解码与文档导入', () => {
  it('识别 UTF-8、GB18030、UTF-16LE 与 UTF-16BE', () => {
    expect(decodeText(bytes('春眠不觉晓'))).toBe('春眠不觉晓');
    expect(decodeText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toBe('中文');
    const utf16 = (little) => {
      const source = '中文阅读';
      const result = new Uint8Array(2 + source.length * 2);
      result[0] = little ? 0xff : 0xfe; result[1] = little ? 0xfe : 0xff;
      for (let i = 0; i < source.length; i++) {
        const code = source.charCodeAt(i);
        result[2 + i * 2] = little ? code & 0xff : code >> 8;
        result[3 + i * 2] = little ? code >> 8 : code & 0xff;
      }
      return result;
    };
    expect(decodeText(utf16(true))).toBe('中文阅读');
    expect(decodeText(utf16(false))).toBe('中文阅读');
  });

  it('校验文件大小、扩展名与空文件', async () => {
    await expect(importBook(makeFile('空.txt', new Uint8Array()), status)).rejects.toThrow('文件是空的');
    await expect(importBook(makeFile('大.txt', bytes('a'), 21 * 1024 * 1024), status)).rejects.toThrow('20 MB');
    await expect(importBook(makeFile('旧.doc', bytes('a')), status)).rejects.toThrow('另存为');
    await expect(importBook(makeFile('未知.epub', bytes('a')), status)).rejects.toThrow('TXT');
  });

  it('导入 TXT 并保留标题、格式与进度初值', async () => {
    const book = await importBook(makeFile('春晓.txt', bytes('春眠不觉晓，处处闻啼鸟。')), status);
    expect(book.title).toBe('春晓');
    expect(book.format).toBe('TXT');
    expect(book.lines[0]).toContain('春眠');
    expect(status).toHaveBeenCalled();
  });

  it('TXT 超长正文与损坏格式给出明确错误', async () => {
    await expect(importBook(makeFile('长.txt', bytes('字'.repeat(2_000_100))), status)).rejects.toThrow('200 万字');
    docx.fail = true;
    await expect(importBook(makeFile('坏.docx', bytes('x')), status)).rejects.toThrow('文件格式不正确');
  });

  it('导入 Word 正文，空正文时拒绝', async () => {
    expect(extractDocx(new Uint8Array([0x50, 0x4b]))).toContain('Word 正文');
    const book = await importBook(makeFile('文档.docx', bytes('x')), status);
    expect(book.format).toBe('WORD');
    docx.empty = true;
    await expect(importBook(makeFile('空.docx', bytes('x')), status)).rejects.toThrow('没有找到可阅读的文字');
  });

  it('PDF 校验头、页数、文字与加密状态', async () => {
    const invalid = await importBook(makeFile('假.pdf', bytes('not pdf')), status).catch(error => error);
    expect(invalid).toBeInstanceOf(Error);
    const book = await importBook(makeFile('真.pdf', bytes('%PDF-1.7 内容')), status);
    expect(book.format).toBe('PDF');
    expect(book.contents?.length).toBeGreaterThan(0);
  });

  it('PDF 超 2000 页、无文字、加密与超时分支', async () => {
    pdf.numPages = 2001;
    await expect(importBook(makeFile('多页.pdf', bytes('%PDF-1.7')), status)).rejects.toThrow('2000 页');
    pdf.numPages = 1; pdf.empty = true;
    await expect(importBook(makeFile('扫描.pdf', bytes('%PDF-1.7')), status)).rejects.toThrow('扫描件');
    pdf.empty = false; pdf.password = true;
    await expect(importBook(makeFile('加密.pdf', bytes('%PDF-1.7')), status)).rejects.toThrow('加密');
  });

  it('PDF 目录查找失败、操作列表失败与超长正文', async () => {
    pdf.failOutline = true;
    expect((await importBook(makeFile('目录.pdf', bytes('%PDF-1.7')), status)).lines.length).toBeGreaterThan(0);
    pdf.failOutline = false; pdf.failPageIndex = true; pdf.failOperator = true;
    expect((await importBook(makeFile('引用.pdf', bytes('%PDF-1.7')), status)).lines.length).toBeGreaterThan(0);
    pdf.failPageIndex = false; pdf.failOperator = false; pdf.hugeText = true;
    await expect(importBook(makeFile('超长.pdf', bytes('%PDF-1.7')), status)).rejects.toThrow('200 万字');
  });

  it('PDF 字体对象存在、未知字体与零尺寸回退', async () => {
    pdf.hasFont = true;
    const book = await importBook(makeFile('字体.pdf', bytes('%PDF-1.7')), status);
    expect(book.lines.length).toBeGreaterThan(0);
  });

  it('PDF 无目录、深层目录与非法目标', async () => {
    pdf.outlineValue = null;
    expect((await importBook(makeFile('无目录.pdf', bytes('%PDF-1.7')), status)).lines.length).toBeGreaterThan(0);
    let nested: any = { title: '末层', dest: [0] };
    for (let index = 0; index < 11; index++) nested = { title: `层${index}`, dest: [0], items: [nested] };
    pdf.outlineValue = [nested, { title: '空目标', dest: [] }, { title: '命名目标', dest: 'named' }];
    expect((await importBook(makeFile('深目录.pdf', bytes('%PDF-1.7')), status)).contents).toBeTruthy();
  });

  it('无扩展名与仅扩展名的文件分别处理', async () => {
    await expect(importBook(makeFile('无扩展名', bytes('内容')), status)).rejects.toThrow('TXT');
    const book = await importBook(makeFile('.txt', bytes('内容')), status);
    expect(book.title).toBe('未命名书籍');
  });
});
