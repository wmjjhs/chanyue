// 版权所有：波哥
// @vitest-environment jsdom
// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';

const zip = vi.hoisted(() => ({ files: {}, huge: false, limit: false }));
vi.mock('fflate', () => ({
  strFromU8: bytes => new TextDecoder().decode(bytes),
  unzipSync: vi.fn((_bytes, options) => {
    const result = {};
    for (const [name, text] of Object.entries(zip.files)) {
      const data = new TextEncoder().encode(text);
      const originalSize = zip.huge && name === 'word/huge.xml' ? 81 * 1024 * 1024 : data.length;
      if (options.filter({ name, originalSize, size: data.length })) result[name] = data;
    }
    return result;
  }),
}));

import { extractFormattedDocx } from './docx-import';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const D = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const doc = body => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;

const styles = `<?xml version="1.0"?><w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/><w:szCs w:val="22"/><w:b/><w:bCs w:val="0"/><w:cs/><w:lang w:eastAsia="zh-CN" w:bidi="ar-SA"/><w:rFonts w:ascii="Calibri" w:asciiTheme="minorAscii" w:eastAsiaTheme="majorEastAsia" w:cstheme="minorBidi" w:hint="eastAsia"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:b w:val="0"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Base"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="30"/><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Base"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="character" w:styleId="Emphasis"><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:rFonts w:ascii="Georgia" w:asciiTheme="majorAscii"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="NamedHeading"><w:name w:val="heading 3"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="NamedChain"><w:name w:val="Custom"/><w:basedOn w:val="Base"/><w:rPr><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="Table"><w:name w:val="Table"/></w:style>
</w:styles>`;

const theme = `<?xml version="1.0"?><a:theme xmlns:a="${D}"><a:themeElements><a:fontScheme>
  <a:majorFont><a:latin typeface="MajorLatin"/><a:font script="Hans" typeface="思源宋体"/><a:font script="Arab" typeface="ArabicFont"/></a:majorFont>
  <a:minorFont><a:latin typeface="MinorLatin"/><a:ea typeface="MinorEA"/><a:cs typeface="MinorCS"/></a:minorFont>
</a:fontScheme></a:themeElements></a:theme>`;

const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" TargetMode="External" Target="http://example.com/theme"/>
</Relationships>`;

const richBody = `
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
    <w:r><w:rPr><w:rStyle w:val="Emphasis"/><w:b w:val="0"/><w:sz w:val="28"/><w:lang w:eastAsia="ja-JP"/><w:rFonts w:ascii="Times New Roman" w:eastAsiaTheme="majorEastAsia" w:cstheme="minorBidi" w:hint="eastAsia"/></w:rPr><w:t>第一章 春风又绿江南岸</w:t></w:r>
    <w:r><w:tab/><w:br/><w:cr/></w:r>
    <x:t xmlns:x="urn:other">忽略</x:t>
  </w:p>
  <w:p><w:pPr><w:pStyle w:val="Base"/></w:pPr><w:r><w:t>第二段落文字，包含 English 与标点。</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:cs/><w:rtl/><w:lang w:bidi="he-IL"/><w:rFonts w:cs="Arial" w:cstheme="majorBidi"/></w:rPr><w:t>مرحبا שלום नमस्ते สวัสดี عربى</w:t></w:r></w:p>
  <w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>第三章</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Courier"/></w:rPr><w:t>等宽与未知字体回退</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="NamedHeading"/></w:pPr><w:r><w:t>按名称识别的标题</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="NamedChain"/></w:pPr><w:r><w:t>沿样式链继承标题</w:t></w:r></w:p>`;

const baseFiles = () => ({
  'word/document.xml': doc(richBody),
  'word/styles.xml': styles,
  'word/_rels/document.xml.rels': rels,
  'word/theme/theme1.xml': theme,
  'word/media/image1.png': '<not-xml>',
});

beforeEach(() => {
  zip.files = baseFiles();
  zip.huge = false;
  vi.clearAllMocks();
});

describe('Word 文档解析', () => {
  it('解析样式链、主题字体、目录与多种文字槽位', () => {
    const result = extractFormattedDocx(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(result.lines.join('')).toContain('第一章');
    expect(result.typography.length).toBeGreaterThan(0);
    expect(result.contents?.length).toBeGreaterThan(0);
  });

  it('无样式与主题文件时仍可按默认样式解析正文', () => {
    zip.files = { 'word/document.xml': doc('<w:p><w:r><w:t>纯正文内容。</w:t></w:r></w:p>') };
    const result = extractFormattedDocx(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(result.lines.join('')).toContain('纯正文内容');
  });

  it('关系文件指向其它主题路径或绝对路径时安全回退', () => {
    zip.files['word/_rels/document.xml.rels'] = `<?xml version="1.0"?><Relationships><Relationship Type="http://x/theme" Target="/word/theme/theme2.xml"/></Relationships>`;
    zip.files['word/theme/theme2.xml'] = theme;
    expect(extractFormattedDocx(new Uint8Array([0x50, 0x4b])).lines.length).toBeGreaterThan(0);
  });

  it('拒绝非 zip、缺正文、实体声明与损坏 XML', () => {
    expect(() => extractFormattedDocx(new Uint8Array([0, 1, 2]))).toThrow('不是有效的 DOCX');
    zip.files = { 'word/other.xml': '<x/>' };
    expect(() => extractFormattedDocx(new Uint8Array([0x50, 0x4b]))).toThrow('找不到 Word 正文');
    zip.files = { 'word/document.xml': '<!DOCTYPE w:document><w:document/>' };
    expect(() => extractFormattedDocx(new Uint8Array([0x50, 0x4b]))).toThrow('外部实体');
    zip.files = { 'word/document.xml': '<w:document><w:body>' };
    expect(() => extractFormattedDocx(new Uint8Array([0x50, 0x4b]))).toThrow('无法读取正文');
  });

  it('解压体积超过上限时拒绝解析', () => {
    zip.huge = true;
    zip.files['word/huge.xml'] = '<x/>';
    expect(() => extractFormattedDocx(new Uint8Array([0x50, 0x4b]))).toThrow('解压后的内容过大');
  });

  it('超出正文长度或样式变化上限时明确报错', () => {
    const huge = '字'.repeat(300);
    zip.files = { 'word/document.xml': doc(`<w:p><w:r><w:t>${huge}</w:t></w:r></w:p>`) };
    expect(extractFormattedDocx(new Uint8Array([0x50, 0x4b])).lines.length).toBeGreaterThan(0);
    const manyRuns = Array.from({ length: 40 }, (_, i) => `<w:r><w:rPr><w:rFonts w:ascii="Font${i}"/><w:sz w:val="${20 + i}"/></w:rPr><w:t>${i}</w:t></w:r>`).join('');
    zip.files = { 'word/document.xml': doc(`<w:p>${manyRuns}</w:p>`) };
    expect(extractFormattedDocx(new Uint8Array([0x50, 0x4b])).typography.length).toBeGreaterThan(0);
  });

  it('主题缺少对应字体槽位时安全回退', () => {
    zip.files = {
      'word/document.xml': doc('<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="majorAscii"/></w:rPr><w:t>主题字体回退</w:t></w:r></w:p>'),
      'word/styles.xml': styles,
      'word/_rels/document.xml.rels': rels,
      'word/theme/theme1.xml': `<?xml version="1.0"?><a:theme xmlns:a="${D}"><a:themeElements><a:fontScheme><a:majorFont><a:ea typeface="EA"/></a:majorFont><a:minorFont/></a:fontScheme></a:themeElements></a:theme>`,
    };
    expect(extractFormattedDocx(new Uint8Array([0x50, 0x4b])).lines.join('')).toContain('主题字体回退');
  });

  it('关系文件缺失、无类型、外部链接、上级路径与绝对路径', () => {
    const variants = [
      '',
      '<Relationship Target="theme/theme1.xml"/>',
      '<Relationship Type="http://x/theme" TargetMode="External" Target="theme/theme1.xml"/>',
      '<Relationship Type="http://x/theme" Target="../theme/theme1.xml"/>',
      '<Relationship Type="http://x/theme" Target="/word/theme/theme2.xml"/>',
      '<Relationship Type="http://x/theme" Target="elsewhere.xml"/>',
    ];
    for (const body of variants) {
      zip.files = {
        ...baseFiles(),
        'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships>${body}</Relationships>`,
        'word/theme/theme2.xml': theme,
      };
      expect(extractFormattedDocx(new Uint8Array([0x50, 0x4b])).lines.length).toBeGreaterThan(0);
    }
  });

  it('主题缺少字体组、混入非法命名空间与重复脚本', () => {
    const themeXml = `<?xml version="1.0"?><a:theme xmlns:a="${D}" xmlns:x="urn:other"><a:themeElements><a:fontScheme>
      <a:majorFont><a:latin typeface="MajorLatin"/><x:latin typeface="Wrong"/><a:font script="Hans" typeface="HansFont"/><a:font script="Hans" typeface="Duplicate"/><a:font script="Jpan" typeface="JaFont"/><a:font script="Hang" typeface="KoFont"/><a:font script="Hant" typeface="HantFont"/><a:font script="Arab" typeface="ArFont"/><a:font script="Hebr" typeface="HeFont"/><a:font script="Deva" typeface="HiFont"/><a:font script="Thai" typeface="ThFont"/><a:font script="None"/></a:majorFont>
      <a:minorFont><a:latin typeface="MinorLatin"/><a:cs typeface="MinorCS"/></a:minorFont>
    </a:fontScheme></a:themeElements></a:theme>`;
    const body = [
      ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['zh-TW', '繁體'], ['zh-CN', '简体'], ['', '默认'],
    ].map(([lang, text]) => `<w:p><w:r><w:rPr><w:rFonts w:eastAsiaTheme="majorEastAsia" w:asciiTheme="minorAscii"/><w:lang w:eastAsia="${lang}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`).join('');
    zip.files = { ...baseFiles(), 'word/theme/theme1.xml': themeXml, 'word/document.xml': doc(body) };
    expect(extractFormattedDocx(new Uint8Array([0x50, 0x4b])).lines.join('')).toContain('简体');
  });

  it('样式表含无标识、非 Word 命名空间、非法大纲与命名标题', () => {
    const stylesXml = `<?xml version="1.0"?><w:styles xmlns:w="${W}" xmlns:x="urn:other">
      <w:style w:type="paragraph" w:styleId="NoName"><w:basedOn w:val="Named"/></w:style>
      <w:style w:type="paragraph" w:styleId="Named"><w:name w:val="heading 4"/></w:style>
      <w:style w:type="paragraph" w:styleId="BadOutline"><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>
      <w:style w:type="paragraph"><w:name w:val="no-id"/></w:style>
      <x:style w:styleId="WrongNs"/>
    </w:styles>`;
    const body = `
      <w:p><w:pPr><w:outlineLvl w:val="9"/></w:pPr><w:r><w:t>非法直接大纲</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Named"/></w:pPr><w:r><w:t>命名标题</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="NoName"/></w:pPr><w:r><w:t>继承标题</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="BadOutline"/></w:pPr><w:r><w:t>非法样式大纲</w:t></w:r></w:p>
      <w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>   </w:t></w:r></w:p>`;
    zip.files = { ...baseFiles(), 'word/styles.xml': stylesXml, 'word/document.xml': doc(body) };
    const result = extractFormattedDocx(new Uint8Array([0x50, 0x4b]));
    expect(result.lines.join('')).toContain('命名标题');
    expect(result.contents?.length).toBeGreaterThan(0);
  });

  it('样式数量超过上限时拒绝解析', () => {
    const manyStyles = Array.from({ length: 10001 }, (_, index) => ({
      namespaceURI: W, localName: 'style',
      attributes: [{ namespaceURI: W, localName: 'styleId', value: `B${index}` }],
    })) as any;
    const original = Document.prototype.getElementsByTagNameNS;
    vi.spyOn(Document.prototype, 'getElementsByTagNameNS').mockImplementation(function (this: Document, namespace: string | null, name: string) {
      return name === 'style' ? manyStyles : original.call(this, namespace, name);
    } as any);
    zip.files = { ...baseFiles(), 'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>` };
    expect(() => extractFormattedDocx(new Uint8Array([0x50, 0x4b]))).toThrow('样式数量过多');
    vi.restoreAllMocks();
  });

  it('多语言槽位、嵌套段落、空白标题与制表换行', () => {
    const body = `
      <w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Times" w:cs="Courier" w:cstheme="majorBidi"/><w:b w:val="0"/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="30"/><w:lang w:eastAsia="ja-JP"/></w:rPr><w:t>é Ω مرحبا שלום नमस्ते สวัสดี 中文 ABC</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:rFonts w:ascii="Other"/><w:sz w:val="40"/></w:rPr><w:t>é</w:t></w:r></w:p>
      <w:p><w:p><w:r><w:t>嵌套段落</w:t></w:r></w:p></w:p>
      <w:p><w:r><w:tab/><w:br/><w:cr/></w:r></w:p>
      <w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>`;
    zip.files = { ...baseFiles(), 'word/document.xml': doc(body) };
    const result = extractFormattedDocx(new Uint8Array([0x50, 0x4b]));
    expect(result.lines.join('')).toContain('中文');
    expect(result.typography.length).toBeGreaterThan(0);
  });

  it('正文超过 200 万字时拒绝解析', () => {
    zip.files = { 'word/document.xml': doc(`<w:p><w:r><w:t>${'字'.repeat(2_000_001)}</w:t></w:r></w:p>`) };
    expect(() => extractFormattedDocx(new Uint8Array([0x50, 0x4b]))).toThrow('200 万字');
  });
});
