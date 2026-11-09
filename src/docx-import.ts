// 版权所有：波哥
import { strFromU8, unzipSync } from 'fflate';
import { MAX_STYLE_RUNS, normalizeFormatted, type FormattedText, type TextPiece } from './typography';
import { MAX_CONTENTS, validateContents } from './reading-tools';
import { validateSourceFont } from './source-font';

const namespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const isWord = (node: Element, name?: string) => namespaces.has(node.namespaceURI ?? '') && (!name || node.localName === name);
const child = (node: Element | undefined, name: string) => node ? Array.from(node.children).find(value => isWord(value, name)) : undefined;
const attribute = (node: Element | undefined, name: string) => node ? Array.from(node.attributes).find(value => namespaces.has(value.namespaceURI ?? '') && value.localName === name)?.value : undefined;
const fontSlots = ['ascii', 'hAnsi', 'eastAsia', 'cs'] as const;
type FontSlot = typeof fontSlots[number];
type Style = { size?: number; sizeCs?: number; bold?: boolean; boldCs?: boolean; complex?: boolean; eastAsiaLanguage?: string; complexLanguage?: string; hint?: string; fonts?: Partial<Record<FontSlot, { name?: string; theme?: string }>> };
const truth = (value: string | undefined) => value !== undefined && ['1', 'true', 'on'].includes(value.toLowerCase());
const on = (node: Element | undefined) => node ? !['0', 'false', 'off'].includes((attribute(node, 'val') ?? '1').toLowerCase()) : undefined;
function properties(base: Style, node: Element | undefined, toggle = false): Style {
  const result = { ...base };
  for (const [xml, key] of [['sz', 'size'], ['szCs', 'sizeCs']] as const) {
    const raw = attribute(child(node, xml), 'val');
    const size = raw === undefined ? NaN : Number(raw) / 2;
    if (Number.isFinite(size) && size > 0) result[key] = Math.min(400, Math.max(1, size));
  }
  for (const [xml, key] of [['b', 'bold'], ['bCs', 'boldCs']] as const) {
    const value = on(child(node, xml));
    if (value !== undefined && (!toggle || value)) result[key] = toggle ? !base[key] : value;
  }
  const complex = on(child(node, 'cs')) ?? on(child(node, 'rtl'));
  if (complex !== undefined) result.complex = complex;
  const language = attribute(child(node, 'lang'), 'eastAsia');
  if (language) result.eastAsiaLanguage = language;
  const complexLanguage = attribute(child(node, 'lang'), 'bidi');
  if (complexLanguage) result.complexLanguage = complexLanguage;
  const fonts = child(node, 'rFonts');
  if (fonts) {
    const hint = attribute(fonts, 'hint');
    if (hint) result.hint = hint;
    result.fonts = { ...base.fonts };
    for (const slot of fontSlots) {
      const name = validateSourceFont(attribute(fonts, slot));
      const theme = slot === 'cs' ? attribute(fonts, 'cstheme') ?? attribute(fonts, 'csTheme') : attribute(fonts, `${slot}Theme`);
      if (name || theme) result.fonts[slot] = { name, theme };
    }
  }
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
    return ['word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels'].includes(file.name) || /^word\/theme\/[^/]+\.xml$/.test(file.name);
  } });
  if (!files['word/document.xml']) throw new Error('找不到 Word 正文，请确认文件为未加密的 .docx。');
  const dom = parse(files['word/document.xml']);
  const styleDom = files['word/styles.xml'] ? parse(files['word/styles.xml']) : null;
  let themePath = 'word/theme/theme1.xml';
  if (files['word/_rels/document.xml.rels']) {
    const rels = parse(files['word/_rels/document.xml.rels']);
    const relation = Array.from(rels.documentElement.children).find(node => /\/theme$/.test(node.getAttribute('Type') ?? '') && node.getAttribute('TargetMode') !== 'External');
    const target = relation?.getAttribute('Target') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    if (/^word\/theme\/[^/]+\.xml$/.test(path) && !path.includes('..')) themePath = path;
  }
  const theme = files[themePath] ? parse(files[themePath]) : null;
  const drawingNamespaces = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']);
  const themeGroups = new Map<string, Map<string, string>>();
  for (const kind of ['major', 'minor']) {
    const group = Array.from(theme?.getElementsByTagNameNS('*', `${kind}Font`) ?? []).find(node => drawingNamespaces.has(node.namespaceURI ?? ''));
    const names = new Map<string, string>();
    for (const node of Array.from(group?.children ?? [])) {
      if (!drawingNamespaces.has(node.namespaceURI ?? '')) continue;
      const name = validateSourceFont(node.getAttribute('typeface'));
      const key = node.localName === 'font' ? `font:${node.getAttribute('script')}` : node.localName;
      if (name && !names.has(key)) names.set(key, name);
    }
    themeGroups.set(kind, names);
  }
  const themeFont = (reference: string | undefined, language?: string): string | undefined => {
    const match = /^(major|minor)(Ascii|HAnsi|EastAsia|Bidi)$/.exec(reference ?? '');
    if (!match) return undefined;
    const names = themeGroups.get(match[1]);
    const slot = match[2] === 'EastAsia' ? 'ea' : match[2] === 'Bidi' ? 'cs' : 'latin';
    const direct = names?.get(slot);
    if (direct) return direct;
    if (slot === 'ea' || slot === 'cs') {
      const scripts: Record<string, string> = { ar: 'Arab', fa: 'Arab', ur: 'Arab', he: 'Hebr', yi: 'Hebr', hi: 'Deva', mr: 'Deva', ne: 'Deva', bn: 'Beng', ta: 'Taml', te: 'Telu', kn: 'Knda', ml: 'Mlym', th: 'Thai', bo: 'Tibt' };
      const script = slot === 'cs' ? scripts[(language ?? '').split('-')[0].toLowerCase()] : /^ja/i.test(language ?? '') ? 'Jpan' : /^ko/i.test(language ?? '') ? 'Hang' : /^zh-(TW|HK|MO|Hant)/i.test(language ?? '') ? 'Hant' : 'Hans';
      return names?.get(`font:${script}`);
    }
    return undefined;
  };
  const styles = new Map<string, Element>();
  for (const node of Array.from(styleDom?.getElementsByTagNameNS('*', 'style') ?? [])) {
    const id = attribute(node, 'styleId');
    if (id && isWord(node)) styles.set(id, node);
    if (styles.size > 10000) throw new Error('Word 样式数量过多，请简化或拆分文档。');
  }
  const defaults = child(styleDom?.documentElement, 'docDefaults');
  const base = properties({ size: 12, bold: false }, child(child(defaults, 'rPrDefault'), 'rPr'));
  const normal = [...styles].find(([, node]) => attribute(node, 'type') === 'paragraph' && truth(attribute(node, 'default')))?.[0];
  const cache = new Map<string, Style>();
  const resolve = (id: string | undefined, inherited: Style, type: string): Style => {
    if (!id) return inherited;
    const key = JSON.stringify([id, type, inherited]);
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
    if (cache.size < 20000) cache.set(key, style);
    return style;
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
    let part: TextPiece | undefined;
    const complexLanguage = style.complexLanguage ?? (/[\u0600-\u08ff]/u.test(text) ? 'ar' : /[\u0590-\u05ff]/u.test(text) ? 'he' : /[\u0900-\u097f]/u.test(text) ? 'hi' : /[\u0e00-\u0e7f]/u.test(text) ? 'th' : undefined);
    const resolvedFonts = Object.fromEntries(fontSlots.map(slot => {
      const ref = style.fonts?.[slot] ?? (slot === 'hAnsi' ? style.fonts?.ascii : undefined);
      return [slot, themeFont(ref?.theme, slot === 'cs' ? complexLanguage : style.eastAsiaLanguage) ?? ref?.name];
    }));
    for (const char of text) {
      const complex = style.complex || /[\u0590-\u08ff\u0900-\u0dff\u0e00-\u0fff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(char);
      const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u.test(char) || (style.hint === 'eastAsia' && /[\u2000-\u206f]/u.test(char));
      const slot = complex ? 'cs' : eastAsian ? 'eastAsia' : char.codePointAt(0)! < 128 ? 'ascii' : 'hAnsi';
      const font = resolvedFonts[slot];
      const bold = complex ? style.boldCs ?? false : style.bold ?? false;
      const size = complex ? style.sizeCs ?? style.size : style.size;
      if (part && part.font === font && part.bold === bold && part.size === size) part.text += char;
      else {
        part = { text: char, font, bold, size }; pieces.push(part);
        if (pieces.length > MAX_STYLE_RUNS) throw new Error('文档字体变化过多，请拆分文档后导入。');
      }
    }
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
