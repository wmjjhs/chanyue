// 版权所有：波哥
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.chanyue.reader',
  appName: '禅阅',
  webDir: 'dist-native',
  ios: {
    contentInset: 'never',
    backgroundColor: '#f7f7f2',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
