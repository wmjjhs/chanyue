# 版权所有：波哥
import json
import mimetypes
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import expect, sync_playwright
from e2e import upload, close_import, assert_reader_layout
from reading_tools import tools_docx, open_tools, source

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
APK = ROOT / f'artifacts/android/Chanyue-{VERSION}-android.apk'
MOCK = r'''
window.__calls = [];
window.__listeners = {};
window.__minimized = 0;
window.__holdWrite = false;
window.__pending = [];
const load = name => JSON.parse(localStorage.getItem(name) || '{}');
const store = (name, value) => localStorage.setItem(name, JSON.stringify(value));
window.androidBridge = { postMessage(raw) {
  const call = JSON.parse(raw), { pluginId, methodName, options = {}, callbackId } = call;
  window.__calls.push({ pluginId, methodName, directory: options.directory });
  const reply = (data = {}, error) => queueMicrotask(() => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: !error, data, error }));
  if (pluginId === 'App' && methodName === 'addListener') { window.__listeners[options.eventName] = call; return; }
  if (pluginId === 'App' && methodName === 'removeListener') { for (const [name, item] of Object.entries(window.__listeners)) if (item.callbackId === options.callbackId) delete window.__listeners[name]; reply(); return; }
  if (pluginId === 'App' && methodName === 'minimizeApp') { window.__minimized++; reply(); return; }
  if (pluginId === 'Preferences') {
    const prefs = load('mock-prefs');
    if (methodName === 'get') reply({ value: prefs[options.key] ?? null });
    else if (methodName === 'keys') reply({ keys: Object.keys(prefs) });
    else if (methodName === 'set') { prefs[options.key] = options.value; store('mock-prefs', prefs); reply(); }
    else if (methodName === 'remove') { delete prefs[options.key]; store('mock-prefs', prefs); reply(); }
    else reply({}, { message: 'Unsupported Preferences operation' });
    return;
  }
  if (pluginId === 'Filesystem') {
    if (options.directory !== 'LIBRARY') { reply({}, { message: 'Unexpected private directory' }); return; }
    const run = () => {
      const files = load('mock-files');
      if (methodName === 'mkdir') {
        if (localStorage.getItem('mock-directory')) { reply({}, { code: 'OS-PLUG-FILE-0010', message: 'Exists' }); return; }
        localStorage.setItem('mock-directory', 'true'); reply();
      } else if (methodName === 'readdir') reply({ files: Object.keys(files).filter(path => path.startsWith(options.path + '/')).map(path => ({ name: path.slice(options.path.length + 1), type: 'file' })) });
      else if (methodName === 'readFile') {
        if (!(options.path in files)) reply({}, { message: 'Missing file' }); else reply({ data: files[options.path] });
      } else if (methodName === 'writeFile') { files[options.path] = options.data; store('mock-files', files); reply(); }
      else if (methodName === 'deleteFile') { delete files[options.path]; store('mock-files', files); reply(); }
      else if (methodName === 'rename') {
        if (!(options.from in files) || options.to in files) { reply({}, { message: 'Invalid rename' }); return; }
        files[options.to] = files[options.from]; delete files[options.from]; store('mock-files', files); reply();
      } else reply({}, { message: 'Unsupported Filesystem operation' });
    };
    if (methodName === 'writeFile' && window.__holdWrite) window.__pending.push(run); else run();
    return;
  }
  reply();
} };
window.__androidBack = () => {
  const call = window.__listeners.backButton;
  if (!call) throw new Error('Android back listener missing');
  window.Capacitor.fromNative({ ...call, data: { canGoBack: false }, success: true, save: true });
};
'''
HEADERS = r'''
window.Capacitor.PluginHeaders = [
  { name: 'App', methods: ['addListener','removeListener','minimizeApp','getState'].map(name => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' })) },
  { name: 'Preferences', methods: ['get','set','remove','keys'].map(name => ({ name, rtype: 'promise' })) },
  { name: 'Filesystem', methods: ['mkdir','readdir','readFile','writeFile','rename','deleteFile'].map(name => ({ name, rtype: 'promise' })) }
];
'''


def back(page):
    page.evaluate('window.__androidBack()')


def main():
    with zipfile.ZipFile(APK) as apk, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(**p.devices['Pixel 7'], service_workers='block', offline=True)
        errors = []
        def resource(route):
            parsed = urlparse(route.request.url)
            name = 'assets/public/' + (unquote(parsed.path).lstrip('/') or 'index.html')
            if parsed.hostname != 'localhost' or '..' in name.split('/') or name not in apk.namelist():
                errors.append('Unexpected request: ' + route.request.url); route.abort(); return
            mime = {'.js':'application/javascript', '.mjs':'application/javascript', '.wasm':'application/wasm'}.get(Path(name).suffix)
            route.fulfill(body=apk.read(name), content_type=mime or mimetypes.guess_type(name)[0] or 'application/octet-stream')
        context.route('**/*', resource)
        context.add_init_script(MOCK + '\n' + apk.read('assets/native-bridge.js').decode('utf-8') + '\n' + HEADERS)
        page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto('https://localhost'); page.wait_for_load_state('networkidle')
            expect(page.get_by_role('button', name='阅读《山间的一日》', exact=True)).to_be_visible()
            assert page.evaluate('Capacitor.getPlatform()') == 'android'
            page.get_by_role('button', name='指南', exact=True).click()
            expect(page.get_by_role('dialog')).to_contain_text('Android 自动备份')
            back(page); expect(page.get_by_role('dialog')).to_have_count(0)
            upload(page, '安卓桥接.docx', tools_docx()); close_import(page)
            page.get_by_role('button', name='阅读《安卓桥接》', exact=True).click()
            page.get_by_role('button', name='开始', exact=True).click(); page.wait_for_timeout(350)
            open_tools(page, '书签·摘录'); original = source(page)
            page.get_by_role('button', name='摘录当前句').click()
            page.locator('#reading-note').fill('安卓返回保护草稿')
            back(page); expect(page.locator('.tools-discard')).to_be_visible()
            page.get_by_role('button', name='继续编辑').click()
            expect(page.locator('#reading-note')).to_have_value('安卓返回保护草稿')
            page.evaluate('window.__holdWrite = true')
            page.get_by_role('button', name='保存到本书').click()
            back(page); expect(page.locator('#reading-note')).to_be_visible()
            expect(page.locator('.tools-discard')).to_have_count(0)
            page.evaluate('()=>{window.__holdWrite=false;window.__pending.splice(0).forEach(run=>run());}')
            expect(page.locator('.tools-note')).to_have_count(1)
            back(page); expect(page.get_by_role('dialog')).to_have_count(0)
            back(page); expect(page.get_by_role('button', name='阅读《安卓桥接》', exact=True)).to_be_visible()
            assert page.evaluate('window.__minimized') == 0
            page.get_by_role('button', name='阅读《安卓桥接》', exact=True).click()
            assert abs(source(page) - original) < .01
            assert_reader_layout(page)
            page.screenshot(path=str(ROOT / 'artifacts/android/reader-pixel.png'))
            back(page)
            expect(page.get_by_role('button', name='阅读《安卓桥接》', exact=True)).to_be_visible()
            back(page)
            page.wait_for_function('window.__minimized === 1')
            page.reload(); page.wait_for_load_state('networkidle')
            page.get_by_role('button', name='阅读《安卓桥接》', exact=True).click()
            assert abs(source(page) - original) < .01
            open_tools(page, '书签·摘录')
            expect(page.locator('.tools-note')).to_contain_text('安卓返回保护草稿')
            calls = page.evaluate('window.__calls')
            assert any(c['pluginId'] == 'Filesystem' and c['methodName'] == 'readFile' for c in calls)
            assert all(c['directory'] == 'LIBRARY' for c in calls if c['pluginId'] == 'Filesystem')
            assert not errors, errors
            (ROOT / 'artifacts/android/bridge-test.json').write_text(json.dumps({'_copyright':'版权所有：波哥','status':'passed','apkAssets':True,'nativeBridgeScript':True,'javaPlugins':'mocked','realDevice':False}), encoding='utf-8')
            print('PASS APK assets + actual Capacitor Android JS bridge: mocked private Filesystem/Preferences, back hierarchy, draft/busy protection, restart persistence; NOT a real-device test', flush=True)
        finally:
            context.close(); browser.close()


if __name__ == '__main__':
    main()
