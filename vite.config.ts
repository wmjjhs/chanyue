// 版权所有：波哥
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'native' ? {
      name: 'native-offline-policy',
      transformIndexHtml() {
        return [{ tag: 'meta', attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'",
        }, injectTo: 'head-prepend' }];
      },
    } : VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '禅阅 · 让阅读回归宁静',
        short_name: '禅阅',
        description: '一行文字，一段与自己相处的时光。',
        lang: 'zh-CN',
        theme_color: '#f7f7f2',
        background_color: '#f7f7f2',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,bcmap,pfb,ttf,wasm}'],
        maximumFileSizeToCacheInBytes: 6000000,
        navigateFallbackDenylist: [/^\/pdf-assets\//],
      },
    }),
  ],
  build: { target: 'es2022', outDir: mode === 'native' ? 'dist-native' : 'dist' },
}));
