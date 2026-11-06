// 版权所有：波哥
import { strFromU8, unzipSync } from 'fflate';
import { normalizeFormatted, type FormattedText, type TextPiece } from './typography';
import { MAX_CONTENTS, validateContents } from './reading-tools';

const namespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const isWord = (node: Element, name?: string) => namespaces.has(node.namespaceURI ?? '') && (!name || node.localName === name);
const child = (node: Element | undefined, name: string) => node ? Array.from(node.children).find(value => isWord(value, name)) : undefined;
const attribute = (node: Element | undefined, name: string) => node ? Array.from(node.attributes).find(value => namespaces.has(value.namespaceURI ?? '') && value.localName === name)?.value : undefined;
type Style = { size?: number; bold?: boolean };
const on = (node: Element | undefined) => node ? !['0', 'false', 'off'].includes((attribute(node, 'val') ?? '1').toLowerCase()) : undefined;
function properties(base: Style, node: Element | undefined, toggle = false): Style {
  const result = { ...base };
  const raw = attribute(child(node, 'sz') ?? child(node, 'szCs'), 'val');
  const size = raw === undefined ? NaN : Number(raw) / 2;
  if (Number.isFinite(size) && size > 0) result.size = Math.min(400, Math.max(1, size));
  const bold = on(child(node, 'b') ?? child(node, 'bCs'));
  if (bold !== undefined && (!toggle || bold)) result.bold = toggle ? !base.bold : bold;
  return result;
}
function parse(bytes: Uint8Array): Document {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持包含外部实体的 Word 文档。');
  const dom = new DOMParser().parseFromString(text, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length) throw new Error('Word 文档已损坏，无法读取正文。');
  return dom;
}

export function extractFormattedDocx(bytes: Uint8Array): FormattedText {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('这不是有效的 DOCX 文件，请用 Word 重新另存为 .docx。');
  let expanded = 0;
  const files = unzipSync(bytes, { filter(file) {
    expanded += file.originalSize;
    if (expanded > 80 * 1024 * 1024) throw new Error('Word 解压后的内容过大，请拆分文档后导入。');
    return ['word/document.xml', 'word/styles.xml'].includes(file.name);
  } });
  if (!files['word/document.xml']) throw new Error('找不到 Word 正文，请确认文件为未加密的 .docx。');
  const dom = parse(files['word/document.xml']);
  const styleDom = files['word/styles.xml'] ? parse(files['word/styles.xml']) : null;
  const styles = new Map<string, Element>();
  for (const node of Array.from(styleDom?.getElementsByTagNameNS('*', 'style') ?? [])) {
    const id = attribute(node, 'styleId');
    if (id && isWord(node)) styles.set(id, node);
    if (styles.size > 10000) throw new Error('Word 样式数量过多，请简化或拆分文档。');
  }
  const defaults = child(styleDom?.documentElement, 'docDefaults');
  const base = properties({ size: 12, bold: false }, child(child(defaults, 'rPrDefault'), 'rPr'));
  const normal = [...styles].find(([, node]) => attribute(node, 'type') === 'paragraph' && attribute(node, 'default') === '1')?.[0];
  const cache = new Map<string, Style>();
  const resolve = (id: string | undefined, inherited: Style, type: string): Style => {
    if (!id) return inherited;
    const key = `${id}:${type}:${inherited.size}:${inherited.bold}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const chain: Element[] = [], seen = new Set<string>();
    let current: string | undefined = id;
    while (current && !seen.has(current) && chain.length < 32) {
      seen.add(current);
      const node = styles.get(current);
      if (!node || attribute(node, 'type') !== type) break;
      chain.unshift(node); current = attribute(child(node, 'basedOn'), 'val');
    }
    let style = { ...inherited };
    for (const node of chain) style = properties(style, child(node, 'rPr'), true);
    const heading = /^(?:heading|标题)\s*([1-6])$/i.exec(attribute(child(styles.get(id), 'name'), 'val') ?? id);
    if (type === 'paragraph' && heading && !chain.some(node => child(child(node, 'rPr'), 'sz') || child(child(node, 'rPr'), 'szCs'))) {
      style.size = (base.size ?? 12) * [2, 1.6, 1.4, 1.2, 1.1, 1][Number(heading[1]) - 1];
      if (!chain.some(node => child(child(node, 'rPr'), 'b'))) style.bold = true;
    }
    cache.set(key, style); return style;
  };
  const pieces: TextPiece[] = [];
  const headings: { anchor: string; title: string; level: number }[] = [];
  const headingLevel = (paragraph: Element): number | null => {
    const direct = attribute(child(child(paragraph, 'pPr'), 'outlineLvl'), 'val');
    if (direct !== undefined) return /^[0-8]$/.test(direct) ? Number(direct) + 1 : null;
    let id = attribute(child(child(paragraph, 'pPr'), 'pStyle'), 'val');
    const seen = new Set<string>();
    while (id && !seen.has(id) && seen.size < 32) {
      seen.add(id);
      const style = styles.get(id);
      const outline = attribute(child(child(style, 'pPr'), 'outlineLvl'), 'val');
      if (outline !== undefined) return /^[0-8]$/.test(outline) ? Number(outline) + 1 : null;
      const match = /^(?:heading|标题)\s*([1-9])$/i.exec(attribute(child(style, 'name'), 'val') ?? id);
      if (match) return Number(match[1]);
      id = attribute(child(style, 'basedOn'), 'val');
    }
    return null;
  };
  let textLength = 0;
  const push = (text: string, style: Style = {}) => {
    textLength += text.length;
    if (textLength > 2_000_000) throw new Error('正文超过 200 万字，请拆分书籍后导入。');
    pieces.push({ text, ...style });
  };
  for (const paragraph of Array.from(dom.getElementsByTagNameNS('*', 'p')).filter(node => isWord(node))) {
    const paragraphStyle = resolve(attribute(child(child(paragraph, 'pPr'), 'pStyle'), 'val') ?? normal, base, 'paragraph');
    const level = headingLevel(paragraph);
    const startPiece = pieces.length;
    const anchor = `heading-${headings.length}`;
    const walker = dom.createTreeWalker(paragraph, 1);
    let next: Node | null;
    while ((next = walker.nextNode())) {
      const node = next as Element;
      if (!isWord(node) || !['t', 'tab', 'br', 'cr'].includes(node.localName)) continue;
      let parent = node.parentElement, run: Element | undefined;
      while (parent && parent !== paragraph) {
        if (isWord(parent, 'p')) break;
        if (isWord(parent, 'r')) run = parent;
        parent = parent.parentElement;
      }
      if (parent !== paragraph) continue;
      const rPr = child(run, 'rPr');
      const style = properties(resolve(attribute(child(rPr, 'rStyle'), 'val'), paragraphStyle, 'character'), rPr);
      push(node.localName === 't' ? node.textContent ?? '' : node.localName === 'tab' ? ' ' : '\n', style);
    }
    if (level && headings.length < MAX_CONTENTS && pieces.length > startPiece) {
      const title = pieces.slice(startPiece).map(piece => piece.text).join('').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (title) { pieces[startPiece].anchor = anchor; headings.push({ anchor, title, level }); }
    }
    push('\n');
  }
  const result = normalizeFormatted(pieces);
  result.contents = validateContents(headings.map(entry => ({ title: entry.title, level: entry.level, source: result.anchors?.[entry.anchor] })), result.lines.join('\n').length);
  return result;
}
