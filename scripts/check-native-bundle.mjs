// 版权所有：波哥
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../dist-native/', import.meta.url));
const html = readFileSync(`${root}/index.html`, 'utf8');
assert(html.includes('Content-Security-Policy'), '原生包缺少离线安全策略');
assert(!/registerSW|manifest\.webmanifest|https?:\/\//.test(html), '原生页面含联网或 Service Worker 入口');
assert(!existsSync(`${root}/sw.js`), '原生包不应依赖 Service Worker');
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  assert(readdirSync(`${root}/pdf-assets/${folder}`).length > 0, `缺少 PDF 离线资源：${folder}`);
}
const assets = readdirSync(`${root}/assets`);
assert(assets.some(file => /^pdf\.worker.*\.mjs$/.test(file)), '缺少 PDF 工作线程');
assert(assets.some(file => /^pdf-.*\.js$/.test(file)), '缺少 PDF 解析器');
for (const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
  assert(existsSync(`${root}${match[1]}`), `缺少入口资源：${match[1]}`);
}
const config = readFileSync(new URL('../capacitor.config.ts', import.meta.url), 'utf8');
assert(!/\bserver\s*:/.test(config), '发布配置不允许远程服务器');
console.log('PASS 原生离线资源：本地入口、PDF 引擎/工作线程/字库、无远程服务器、无 Service Worker。');
