# 版权所有：波哥
import copy
import json
import sys
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
from e2e import upload, close_import, assert_reader_layout
from reading_tools import tools_docx, open_tools, source, saved_notes
from typography import library

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'artifacts'


def open_backup(page):
    page.get_by_role('button', name='备份与恢复', exact=True).click()
    expect(page.get_by_role('dialog', name='备份与恢复')).to_be_visible()


def choose(page, data):
    page.get_by_label('选择禅阅备份', exact=True).set_input_files({'name': 'backup.json', 'mimeType': 'application/json', 'buffer': json.dumps(data, ensure_ascii=False).encode()})
    expect(page.get_by_role('button', name='确认恢复，不覆盖原书', exact=True)).to_be_visible()


def export(page):
    page.get_by_role('button', name='导出当前书库', exact=True).click()
    link = page.get_by_role('link', name='保存备份文件', exact=True)
    expect(link).to_be_visible()
    data = page.evaluate('(url)=>fetch(url).then(r=>r.json())', link.get_attribute('href'))
    return data


def run(context, label, url):
    page = context.new_page(); errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url); page.wait_for_load_state('networkidle')
    text = '第一句。第二句带🌱。第三句！\n最后一句没有标点'
    upload(page, '逐句练习.txt', text.encode()); close_import(page)
    page.get_by_role('button', name='阅读《逐句练习》', exact=True).click()
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_label('按句推进，句末暂停').check()
    page.get_by_role('button', name='完成设置', exact=True).click()
    expect(page.get_by_role('button', name='回退一句', exact=True)).to_be_disabled()
    page.get_by_role('button', name='开始本句', exact=True).click()
    expect(page.get_by_role('button', name='开始本句', exact=True)).to_be_visible(timeout=10000)
    assert abs(source(page)-4) < .001, source(page)
    page.wait_for_timeout(500); assert abs(source(page)-4) < .001
    page.get_by_role('button', name='开始本句', exact=True).click()
    expect(page.get_by_role('button', name='开始本句', exact=True)).to_be_visible(timeout=10000)
    assert abs(source(page)-11) < .001, source(page)
    page.get_by_role('button', name='回退一句', exact=True).click(); assert abs(source(page)-4) < .001
    page.get_by_role('button', name='前进一句', exact=True).click(); assert abs(source(page)-11) < .001
    original = source(page)
    open_tools(page)
    page.get_by_role('button', name='从当前位置练习小段背诵', exact=True).click()
    expect(page.get_by_role('dialog', name='小段背诵')).to_be_visible()
    page.get_by_label('练习分段').select_option('sentence')
    expect(page.get_by_role('button', name='结束练习，回到原处')).to_be_enabled()
    for _ in range(2):
        page.get_by_role('button', name='下一段', exact=True).click()
        expect(page.get_by_role('button', name='结束练习，回到原处')).to_be_enabled()
    expect(page.locator('.practice-text')).to_contain_text('第三句！')
    page.get_by_role('button', name='全遮', exact=True).click()
    assert '第三句' not in page.locator('.practice-text').inner_text()
    assert '最后一句' not in page.locator('.practice-text').inner_text()
    page.get_by_role('button', name='第1段，点击揭示', exact=True).click()
    expect(page.locator('.practice-text')).to_contain_text('第三句！')
    assert '最后一句' not in page.locator('.practice-text').inner_text()
    page.get_by_role('button', name='第1段，点击重新遮住', exact=True).click()
    page.keyboard.press('Space'); page.keyboard.press('ArrowRight'); assert source(page) == original
    page.get_by_role('button', name='留句首', exact=True).click()
    expect(page.locator('.practice-text')).to_contain_text('第三＿！')
    page.screenshot(path=str(ART / f'practice-{label}.png'))
    for width, height in [(320,568),(844,390),(1440,900)]:
        page.set_viewport_size({'width':width,'height':height})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.get_by_role('button', name='结束练习，回到原处').scroll_into_view_if_needed()
        expect(page.get_by_role('button', name='结束练习，回到原处')).to_be_in_viewport()
    page.get_by_role('button', name='结束练习，回到原处').click(); assert source(page) == original
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_function('(()=>{const e=document.querySelector(".reading-band"),d=e.dataset;return Math.abs(Number(d.lineHeight)*Number(d.visibleLines)-e.getBoundingClientRect().height)<1;})()')
    assert_reader_layout(page)
    page.get_by_role('button', name='前进一句', exact=True).click()
    page.get_by_role('button', name='开始本句', exact=True).click()
    expect(page.get_by_role('button', name='重新阅读', exact=True)).to_be_visible(timeout=15000)
    page.get_by_role('button', name='回退一句', exact=True).click()
    expect(page.get_by_role('button', name='开始本句', exact=True)).to_be_visible()
    assert source(page) == len(text[:text.index('最后')].encode('utf-16-le')) // 2
    page.get_by_role('button', name='返回书架', exact=True).click()
    upload(page, '备份格式.docx', tools_docx()); close_import(page)
    page.get_by_role('button', name='阅读《备份格式》', exact=True).click()
    open_tools(page, '书签·摘录')
    page.get_by_role('button', name='记住当前位置', exact=True).click()
    page.locator('#reading-note').fill('备份备注 <script>不能执行</script>')
    page.get_by_role('button', name='保存到本书', exact=True).click(); expect(page.locator('.tools-note')).to_have_count(1)
    page.get_by_role('button', name='关闭弹窗').click(); page.get_by_role('button', name='返回书架').click()
    open_backup(page); backup = export(page)
    assert next(item for item in backup['books'] if item['book']['title'] == '逐句练习')['book']['readingPreference']['sentenceMode'] is True
    assert backup['settings']['sentenceMode'] is False
    entry = next(item for item in backup['books'] if item['book']['title'] == '备份格式')
    assert entry['book']['typography'] and entry['book']['contents'] and len(entry['notes']) == 1
    with page.expect_download() as download:
        page.get_by_role('link', name='保存备份文件').click()
    assert json.loads(Path(download.value.path()).read_text(encoding='utf-8')) == backup
    before = library(page)
    choose(page, backup); page.get_by_role('button', name='确认恢复，不覆盖原书').click()
    expect(page.locator('.tools-notice')).to_contain_text('已新增 0 本')
    assert library(page) == before
    altered = copy.deepcopy(backup); altered['books'] = [copy.deepcopy(entry)]
    altered['books'][0]['book']['character'] = 5.25
    altered['books'][0]['notes'][0]['note'] = '旧备份笔记，不覆盖现有笔记'
    choose(page, altered); page.get_by_role('button', name='确认恢复，不覆盖原书').click()
    expect(page.locator('.tools-notice')).to_contain_text('已新增 1 本')
    assert len(library(page)) == len(before)+1
    assert saved_notes(page, entry['book']['id']) == entry['notes']
    choose(page, altered); page.get_by_role('button', name='确认恢复，不覆盖原书').click()
    expect(page.locator('.tools-notice')).to_contain_text('已新增 0 本')
    for bad in [{'format':'chanyue-backup','version':999}, {'__proto__': {'polluted':True}}]:
        page.get_by_label('选择禅阅备份', exact=True).set_input_files({'name':'bad.json','mimeType':'application/json','buffer':json.dumps(bad).encode()})
        expect(page.get_by_role('alert')).to_be_visible()
        assert len(library(page)) == len(before)+1
    fail = copy.deepcopy(altered); fail['books'][0]['book']['title'] = '事务失败不留下半本书'
    choose(page, fail)
    page.evaluate('''()=>{window.__backupPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...a){if(this.name==='notes')throw new DOMException('disk full','QuotaExceededError');return window.__backupPut.apply(this,a);};}''')
    page.get_by_role('button', name='确认恢复，不覆盖原书').click(); expect(page.get_by_role('alert')).to_be_visible()
    assert len(library(page)) == len(before)+1
    page.evaluate('()=>{IDBObjectStore.prototype.put=window.__backupPut;}')
    page.get_by_role('button', name='确认恢复，不覆盖原书').click(); expect(page.locator('.tools-notice')).to_contain_text('已新增 1 本')
    page.screenshot(path=str(ART / f'backup-{label}.png'))
    page.get_by_role('button', name='关闭弹窗').click()
    page.reload(); page.wait_for_load_state('networkidle')
    open_backup(page); restored = export(page)
    assert len(restored['books']) == len(before)+2
    assert next(item for item in restored['books'] if item['book']['title']=='事务失败不留下半本书')['book']['character'] == 5.25
    assert not errors, errors
    print('PASS',label,'sentence stop/back/end, recitation masking/reveal/no progress changes, real backup download, full data, duplicate/conflicting restore, malformed backup rejection, IDB rollback/retry/reload',flush=True)
    page.close()


def main():
    url = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4175'
    with sync_playwright() as p:
        for engine, device in [(p.chromium,'Pixel 7'),(p.webkit,'iPhone 13')]:
            browser=engine.launch(headless=True); context=browser.new_context(**p.devices[device],service_workers='block',accept_downloads=True)
            try: run(context,engine.name,url)
            finally: context.close();browser.close()
    (ART/'backup-practice-result.json').write_text(json.dumps({'copyright':'版权所有：波哥','status':'passed','engines':['chromium','webkit']}),encoding='utf-8')


if __name__=='__main__':main()
