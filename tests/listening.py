# 版权所有：波哥
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import expect, sync_playwright
from android_bridge import MOCK, HEADERS, back
from e2e import upload, close_import
from reading_tools import open_tools, source

ROOT = Path(__file__).resolve().parents[1]
TTS = r'''
  if (pluginId === 'Preferences' && methodName === 'set' && options.value.includes('"listening"')) {
    if (window.__failListening) { reply({}, {message:'disk full'}); return; }
    if (window.__holdListening) {
      window.__releaseListening = () => { const prefs=load('mock-prefs');prefs[options.key]=options.value;store('mock-prefs',prefs);reply(); };
      return;
    }
  }
  if (pluginId === 'SystemSpeech') {
    window.__utterances ??= [];
    if (methodName === 'prepare') { reply({ available: !window.__noVoice }); return; }
    if (methodName === 'addListener') { window.__ttsListener = call; return; }
    if (methodName === 'removeListener') { if (window.__ttsListener?.callbackId === options.callbackId) window.__ttsListener = null; reply(); return; }
    if (methodName === 'stop') { window.__ttsStop?.(); window.__ttsStop = null; reply(); return; }
    if (methodName === 'speak') {
      window.__utterances.push({text:options.text,rate:options.rate});
      window.__ttsStop = () => reply({}, {message:'已暂停'});
      window.__ttsStart = (seconds) => { const listener=window.__ttsListener; if(listener) window.Capacitor.fromNative({...listener,data:{id:options.id,duration:seconds},success:true,save:true}); };
      window.__ttsDone = () => { window.__ttsStop=null; reply(); };
      return;
    }
    reply({}, {message:'Unsupported TTS method'}); return;
  }
'''


def main():
    bundle = (ROOT / 'dist-native').resolve()
    bridge = (ROOT / 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js').read_text(encoding='utf-8')
    headers = HEADERS.replace('window.Capacitor.PluginHeaders = [', "window.Capacitor.PluginHeaders = [{name:'SystemSpeech',methods:[{name:'prepare',rtype:'promise'},{name:'speak',rtype:'promise'},{name:'stop',rtype:'promise'},{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]},")
    with sync_playwright() as p:
        for name in ['chromium', 'webkit']:
            browser = getattr(p, name).launch(headless=True)
            context = browser.new_context(viewport={'width':390,'height':844}, service_workers='block')
            errors = []
            def route(request):
                parsed=urlparse(request.request.url)
                path=(bundle/(unquote(parsed.path).lstrip('/') or 'index.html')).resolve()
                if parsed.hostname!='localhost' or not path.is_relative_to(bundle) or not path.is_file():
                    errors.append('Unexpected network request'); request.abort(); return
                mime={'.js':'application/javascript','.mjs':'application/javascript'}.get(path.suffix)
                request.fulfill(body=path.read_bytes(),content_type=mime or mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
            context.route('**/*',route)
            context.add_init_script(MOCK.replace("  if (pluginId === 'Preferences') {",TTS+"  if (pluginId === 'Preferences') {")+'\n'+bridge+'\n'+headers)
            page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
            try:
                page.goto('https://localhost');page.wait_for_load_state('networkidle')
                upload(page,'听书样例.txt','第一句。第二句。第三句。'.encode());close_import(page)
                page.get_by_role('button',name='阅读《听书样例》',exact=True).click()
                reading=source(page)
                reading_cursor=page.locator('.scan-cursor').evaluate('(e)=>[getComputedStyle(e).height,getComputedStyle(e).backgroundColor]')
                open_tools(page);page.get_by_label('本书使用方式').select_option('listening')
                expect(page.get_by_role('button',name='开始听书',exact=True)).to_be_visible()
                page.evaluate('window.__noVoice=true');page.get_by_role('button',name='开始听书',exact=True).click()
                expect(page.get_by_role('alert')).to_contain_text('中文语音')
                assert page.evaluate('(window.__utterances||[]).length')==0
                page.evaluate('window.__noVoice=false');page.get_by_role('button',name='重试听书',exact=True).click()
                page.wait_for_function('window.__utterances.length===1')
                expect(page.locator('.page-navigation > span').first).to_contain_text('准备')
                page.evaluate('''window.__samples=[];(function sample(){const b=document.querySelector('.reading-band');if(b){const p=parseFloat(b.dataset.position);if(Number.isFinite(p))window.__samples.push(p);}requestAnimationFrame(sample);})();''')
                page.evaluate('window.__ttsStart(1.2)');expect(page.locator('.page-navigation > span').first).to_contain_text('按句同步')
                first=source(page);page.wait_for_timeout(250);assert source(page)==first
                assert page.locator('.is-spoken-sentence').count()==0
                cursor=page.locator('.scan-cursor');expect(cursor).to_be_visible()
                assert cursor.evaluate('(e)=>[getComputedStyle(e).height,getComputedStyle(e).backgroundColor]')==reading_cursor
                before=cursor.evaluate('e=>e.style.transform');page.wait_for_timeout(120)
                assert cursor.evaluate('e=>e.style.transform')!=before
                position_before=float(page.locator('.reading-band').get_attribute('data-position'))
                page.evaluate('window.__ttsDone()');page.wait_for_function('window.__utterances.length===2')
                boundary=float(page.locator('.reading-band').get_attribute('data-position'))
                assert boundary>=position_before
                page.wait_for_timeout(120)
                assert float(page.locator('.reading-band').get_attribute('data-position'))==boundary
                expect(page.locator('.reading-band')).to_have_attribute('data-source','4')
                assert page.evaluate('window.__utterances[1].text')=='第二句。'
                page.evaluate('window.__ttsStart(1.2)');page.wait_for_timeout(200)
                assert float(page.locator('.reading-band').get_attribute('data-position'))>=boundary
                samples=page.evaluate('window.__samples')
                steps=[b-a for a,b in zip(samples,samples[1:])]
                assert len(steps)>10,(len(steps),samples)
                assert min(steps)>=-1e-9,('位置回退',min(steps))
                assert max(steps)<0.5,('句界突跳',max(steps),samples)
                page.get_by_role('button',name='暂停听书',exact=True).click()
                page.evaluate('window.__ttsStart();window.__ttsDone()');page.wait_for_timeout(100)
                assert source(page)==4 and page.evaluate('window.__utterances.length')==2
                page.get_by_role('button',name='开始听书',exact=True).click();page.wait_for_function('window.__utterances.length===3')
                assert page.evaluate('window.__utterances[2].text')=='第二句。'
                page.get_by_role('button',name='前进一句',exact=True).click()
                expect(page.locator('.reading-band')).to_have_attribute('data-source','8')
                open_tools(page);page.get_by_label('听书语速').select_option('1.5')
                expect(page.get_by_label('听书语速')).to_have_value('1.5')
                page.get_by_role('button',name='关闭弹窗',exact=True).click()
                page.get_by_role('button',name='开始听书',exact=True).click();page.wait_for_function('window.__utterances.length===4')
                assert page.evaluate('window.__utterances[3].rate')==1.5
                page.evaluate('window.__ttsStart()')
                page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(200)
                assert page.evaluate('window.__utterances.length')==4 and source(page)==8
                open_tools(page);page.get_by_role('button',name='收起操作区',exact=True).click()
                page.wait_for_function('window.__utterances.length===5')
                expect(page.locator('.reader-header')).not_to_be_visible()
                back(page);expect(page.locator('.reader-header')).to_be_visible()
                page.evaluate('window.__ttsDone()');expect(page.get_by_role('button',name='重新听书',exact=True)).to_be_visible()
                page.get_by_role('button',name='回退一句',exact=True).click();expect(page.locator('.reading-band')).to_have_attribute('data-source','8')
                page.get_by_role('button',name='开始听书',exact=True).click();page.wait_for_function('window.__utterances.length===6')
                page.evaluate("window.dispatchEvent(new Event('pagehide'))")
                expect(page.get_by_role('button',name='开始听书',exact=True)).to_be_visible()
                page.get_by_role('button',name='返回书架',exact=True).click()
                page.reload();page.wait_for_load_state('networkidle')
                page.get_by_role('button',name='阅读《听书样例》',exact=True).click()
                expect(page.get_by_role('button',name='开始听书',exact=True)).to_be_visible();assert source(page)==8
                open_tools(page);expect(page.get_by_label('听书语速')).to_have_value('1.5')
                page.get_by_label('本书使用方式').select_option('reading')
                expect(page.get_by_role('button',name='开始',exact=True)).to_be_visible();assert source(page)==reading
                page.get_by_role('button',name='返回书架',exact=True).click()
                page.get_by_role('button',name='阅读《山间的一日》',exact=True).click()
                expect(page.get_by_role('button',name='开始',exact=True)).to_be_visible()
                page.get_by_role('button',name='返回书架',exact=True).click()
                page.get_by_role('button',name='阅读《听书样例》',exact=True).click()
                open_tools(page);page.get_by_label('本书使用方式').select_option('listening')
                expect(page.get_by_role('button',name='开始听书',exact=True)).to_be_visible()
                page.evaluate('window.__holdListening=true')
                page.get_by_role('button',name='回退一句',exact=True).click()
                page.wait_for_function('!!window.__releaseListening');assert source(page)==4
                page.get_by_role('button',name='返回书架',exact=True).click()
                page.get_by_role('button',name='阅读《听书样例》',exact=True).click()
                expect(page.get_by_role('button',name='开始听书',exact=True)).to_be_visible();assert source(page)==4
                page.get_by_role('button',name='阅读设置',exact=True).click()
                page.get_by_role('slider',name='字体大小').fill('40')
                page.evaluate('window.__holdListening=false;window.__releaseListening()')
                page.wait_for_timeout(200);expect(page.get_by_role('slider',name='字体大小')).to_have_value('40')
                page.get_by_role('button',name='完成设置',exact=True).click()
                page.evaluate('window.__failListening=true')
                page.get_by_role('button',name='前进一句',exact=True).click()
                expect(page.locator('.listening-error')).to_contain_text('尚未保存')
                page.get_by_role('button',name='返回书架',exact=True).click()
                page.get_by_role('button',name='备份与恢复',exact=True).click()
                expect(page.get_by_role('dialog')).to_be_visible()
                page.get_by_role('button',name='导出当前书库',exact=True).click()
                expect(page.get_by_role('dialog')).to_contain_text('尚未保存')
                page.get_by_role('button',name='关闭弹窗',exact=True).click()
                page.evaluate('window.__failListening=false')
                page.get_by_role('button',name='阅读《听书样例》',exact=True).click()
                expect(page.get_by_role('button',name='开始听书',exact=True)).to_be_visible();assert source(page)==8
                page.get_by_role('button',name='开始听书',exact=True).click()
                page.wait_for_function('window.__utterances.length>=1')
                page.get_by_role('button',name='暂停听书',exact=True).click()
                assert not errors,errors
                print('PASS',name,'sentence callbacks, pause/replay, skip, rate, focus, rotation, completion, background, restart, independent progress; mock TTS not real voice')
            finally: context.close();browser.close()


if __name__=='__main__':
    main()
