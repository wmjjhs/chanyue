# 版权所有：波哥
import copy
import json
import sys
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
from e2e import upload, close_import, assert_reader_layout
from reading_tools import open_tools, source
from backup_practice import open_backup, export, choose

ROOT = Path(__file__).resolve().parents[1]


def mode(page, value):
    open_tools(page)
    page.get_by_label('本书使用方式').select_option(value)
    if value == 'practice': expect(page.get_by_role('dialog', name='小段背诵')).to_be_visible()
    else: expect(page.get_by_role('dialog')).to_have_count(0)


def saved_state(page, title):
    return page.evaluate('''title=>new Promise((resolve,reject)=>{const r=indexedDB.open('chanyue-library');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['books','positions']);const b=tx.objectStore('books').getAll();b.onsuccess=()=>{const book=b.result.find(b=>b.title===title);const q=tx.objectStore('positions').get(book.id);q.onsuccess=()=>resolve({...book,...q.result});};tx.oncomplete=()=>db.close();};})''',title)


def run(context, engine, url):
    page=context.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url);page.wait_for_load_state('networkidle')
    paragraphs=['甲段文字。还有一句。','乙段承接。','丙段继续。','丁段结束。']
    upload(page,'固定段落.txt','\n'.join(paragraphs).encode());close_import(page)
    page.get_by_role('button',name='阅读《固定段落》',exact=True).click()
    original=source(page)
    mode(page,'practice')
    expect(page.locator('.practice-text')).to_have_text(paragraphs[0])
    page.get_by_role('button',name='下一段',exact=True).click();expect(page.locator('.practice-text')).to_have_text(paragraphs[1])
    page.get_by_role('button',name='连同前段练',exact=True).click()
    expect(page.get_by_label('练习段数')).to_have_value('2')
    expect(page.locator('.practice-sentence')).to_have_count(2)
    expect(page.locator('.practice-text')).to_contain_text(paragraphs[0])
    page.get_by_role('button',name='下一段',exact=True).click()
    expect(page.locator('.practice-text')).to_contain_text(paragraphs[2])
    page.get_by_role('button',name='全遮',exact=True).click()
    expect(page.get_by_role('button',name='结束练习，回到原处')).to_be_enabled()
    assert paragraphs[2] not in page.locator('.practice-text').inner_text()
    state=saved_state(page,'固定段落');assert state['practice']['span']==2 and state['practice']['mask']=='hidden'
    assert source(page)==original
    saved_source=state['practice']['source']
    for w,h in [(320,568),(844,390),(1440,900)]:
        page.set_viewport_size({'width':w,'height':h})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert saved_state(page,'固定段落')['practice']['source']==saved_source
    page.set_viewport_size({'width':390,'height':844})
    page.get_by_role('button',name='第1段，点击揭示',exact=True).click()
    expect(page.locator('.practice-text')).to_contain_text(paragraphs[2])
    page.get_by_role('button',name='结束练习，回到原处').click()
    page.get_by_role('button',name='返回书架').click();page.reload();page.wait_for_load_state('networkidle')
    page.get_by_role('button',name='阅读《固定段落》',exact=True).click()
    expect(page.get_by_role('dialog',name='小段背诵')).to_be_visible()
    expect(page.get_by_role('button',name='全遮',exact=True)).to_have_attribute('aria-pressed','true')
    assert paragraphs[2] not in page.locator('.practice-text').inner_text()
    assert saved_state(page,'固定段落')['practice']['source']==saved_source
    page.screenshot(path=str(ROOT/'artifacts'/f'fixed-practice-{engine}.png'))
    page.evaluate('''()=>{window.__statePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){if(this.name==='positions')throw new DOMException('full','QuotaExceededError');return window.__statePut.apply(this,a);};}''')
    page.get_by_role('button',name='看全文',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('尚未保存')
    page.keyboard.press('Escape');expect(page.get_by_role('dialog',name='小段背诵')).to_be_visible()
    assert saved_state(page,'固定段落')['practice']['mask']=='hidden'
    page.evaluate('()=>{IDBObjectStore.prototype.put=window.__statePut;}')
    page.get_by_role('button',name='重试保存练习').click();expect(page.get_by_role('alert')).to_have_count(0)
    expect(page.get_by_role('button',name='结束练习，回到原处')).to_be_enabled()
    page.get_by_role('button',name='结束练习，回到原处').click()
    mode(page,'reciting')
    expect(page.get_by_role('button',name='开始',exact=True)).to_be_visible()
    page.get_by_role('button',name='阅读设置',exact=True).click()
    page.locator('#font-size').fill('38')
    page.get_by_role('button',name='完成设置',exact=True).click()
    expect(page.locator('.reading-band')).to_have_css('font-size','38px')
    before=source(page);open_tools(page);page.get_by_role('button',name='收起操作区').click()
    expect(page.locator('.reader-header')).not_to_be_visible();expect(page.locator('.v2-controls')).not_to_be_visible()
    expect(page.get_by_role('button',name='显示操作区',exact=True)).to_be_in_viewport()
    assert source(page)==before
    page.screenshot(path=str(ROOT/'artifacts'/f'focus-{engine}.png'))
    for w,h in [(844,390),(320,568)]:
        page.set_viewport_size({'width':w,'height':h});expect(page.get_by_role('button',name='显示操作区',exact=True)).to_be_in_viewport()
        assert source(page)==before
    page.keyboard.press('Escape');expect(page.get_by_role('button',name='目录、搜索与书签')).to_be_focused()
    page.set_viewport_size({'width':390,'height':844});assert_reader_layout(page)
    page.get_by_role('button',name='开始',exact=True).click();page.wait_for_timeout(100)
    open_tools(page);page.get_by_role('button',name='收起操作区').click()
    starting=source(page);page.wait_for_timeout(450);assert source(page)>starting
    page.get_by_role('button',name='显示操作区',exact=True).click()
    page.get_by_role('button',name='停止',exact=True).click()
    page.get_by_role('button',name='返回书架').click()
    upload(page,'另一书.txt','其他正文不应继承本书偏好。'.encode());close_import(page)
    page.get_by_role('button',name='阅读《另一书》',exact=True).click()
    assert page.locator('.reading-band').evaluate('(e)=>getComputedStyle(e).fontSize')!='38px'
    page.get_by_role('button',name='返回书架').click()
    page.get_by_role('button',name='管理《固定段落》',exact=True).click()
    page.get_by_label('书籍名称',exact=True).fill('记住的书')
    page.get_by_role('button',name='保存书名',exact=True).click()
    page.get_by_role('button',name='阅读《记住的书》',exact=True).click()
    expect(page.locator('.reading-band')).to_have_css('font-size','38px')
    open_tools(page);expect(page.get_by_label('本书使用方式')).to_have_value('reciting')
    page.get_by_role('button',name='继续上次背诵',exact=True).click()
    assert saved_state(page,'记住的书')['practice']['source']==saved_source
    page.get_by_role('button',name='结束练习，回到原处').click();page.get_by_role('button',name='返回书架').click()
    open_backup(page);backup=export(page)
    entry=next(e for e in backup['books'] if e['book']['title']=='记住的书')
    assert entry['book']['practice']['source']==saved_source and entry['book']['readingPreference']['mode']=='practice'
    incoming=copy.deepcopy(backup);incoming['books']=[entry];entry['book']['title']='备份恢复练习'
    choose(page,incoming);page.get_by_role('button',name='确认恢复，不覆盖原书').click();expect(page.locator('.tools-notice')).to_contain_text('已新增 1 本')
    page.get_by_role('button',name='关闭弹窗').click()
    page.get_by_role('button',name='阅读《备份恢复练习》',exact=True).click()
    expect(page.get_by_role('dialog',name='小段背诵')).to_be_visible()
    assert saved_state(page,'备份恢复练习')['practice']['source']==saved_source
    page.get_by_role('button',name='结束练习，回到原处').click();page.get_by_role('button',name='返回书架').click()
    long='字'*4100+'终于结尾。'
    upload(page,'完整长段.txt',long.encode());close_import(page)
    page.get_by_role('button',name='阅读《完整长段》',exact=True).click();mode(page,'practice')
    parts=[]
    for i in range(3):
        parts.append(page.locator('.practice-text').inner_text())
        if i<2:page.get_by_role('button',name='下一段',exact=True).click();expect(page.get_by_role('button',name='结束练习，回到原处')).to_be_enabled()
    assert ''.join(parts)==long
    expect(page.get_by_role('button',name='下一段',exact=True)).to_be_disabled()
    page.get_by_role('button',name='结束练习，回到原处').click();page.get_by_role('button',name='返回书架').click()
    upload(page,'重试版本.txt','保存失败恢复后不应回滚方式。'.encode());close_import(page)
    page.evaluate('''()=>{window.__prefPut=IDBObjectStore.prototype.put;window.__failedPreference=false;IDBObjectStore.prototype.put=function(...a){if(this.name==='positions' && a[0].readingPreference && !window.__failedPreference){window.__failedPreference=true;throw new DOMException('full','QuotaExceededError');}return window.__prefPut.apply(this,a);};}''')
    page.get_by_role('button',name='阅读《重试版本》',exact=True).click()
    page.wait_for_function('window.__failedPreference')
    page.evaluate('()=>{IDBObjectStore.prototype.put=window.__prefPut;}')
    mode(page,'practice');expect(page.get_by_role('button',name='结束练习，回到原处')).to_be_enabled()
    page.get_by_role('button',name='结束练习，回到原处').click();page.get_by_role('button',name='返回书架').click()
    open_backup(page);snapshot=export(page)
    state=next(e['book'] for e in snapshot['books'] if e['book']['title']=='重试版本')
    assert state['readingPreference']['mode']=='practice' and state['practice']['source']==0
    assert saved_state(page,'重试版本')['readingPreference']['mode']=='practice'
    page.get_by_role('button',name='关闭弹窗').click();page.reload();page.wait_for_load_state('networkidle')
    page.get_by_role('button',name='阅读《重试版本》',exact=True).click();expect(page.get_by_role('dialog',name='小段背诵')).to_be_visible()
    assert not errors,errors
    print('PASS',engine,'fixed paragraphs, connect previous, complete long text, persisted/restarted/isolated/bookmarked preferences, backup roundtrip, failure retry, focus restore/resize/continue, no reading progress changes',flush=True)
    page.close()


def main():
    url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4175'
    with sync_playwright() as p:
        for engine,device in [(p.chromium,'Pixel 7'),(p.webkit,'iPhone 13')]:
            browser=engine.launch(headless=True);context=browser.new_context(**p.devices[device],service_workers='block')
            try:run(context,engine.name,url)
            finally:context.close();browser.close()
    (ROOT/'artifacts/practice-focus-result.json').write_text(json.dumps({'copyright':'版权所有：波哥','status':'passed','engines':['chromium','webkit']}),encoding='utf-8')


if __name__=='__main__':main()
