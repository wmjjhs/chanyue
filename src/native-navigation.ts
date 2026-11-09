// 版权所有：波哥
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export function routeAndroidBack(doc: Pick<Document, 'querySelectorAll'>, target: Pick<Window, 'dispatchEvent'>, minimize: () => void) {
  const dialogs = doc.querySelectorAll<HTMLDialogElement>('dialog[open]');
  const dialog = dialogs[dialogs.length - 1];
  if (dialog) {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    return;
  }
  if (target.dispatchEvent(new Event('chanyue-back', { cancelable: true }))) minimize();
}

export function listenForAndroidBack() {
  if (Capacitor.getPlatform() !== 'android') return () => {};
  let active = true;
  const listener = NativeApp.addListener('backButton', () => {
    if (active) routeAndroidBack(document, window, () => { void NativeApp.minimizeApp().catch(() => {}); });
  }).catch(() => null);
  return () => { active = false; void listener.then(handle => handle?.remove()).catch(() => {}); };
}
