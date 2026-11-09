# 版权所有：波哥
import copy
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import expect, sync_playwright
from android_bridge import MOCK, HEADERS, back
from backup_practice import choose, open_backup
from e2e import upload, close_import
from reading_tools import open_tools, source

ROOT = Path(__file__).resolve().parents[1]
CACHE = r'''
  if (pluginId === 'Share') {
    if (window.__cancelShare) { reply({}, { message: '分享已取消' }); return; }
    if (!Array.isArray(options.files) || options.files[0] !== 'file:///cache/chanyue-library-backup.json') { reply({}, { message: 'Unexpected shared path' }); return; }
    window.__shared = JSON.parse(localStorage.getItem('mock-cache'));
    reply({ activityType: 'test' }); return;
  }
  if (pluginId === 'Filesystem' && options.directory === 'CACHE') {
    if (methodName === 'writeFile') { localStorage.setItem('mock-cache', options.data); reply({ uri: 'file:///cache/chanyue-library-backup.json' }); }
    else if (methodName === 'readFile') reply({ data: localStorage.getItem('mock-cache') });
    else reply({}, { message: 'Unsupported cache operation' });
    return;
  }
'''


def main():
    bundle = (ROOT / 'dist-native').resolve()
    script = (ROOT / 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js').read_text(encoding='utf-8')
    mock = MOCK.replace("  if (pluginId === 'Preferences') {", CACHE + "  if (pluginId === 'Preferences') {")
    headers = HEADERS.replace("window.Capacitor.PluginHeaders = [", "window.Capacitor.PluginHeaders = [{name:'Share',methods:[{name:'share',rtype:'promise'}]},")
    with sync_playwright() as p:
        for engine, device in [(p.chromium,'Pixel 7'), (p.webkit,'iPhone 13')]:
            browser = engine.launch(headless=True)
            context = browser.new_context(**p.devices[device], service_workers='block')
            errors = []
            def resource(route):
                parsed = urlparse(route.request.url)
                path = (bundle / (unquote(parsed.path).lstrip('/') or 'index.html')).resolve()
                if parsed.hostname != 'localhost' or not path.is_relative_to(bundle) or not path.is_file():
                    errors.append(route.request.url); route.abort(); return
                content_type = {'.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm'}.get(path.suffix)
                route.fulfill(body=path.read_bytes(), content_type=content_type or mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
            context.route('**/*', resource)
            context.add_init_script(mock + '\n' + script + '\n' + headers)
            page=context.new_page(); page.on('pageerror',lambda error:errors.append(str(error)))
            try:
                page.goto('https://localhost'); page.wait_for_load_state('networkidle')
                upload(page,'备份桥接.txt','第一句。第二句。第三句。'.encode()); close_import(page)
                page.get_by_role('button',name='阅读《备份桥接》',exact=True).click()
                page.get_by_role('button',name='阅读设置',exact=True).click(); page.get_by_label('按句推进，句末暂停').check()
                page.get_by_role('button',name='完成设置',exact=True).click()
                page.get_by_role('button',name='前进一句',exact=True).click(); original=source(page)
                open_tools(page,'书签·摘录');page.get_by_role('button',name='记住当前位置').click()
                page.locator('#reading-note').fill('原生备份记录');page.get_by_role('button',name='保存到本书').click();expect(page.locator('.tools-note')).to_have_count(1)
                back(page);back(page);expect(page.get_by_role('button',name='阅读《备份桥接》',exact=True)).to_be_visible()
                open_backup(page);page.get_by_role('button',name='导出当前书库').click()
                expect(page.locator('.tools-notice')).to_contain_text('请确认备份已保存')
                backup=page.evaluate('window.__shared');entry=next(x for x in backup['books'] if x['book']['title']=='备份桥接')
                assert entry['book']['character']==original and entry['notes'][0]['note']=='原生备份记录'
                choose(page,backup);page.get_by_role('button',name='确认恢复，不覆盖原书').click();expect(page.locator('.tools-notice')).to_contain_text('已新增 0 本')
                incoming=copy.deepcopy(backup);incoming['books']=[copy.deepcopy(entry)];incoming['books'][0]['book']['title']='恢复副本';incoming['books'][0]['book']['character']=5.25
                choose(page,incoming);page.evaluate('window.__holdWrite=true')
                page.get_by_role('button',name='确认恢复，不覆盖原书').click();back(page);expect(page.get_by_role('dialog',name='备份与恢复')).to_be_visible()
                page.wait_for_function('window.__pending.length>0');page.evaluate('()=>{window.__holdWrite=false;window.__pending.splice(0).forEach(f=>f());}')
                expect(page.locator('.tools-notice')).to_contain_text('已新增 1 本')
                page.evaluate('window.__cancelShare=true');page.get_by_role('button',name='导出当前书库').click();expect(page.get_by_role('alert')).to_contain_text('分享已取消')
                assert page.locator('.tools-notice').count()==0
                back(page);page.reload();page.wait_for_load_state('networkidle')
                page.get_by_role('button',name='阅读《恢复副本》',exact=True).click();assert abs(source(page)-5.25)<.001
                open_tools(page,'书签·摘录');expect(page.locator('.tools-note')).to_contain_text('原生备份记录')
                page.get_by_role('button',name='从当前位置练习小段背诵').click();page.get_by_role('button',name='全遮',exact=True).click()
                expect(page.locator('.reading-workspace')).not_to_be_visible()
                expect(page.get_by_role('button',name='结束练习，回到原处')).to_be_enabled();back(page)
                assert abs(source(page)-5.25)<.001;expect(page.locator('.reading-workspace')).to_be_visible()
                open_tools(page);page.get_by_role('button',name='收起操作区').click()
                expect(page.locator('.reader-header')).not_to_be_visible();back(page)
                expect(page.get_by_role('button',name='返回书架')).to_be_visible()
                assert abs(source(page)-5.25)<.001
                back(page);expect(page.get_by_role('button',name='阅读《恢复副本》',exact=True)).to_be_visible()
                page.reload();page.wait_for_load_state('networkidle')
                page.get_by_role('button',name='阅读《恢复副本》',exact=True).click()
                expect(page.get_by_role('dialog',name='小段背诵')).to_be_visible()
                expect(page.get_by_role('button',name='全遮',exact=True)).to_have_attribute('aria-pressed','true')
                assert abs(source(page)-5.25)<.001
                back(page);open_tools(page);page.get_by_label('本书使用方式').select_option('reciting')
                expect(page.get_by_role('dialog')).to_have_count(0)
                expect(page.get_by_role('button',name='开始',exact=True)).to_be_visible()
                back(page);expect(page.get_by_role('button',name='阅读《恢复副本》',exact=True)).to_be_visible()
                page.reload();page.wait_for_load_state('networkidle')
                page.get_by_role('button',name='阅读《恢复副本》',exact=True).click()
                expect(page.get_by_role('dialog')).to_have_count(0)
                expect(page.get_by_role('button',name='开始',exact=True)).to_be_visible()
                assert not errors,errors
                print('PASS',engine.name,'bundled resources + Android JS bridge, mocked native file backup/share/cancel, busy back guard, restore + restart + sentence preference + notes, practice isolation (not device test)',flush=True)
            finally:context.close();browser.close()
    (ROOT/'artifacts/native-backup-result.json').write_text(json.dumps({'copyright':'版权所有：波哥','status':'passed','nativePlugins':'mocked','engines':['chromium','webkit']}),encoding='utf-8')


if __name__=='__main__':main()
