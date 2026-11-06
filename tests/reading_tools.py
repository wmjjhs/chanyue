# 版权所有：波哥
import io
import json
import mimetypes
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright, expect
from e2e import upload, close_import, assert_reader_layout
from typography import styled_docx, library, NS

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts'
TITLE = '阅读工具样例'


def tools_docx():
    source = zipfile.ZipFile(io.BytesIO(styled_docx()))
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in source.namelist():
            data = source.read(name)
            if name == 'word/document.xml':
                text = data.decode()
                extra = '<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>第二章 寻找重点</w:t></w:r></w:p><w:p><w:r><w:t>搜索锚点 TEST test 🌱原文摘录。</w:t></w:r></w:p>'
                extra += '<w:p><w:r><w:rPr><w:sz w:val="70"/><w:b/></w:rPr><w:t>大字并非目录</w:t></w:r></w:p>'
                extra += '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 看见重点</w:t></w:r></w:p>'
                extra += '<w:p><w:r><w:t>最后一段很长，确保目录与搜索跳转后可以继续读几秒钟。</w:t></w:r></w:p>' * 10
                data = text.replace('</w:body>', extra + '</w:body>').encode()
            archive.writestr(name, data)
    return output.getvalue()


def outline_pdf():
    first = b'BT /F1 12 Tf 60 750 Td (First page text.) Tj ET'
    second = b'BT /F1 12 Tf 60 750 Td (Second page searchable target.) Tj ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R >>', b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 10 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length ' + str(len(first)).encode() + b' >>\nstream\n' + first + b'\nendstream', b'<< /Type /Outlines /First 8 0 R /Last 9 0 R /Count 2 >>', b'<< /Title (Chapter One) /Parent 7 0 R /Next 9 0 R /Dest [3 0 R /Fit] >>', b'<< /Title (Chapter Two) /Parent 7 0 R /Prev 8 0 R /Dest [4 0 R /XYZ null 750 null] >>', b'<< /Length ' + str(len(second)).encode() + b' >>\nstream\n' + second + b'\nendstream']
    data, offsets = b'%PDF-1.4\n', [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data)); data += f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(data); data += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
    for offset in offsets[1:]:
        data += f'{offset:010d} 00000 n \n'.encode()
    return data + f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()


def source(page):
    return float(page.locator('.reading-band').get_attribute('data-source'))


def open_tools(page, tab=None):
    page.get_by_role('button', name='目录、搜索与书签', exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    if tab:
        page.get_by_role('tab', name=tab, exact=True).click()


def saved_notes(page, book_id):
    return page.evaluate('''id=>new Promise(resolve=>{const r=indexedDB.open('chanyue-library');r.onsuccess=()=>{const db=r.result,g=db.transaction('notes').objectStore('notes').get(id);g.onsuccess=()=>{db.close();resolve(g.result||[]);};};})''', book_id)


def assert_tools(page, label):
    upload(page, TITLE + '.docx', tools_docx()); close_import(page)
    book = next(b for b in library(page) if b['title'] == TITLE)
    assert len(book['contents']) == 3, book.get('contents')
    assert book['contents'][1]['level'] == 2 and book['contents'][2]['source'] > book['contents'][0]['source']
    text = '\n'.join(book['lines'])
    target = len(text.split('第二章')[0].encode('utf-16-le')) // 2
    assert book['contents'][1]['source'] == target
    page.get_by_role('button', name=f'阅读《{TITLE}》', exact=True).click()
    assert_reader_layout(page)
    assert page.locator('.reader-controls button').count() == 3
    assert page.locator('.reader-header button').count() == 3
    band_box = page.locator('.reading-band').bounding_box()
    page.get_by_role('button', name='开始', exact=True).click(); page.wait_for_timeout(500)
    open_tools(page)
    start = source(page); page.wait_for_timeout(200); assert source(page) == start
    expect(page.get_by_role('tab', name='目录', exact=True)).to_have_attribute('aria-selected', 'true')
    expect(page.locator('.tools-list li')).to_have_count(3)
    page.screenshot(path=str(ARTIFACTS / f'tools-{label}-contents.png'))
    page.get_by_role('button', name='第二章 寻找重点', exact=False).click()
    assert source(page) == target
    expect(page.get_by_role('button', name='开始', exact=True)).to_be_visible()
    page.get_by_role('button', name='返回刚才的阅读位置').click()
    assert abs(source(page) - start) < .01
    open_tools(page, '搜索')
    page.locator('#book-search').fill('TEST')
    expect(page.locator('.search-result')).to_have_count(2)
    page.locator('.search-result').first.click()
    assert abs(source(page) - len(text.split('TEST')[0].encode('utf-16-le')) // 2) < .01
    page.get_by_role('button', name='返回刚才的阅读位置').click()
    assert source(page) == start
    open_tools(page, '搜索')
    page.locator('#book-search').fill('没有这个关键词'); expect(page.locator('.tools-panel')).to_contain_text('没有找到')
    page.locator('#book-search').fill('<img src=x onerror=alert(1)>'); expect(page.locator('.search-result')).to_have_count(1)
    assert page.locator('.tools-panel img,.tools-panel script').count() == 0
    page.locator('#book-search').fill('搜索锚点'); expect(page.locator('.search-result')).to_have_count(1)
    page.get_by_role('button', name='摘录匹配文字').click()
    expect(page.locator('.tools-quote')).to_have_text('搜索锚点')
    page.locator('#reading-note').fill('<img onerror=alert(1)> 一条备注')
    page.get_by_role('button', name='保存到本书').click()
    expect(page.locator('.tools-note')).to_have_count(1)
    assert source(page) == start
    page.get_by_role('button', name='记住当前位置').click()
    page.locator('#reading-note').fill('记住这里')
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(2)
    notes = saved_notes(page, book['id']); assert len(notes) == 2
    bookmark = next(n for n in notes if n['kind'] == 'bookmark'); excerpt = next(n for n in notes if n['kind'] == 'excerpt')
    assert abs(bookmark['start'] - start) < .01 and excerpt['quote'] == '搜索锚点'
    page.get_by_role('button', name='记住当前位置').click()
    expect(page.locator('#reading-note')).to_have_value('记住这里')
    page.locator('#reading-note').fill('改过备注')
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(2)
    page.get_by_role('button', name='摘录当前句').click()
    expect(page.locator('#excerpt-context')).not_to_be_visible()
    page.locator('.tools-selection summary').click()
    page.locator('#excerpt-context').evaluate('(e)=>{e.focus();e.setSelectionRange(0,3);}')
    page.get_by_role('button', name='使用选中文字').click()
    expect(page.locator('.tools-quote')).to_have_text('第一章')
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(3)
    page.get_by_role('button', name='摘录当前句').click(); page.locator('#reading-note').fill('不保存的编辑')
    page.get_by_role('button', name='关闭弹窗').click()
    expect(page.get_by_role('button', name='继续编辑')).to_be_visible()
    page.get_by_role('button', name='继续编辑').click(); expect(page.locator('#reading-note')).to_have_value('不保存的编辑')
    page.get_by_role('button', name='关闭弹窗').click(); page.get_by_role('button', name='放弃并关闭').click()
    assert len(saved_notes(page, book['id'])) == 3
    assert abs(page.locator('.reading-band').bounding_box()['height'] - band_box['height']) < 1
    open_tools(page, '书签·摘录')
    page.screenshot(path=str(ARTIFACTS / f'tools-{label}-notes.png'))
    assert page.locator('.tools-panel img,.tools-panel script').count() == 0
    page.get_by_role('button', name='删除', exact=True).first.click()
    page.get_by_role('button', name='取消', exact=True).click(); expect(page.locator('.tools-note')).to_have_count(3)
    page.get_by_role('button', name='删除', exact=True).first.click()
    page.get_by_role('button', name='确认删除', exact=True).click(); expect(page.locator('.tools-note')).to_have_count(2)
    page.get_by_role('button', name='关闭弹窗').click()
    page.reload(); page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='继续阅读', exact=True).click()
    assert abs(source(page) - start) < .01
    open_tools(page, '书签·摘录'); expect(page.locator('.tools-note')).to_have_count(2)
    page.locator('.tools-note .tools-result').last.click(); expect(page.get_by_role('button', name='开始', exact=True)).to_be_visible()
    page.get_by_role('button', name='返回刚才的阅读位置').click(); assert abs(source(page) - start) < .01
    page.get_by_role('button', name='返回书架').click()
    page.evaluate('''id=>new Promise(resolve=>{const r=indexedDB.open('chanyue-library');r.onsuccess=()=>{const db=r.result,tx=db.transaction('books','readwrite'),s=tx.objectStore('books'),g=s.get(id);g.onsuccess=()=>{const b=g.result;delete b.contents;b.title='保留改名';s.put(b);};tx.oncomplete=()=>{db.close();resolve();};};})''', book['id'])
    page.reload(); page.wait_for_load_state('networkidle')
    count = len(library(page)); upload(page, TITLE + '.docx', tools_docx()); expect(page.locator('.import-results')).to_contain_text('阅读进度保持不变'); close_import(page)
    assert len(library(page)) == count and len(saved_notes(page, book['id'])) == 2
    updated = next(b for b in library(page) if b['id'] == book['id']); assert updated['title'] == '保留改名' and len(updated['contents']) == 3
    upload(page, '目录PDF.pdf', outline_pdf()); close_import(page)
    pdf = next(b for b in library(page) if b['title'] == '目录PDF')
    assert [x['title'] for x in pdf['contents']] == ['Chapter One', 'Chapter Two'], pdf['contents']
    page.get_by_role('button', name='阅读《目录PDF》', exact=True).click(); open_tools(page)
    page.get_by_role('button', name='Chapter Two', exact=False).click()
    assert source(page) == pdf['contents'][1]['source']
    open_tools(page, '书签·摘录'); expect(page.locator('.tools-note')).to_have_count(0); page.get_by_role('button', name='关闭弹窗').click()
    page.get_by_role('button', name='返回书架').click()
    page.get_by_role('button', name='管理《保留改名》', exact=True).click()
    page.get_by_role('button', name='从书架移除').click(); page.get_by_role('button', name='确认移除').click()
    page.wait_for_function('()=>!document.querySelector(".manage-modal")')
    assert saved_notes(page, book['id']) == []
    print('PASS', label, 'Word/PDF directory, search, return position, bookmark/excerpt CRUD, selection, persistence, same-text update, deletion isolation, safe text and clean layout', flush=True)


def assert_failures(page, label):
    upload(page, '保存故障.txt', ('第一句正常的正文。\n第二句用于选择摘录。\n' * 200).encode()); close_import(page)
    book = next(b for b in library(page) if b['title'] == '保存故障')
    page.get_by_role('button', name='阅读《保存故障》', exact=True).click()
    open_tools(page, '书签·摘录')
    page.get_by_role('button', name='记住当前位置').click(); page.locator('#reading-note').fill('失败后应保留草稿')
    page.evaluate('''()=>{window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='notes')throw new DOMException('disk full','QuotaExceededError');return window.__put.apply(this,args);};}''')
    page.get_by_role('button', name='保存到本书').click()
    expect(page.get_by_role('alert')).to_contain_text('保存失败')
    expect(page.locator('#reading-note')).to_have_value('失败后应保留草稿')
    assert saved_notes(page, book['id']) == []
    page.evaluate('()=>{IDBObjectStore.prototype.put=window.__put;}')
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(1)
    page.get_by_role('tab', name='搜索', exact=True).click()
    page.locator('#book-search').fill('正文'); expect(page.locator('.search-result')).to_have_count(200)
    page.locator('#book-search').fill('句'); expect(page.locator('.tools-panel')).to_contain_text('前200条')
    at = source(page)
    page.get_by_role('tab', name='搜索', exact=True).focus(); page.keyboard.press('Space'); assert source(page) == at
    page.keyboard.press('ArrowRight'); expect(page.get_by_role('tab', name='书签·摘录')).to_have_attribute('aria-selected', 'true')
    page.get_by_role('tab', name='目录').click(); expect(page.locator('.tools-empty')).to_contain_text('没有可识别目录')
    page.set_viewport_size({'width':844,'height':390}); page.wait_for_timeout(200)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.get_by_role('button', name='关闭弹窗').click()
    assert_reader_layout(page)
    page.set_viewport_size({'width':390,'height':844}); page.wait_for_timeout(200)
    page.get_by_role('button', name='返回书架').click()
    page.evaluate('''id=>new Promise(resolve=>{const r=indexedDB.open('chanyue-library');r.onsuccess=()=>{const db=r.result,tx=db.transaction('notes','readwrite');tx.objectStore('notes').put({bad:'preserve'},id);tx.oncomplete=()=>{db.close();resolve();};};})''', book['id'])
    page.reload(); page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='阅读《保存故障》', exact=True).click(); open_tools(page, '书签·摘录')
    expect(page.get_by_role('alert')).to_contain_text('原记录未修改')
    expect(page.get_by_role('button', name='记住当前位置')).to_be_disabled()
    page.get_by_role('tab', name='搜索').click(); page.locator('#book-search').fill('第二句'); expect(page.locator('.search-result')).to_have_count(200)
    page.get_by_role('button', name='关闭弹窗').click()
    assert saved_notes(page, book['id']) == {'bad':'preserve'}
    page.get_by_role('button', name='开始', exact=True).click(); page.wait_for_timeout(100); page.get_by_role('button', name='停止', exact=True).click()
    page.get_by_role('button', name='返回书架').click()
    print('PASS',label,'write failure retains draft, retry, corrupt-note protection, bounded search, keyboard and landscape',flush=True)


def assert_conflicts(page, label):
    upload(page, '多窗口笔记.txt', ('第一句用来存书签。第二句用来定位。\n' * 30).encode()); close_import(page)
    book = next(b for b in library(page) if b['title'] == '多窗口笔记')
    page.get_by_role('button', name='阅读《多窗口笔记》', exact=True).click()
    open_tools(page, '书签·摘录')
    page.get_by_role('button', name='记住当前位置').click()
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(1)
    other = page.context.new_page()
    try:
        other.goto(page.url); other.wait_for_load_state('networkidle')
        other.get_by_role('button', name='阅读《多窗口笔记》', exact=True).click()
        open_tools(other, '书签·摘录')
        other.get_by_role('button', name='编辑', exact=True).click(); other.locator('#reading-note').fill('旧窗口草稿')
        page.get_by_role('button', name='编辑', exact=True).click(); page.locator('#reading-note').fill('新窗口已保存')
        page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(1)
        other.get_by_role('button', name='保存到本书').click()
        expect(other.get_by_role('alert')).to_contain_text('其他窗口')
        expect(other.locator('#reading-note')).to_have_value('旧窗口草稿')
        assert saved_notes(page, book['id'])[0]['note'] == '新窗口已保存'
        other.get_by_role('button', name='关闭弹窗').click(); other.get_by_role('button', name='放弃并关闭').click()
        open_tools(other, '书签·摘录'); other.get_by_role('button', name='编辑', exact=True).click()
        other.locator('#reading-note').fill('不能复活记录')
        page.get_by_role('button', name='删除', exact=True).click(); page.get_by_role('button', name='确认删除', exact=True).click()
        expect(page.locator('.tools-note')).to_have_count(0)
        other.get_by_role('button', name='保存到本书').click()
        expect(other.get_by_role('alert')).to_contain_text('其他窗口')
        expect(other.locator('#reading-note')).to_have_value('不能复活记录')
        assert saved_notes(page, book['id']) == []
        other.get_by_role('button', name='关闭弹窗').click(); other.get_by_role('button', name='放弃并关闭').click()
        page.get_by_role('button', name='记住当前位置').click(); page.get_by_role('button', name='保存到本书').click()
        expect(page.locator('.tools-note')).to_have_count(1)
        open_tools(other, '书签·摘录'); other.get_by_role('button', name='删除', exact=True).click()
        page.get_by_role('button', name='编辑', exact=True).click(); page.locator('#reading-note').fill('过期删除不能移除')
        page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(1)
        other.get_by_role('button', name='确认删除', exact=True).click()
        expect(other.get_by_role('alert')).to_contain_text('其他窗口')
        assert saved_notes(page, book['id'])[0]['note'] == '过期删除不能移除'
        other.get_by_role('button', name='关闭弹窗').click()
        page.get_by_role('tab', name='搜索', exact=True).click(); page.locator('#book-search').fill('第二句')
        expect(page.locator('.search-result')).to_have_count(30); page.locator('.search-result').first.click()
        open_tools(page, '书签·摘录')
        page.get_by_role('button', name='删除', exact=True).click()
        other.evaluate('''()=>new Promise((resolve,reject)=>{const r=indexedDB.open('chanyue-library');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('notes','readwrite'),store=tx.objectStore('notes');window.__holdNotes=true;setTimeout(()=>{window.__holdNotes=false;},10000);tx.oncomplete=()=>db.close();const tick=()=>{const g=store.get('test-lock');g.onsuccess=()=>{resolve();if(window.__holdNotes)tick();};};tick();};})''')
        page.evaluate('''()=>{window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='notes')throw new DOMException('disk full','QuotaExceededError');return window.__put.apply(this,args);};}''')
        page.get_by_role('button', name='确认删除', exact=True).click()
        expect(page.get_by_role('button', name='返回刚才', exact=True)).to_be_disabled()
        expect(page.get_by_role('tab', name='目录', exact=True)).to_be_disabled()
        page.keyboard.press('Escape'); expect(page.get_by_role('dialog')).to_be_visible()
        page.get_by_role('button', name='关闭弹窗').click(); expect(page.get_by_role('dialog')).to_be_visible()
        other.evaluate('()=>{window.__holdNotes=false;}')
        expect(page.get_by_role('alert')).to_contain_text('保存失败')
        expect(page.get_by_role('button', name='返回刚才', exact=True)).to_be_enabled()
        assert saved_notes(page, book['id'])[0]['note'] == '过期删除不能移除'
        page.evaluate('()=>{IDBObjectStore.prototype.put=window.__put;}')
        page.get_by_role('button', name='确认删除', exact=True).click(); expect(page.locator('.tools-note')).to_have_count(0)
        page.get_by_role('button', name='返回刚才', exact=True).click()
        assert source(page) == 0
        page.get_by_role('button', name='返回书架').click()
        print('PASS', label, 'multi-window stale edit/delete protection, no resurrection, pending-delete exit guard and failure retry', flush=True)
    finally:
        other.evaluate('()=>{window.__holdNotes=false;}')
        page.evaluate('()=>{if(window.__put)IDBObjectStore.prototype.put=window.__put;}')
        other.close()


def assert_usability(page, label):
    source_doc = zipfile.ZipFile(io.BytesIO(tools_docx()))
    output = io.BytesIO()
    body = '<w:p><w:r><w:t>' + '长摘录内容' * 350 + '</w:t></w:r></w:p>'
    for number in range(1, 46):
        body += f'<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>第{number}节</w:t></w:r></w:p><w:p><w:r><w:t>回看词，第{number}处正文。</w:t></w:r></w:p>'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in source_doc.namelist():
            data = f'<w:document xmlns:w="{NS}"><w:body>{body}</w:body></w:document>'.encode() if name == 'word/document.xml' else source_doc.read(name)
            archive.writestr(name, data)
    upload(page, '顺手阅读.docx', output.getvalue()); close_import(page)
    book = next(b for b in library(page) if b['title'] == '顺手阅读')
    page.get_by_role('button', name='阅读《顺手阅读》', exact=True).click()
    original = source(page)
    open_tools(page, '搜索')
    page.locator('#book-search').fill('回看词')
    expect(page.locator('.search-result')).to_have_count(45)
    page.get_by_role('button', name='关闭弹窗').click(); open_tools(page)
    expect(page.get_by_role('tab', name='搜索', exact=True)).to_have_attribute('aria-selected', 'true')
    expect(page.locator('#book-search')).to_have_value('回看词')
    expect(page.locator('.search-result')).to_have_count(45)
    page.locator('.search-result').nth(35).click()
    open_tools(page)
    expect(page.locator('.search-result[aria-current]')).to_contain_text('上次查看')
    expect(page.locator('.search-result[aria-current]')).to_be_in_viewport()
    expect(page.get_by_role('button', name='关闭弹窗')).to_be_in_viewport()
    page.get_by_role('tab', name='目录', exact=True).click()
    expect(page.locator('.tools-result[aria-current]')).to_contain_text('第36节')
    expect(page.locator('.tools-result[aria-current]')).to_be_in_viewport()
    expect(page.get_by_role('button', name='关闭弹窗')).to_be_in_viewport()
    page.screenshot(path=str(ARTIFACTS / f'tools-{label}-current-chapter.png'))
    page.get_by_role('button', name='返回刚才', exact=True).click()
    assert source(page) == original
    open_tools(page, '搜索'); expect(page.locator('#book-search')).to_have_value('回看词')
    page.locator('#book-search').fill('无此匹配'); expect(page.locator('.search-result')).to_have_count(0)
    page.locator('#book-search').fill('回看词'); expect(page.locator('.search-result')).to_have_count(45)
    expect(page.locator('.search-result[aria-current]')).to_have_count(0)
    page.get_by_role('tab', name='书签·摘录').click(); page.get_by_role('button', name='摘录当前句').click()
    expect(page.locator('#excerpt-context')).not_to_be_visible()
    expect(page.locator('.tools-quote')).to_be_visible()
    page.locator('.tools-selection summary').click()
    page.locator('#excerpt-context').evaluate('(e)=>{e.focus();e.setSelectionRange(0,1100);}')
    page.get_by_role('button', name='使用选中文字').click()
    quote = page.locator('.tools-quote').inner_text(); assert len(quote) == 1100
    page.locator('.tools-selection summary').click()
    page.locator('#reading-note').fill('备注内容' * 60)
    page.screenshot(path=str(ARTIFACTS / f'tools-{label}-simple-excerpt.png'))
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(1)
    assert saved_notes(page, book['id'])[0]['quote'] == quote
    preview = page.locator('span.tools-note-preview')
    assert preview.evaluate('(e)=>e.clientHeight<=parseFloat(getComputedStyle(e).lineHeight)*3+1 && e.scrollHeight>e.clientHeight')
    expect(page.get_by_role('button', name='编辑', exact=True)).to_be_in_viewport()
    page.get_by_role('button', name='编辑', exact=True).click()
    expect(page.locator('.tools-quote')).to_have_text(quote)
    expect(page.locator('#excerpt-context')).not_to_be_visible()
    page.get_by_role('button', name='取消', exact=True).click()
    for width, height in [(1440, 900), (844, 390), (320, 568)]:
        page.set_viewport_size({'width': width, 'height': height}); page.wait_for_timeout(100)
        expect(page.get_by_role('button', name='关闭弹窗')).to_be_in_viewport()
        expect(page.get_by_role('tab', name='搜索', exact=True)).to_be_in_viewport()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert page.locator('.reading-tools-modal').evaluate('(e)=>e.scrollHeight<=e.clientHeight+1')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.get_by_role('button', name='关闭弹窗').click(); open_tools(page)
    expect(page.get_by_role('tab', name='书签·摘录')).to_have_attribute('aria-selected', 'true')
    page.get_by_role('button', name='关闭弹窗').click(); page.get_by_role('button', name='返回书架').click()
    page.get_by_role('button', name='阅读《顺手阅读》', exact=True).click(); open_tools(page, '搜索')
    expect(page.locator('#book-search')).to_have_value('')
    page.get_by_role('button', name='关闭弹窗').click(); page.get_by_role('button', name='返回书架').click()
    print('PASS', label, 'session-only search/tab memory, last hit/current chapter reveal, collapsed range editor, full saved quote, compact note previews and reachable controls', flush=True)


def assert_input_selection(page, label):
    content = '开头。' + '长句文字' * 800 + '收尾。\n后段标记🌱用于验证原文选区。'
    upload(page, '输入与选区.txt', content.encode()); close_import(page)
    book = next(b for b in library(page) if b['title'] == '输入与选区')
    page.get_by_role('button', name='阅读《输入与选区》', exact=True).click()
    original = source(page)
    open_tools(page, '搜索')
    search = page.locator('#book-search')
    search.fill('开头'); expect(page.locator('.search-result')).to_have_count(1)
    search.dispatch_event('compositionstart')
    search.fill('chang'); page.wait_for_timeout(300)
    expect(page.locator('.tools-panel [role="status"]')).to_contain_text('选字后查找')
    expect(page.locator('.search-result')).to_have_count(0)
    expect(page.locator('.tools-empty')).to_have_count(0)
    search.dispatch_event('keydown', {'key': 'Enter', 'code': 'Enter', 'isComposing': True, 'keyCode': 229})
    expect(page.locator('.tools-panel [role="status"]')).to_contain_text('选字后查找')
    assert source(page) == original
    search.fill('长句'); search.dispatch_event('compositionend', {'data': '长句'})
    expect(page.locator('.search-result')).to_have_count(200)
    search.fill('后段标记'); search.press('Enter')
    expect(page.locator('.search-result')).to_have_count(1)
    expect(page.get_by_role('dialog')).to_be_visible()
    assert source(page) == original
    search.dispatch_event('compositionstart'); search.fill('开头')
    page.get_by_role('tab', name='目录', exact=True).click()
    page.get_by_role('tab', name='搜索', exact=True).click()
    expect(page.locator('.search-result')).to_have_count(1)
    search.fill(''); expect(page.locator('.search-result')).to_have_count(0)
    page.get_by_role('tab', name='书签·摘录').click()
    page.get_by_role('button', name='摘录当前句').click()
    page.locator('.tools-selection summary').click()
    area = page.locator('#excerpt-context')
    expect(area).to_be_focused()
    assert area.evaluate('(e)=>e.value.slice(e.selectionStart,e.selectionEnd)') == '开头。'
    assert 2000 <= len(area.input_value()) <= 3202
    area.evaluate('(e)=>e.setSelectionRange(0,2001)')
    page.get_by_role('button', name='使用选中文字').click()
    expect(page.get_by_role('alert')).to_contain_text('最多2000')
    expect(page.locator('.tools-quote')).to_have_text('开头。')
    assert saved_notes(page, book['id']) == []
    area.evaluate('(e)=>{e.focus();e.setSelectionRange(0,2000);}')
    page.get_by_role('button', name='使用选中文字').click()
    expect(page.locator('.tools-quote')).to_have_text(content[:2000])
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(1)
    maximum = saved_notes(page, book['id'])[0]
    assert maximum['end'] == 2000 and maximum['quote'] == content[:2000]
    page.get_by_role('button', name='关闭弹窗').click()
    page.reload(); page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='阅读《输入与选区》', exact=True).click(); open_tools(page, '书签·摘录')
    page.get_by_role('button', name='编辑', exact=True).click()
    page.locator('.tools-selection summary').click(); expect(area).to_be_focused()
    assert area.evaluate('(e)=>e.value.slice(e.selectionStart,e.selectionEnd)') == content[:2000]
    page.get_by_role('button', name='使用选中文字').click()
    page.get_by_role('button', name='取消', exact=True).click()
    expect(page.get_by_role('tab', name='书签·摘录')).to_be_visible()
    expect(page.locator('.tools-discard')).to_have_count(0)
    assert saved_notes(page, book['id'])[0] == maximum
    page.get_by_role('button', name='编辑', exact=True).click()
    page.locator('.tools-selection summary').click(); expect(area).to_be_focused()
    area.evaluate('(e)=>e.setSelectionRange(700,2100)')
    page.get_by_role('button', name='使用选中文字').click()
    expect(page.locator('.tools-quote')).to_have_text(content[700:2100])
    area.evaluate('(e)=>{e.focus();e.setSelectionRange(800,2400);}')
    page.get_by_role('button', name='使用选中文字').click()
    expect(page.locator('.tools-quote')).to_have_text(content[800:2400])
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(1)
    changed = saved_notes(page, book['id'])[0]
    assert changed['start'] == 800 and changed['end'] == 2400
    page.get_by_role('button', name='编辑', exact=True).click()
    page.locator('.tools-selection summary').click(); expect(area).to_be_focused()
    assert area.evaluate('(e)=>[e.selectionStart,e.selectionEnd]') == [600, 2200]
    assert area.evaluate('(e)=>e.value.slice(e.selectionStart,e.selectionEnd)') == content[800:2400]
    assert area.evaluate('(e)=>e.scrollTop>0')
    assert page.locator('body > div[aria-hidden="true"]').count() == 0
    page.screenshot(path=str(ARTIFACTS / f'tools-{label}-preselected-excerpt.png'))
    page.get_by_role('button', name='取消', exact=True).click()
    page.get_by_role('tab', name='搜索', exact=True).click(); search.fill('🌱')
    expect(page.locator('.search-result')).to_have_count(1)
    page.get_by_role('button', name='摘录匹配文字').click()
    page.locator('.tools-selection summary').click(); expect(area).to_be_focused()
    assert area.evaluate('(e)=>e.value.slice(e.selectionStart,e.selectionEnd)') == '🌱'
    area.evaluate('(e)=>{e.focus();e.setSelectionRange(e.selectionStart+1,e.selectionEnd);}')
    page.get_by_role('button', name='使用选中文字').click()
    expect(page.locator('.tools-quote')).to_have_text('🌱')
    page.get_by_role('button', name='保存到本书').click(); expect(page.locator('.tools-note')).to_have_count(2)
    assert any(n['quote'] == '🌱' and n['end'] - n['start'] == 2 for n in saved_notes(page, book['id']))
    page.get_by_role('button', name='关闭弹窗').click()
    assert source(page) == original
    page.get_by_role('button', name='返回书架').click()
    print('PASS', label, 'simulated IME composition/blur/Enter, 2000-character excerpt, over-limit protection, reload preselection, unchanged cancel, stable selection offsets and Unicode', flush=True)


def assert_migration(browser, device, url):
    context = browser.new_context(**device, service_workers='block')
    page = context.new_page()
    page.route(url + '/', lambda route: route.fulfill(body='<html><body>prepare old database</body></html>',content_type='text/html'))
    try:
        page.goto(url)
        page.evaluate('''()=>new Promise((resolve,reject)=>{const r=indexedDB.open('chanyue-library',2);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('books',{keyPath:'id'});d.createObjectStore('positions',{keyPath:'id'});d.createObjectStore('meta');};r.onsuccess=()=>{const db=r.result,t=db.transaction(['books','positions','meta'],'readwrite');t.objectStore('books').put({id:'legacy-book',title:'旧书迁移',author:'本地',format:'TXT',lines:['旧书内容保持完整。第二句话用来验证进度。'],createdAt:1,lastReadAt:1,cover:0,line:0,offset:null,completed:false});t.objectStore('positions').put({id:'legacy-book',line:0,offset:null,character:5.25,completed:false,lastReadAt:20});t.objectStore('meta').put(true,'initialized');t.oncomplete=()=>{db.close();resolve();};};r.onerror=()=>reject(r.error);})''')
        page.unroute(url + '/')
        page.goto(url); page.wait_for_load_state('networkidle')
        expect(page.locator('.book-card')).to_have_count(1)
        page.get_by_role('button',name='阅读《旧书迁移》',exact=True).click()
        assert abs(source(page)-5.25)<.01
        open_tools(page,'书签·摘录'); page.get_by_role('button',name='记住当前位置').click();page.get_by_role('button',name='保存到本书').click();expect(page.locator('.tools-note')).to_have_count(1)
        assert len(saved_notes(page,'legacy-book'))==1
        assert len(library(page))==1
        print('PASS IndexedDB v2 -> v3 preserves book, settings-independent progress and creates notes store',flush=True)
    finally:
        context.close()


def main():
    native = '--native' in sys.argv
    bundle = (ROOT / 'dist-native').resolve()
    url = 'https://chanyue-tools-offline.invalid' if native else next((arg for arg in sys.argv[1:] if arg.startswith('http')), 'http://127.0.0.1:4175')
    with sync_playwright() as p:
        for engine in [p.chromium, p.webkit]:
            browser = engine.launch(headless=True)
            context = browser.new_context(**p.devices['iPhone 13'], service_workers='block')
            errors = []
            if native:
                def bundled(route):
                    parsed = urlparse(route.request.url); target = (bundle / (unquote(parsed.path).lstrip('/') or 'index.html')).resolve()
                    if parsed.hostname != 'chanyue-tools-offline.invalid' or not target.is_relative_to(bundle) or not target.is_file():
                        errors.append(route.request.url); route.abort(); return
                    mime = {'.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm'}.get(target.suffix)
                    route.fulfill(body=target.read_bytes(), content_type=mime or mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
                context.route('**/*', bundled)
                if engine.name == 'chromium': context.set_offline(True)
                else: print('WebKit: bundled interception only; offline flag unsupported on this host', flush=True)
            page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                page.goto(url); page.wait_for_load_state('networkidle')
                assert_tools(page, engine.name + ('-native' if native else ''))
                assert_failures(page, engine.name + ('-native' if native else ''))
                assert_conflicts(page, engine.name + ('-native' if native else ''))
                assert_usability(page, engine.name + ('-native' if native else ''))
                assert_input_selection(page, engine.name + ('-native' if native else ''))
                if not native: assert_migration(browser, p.devices['iPhone 13'], url)
                assert not errors, errors
            finally:
                context.close(); browser.close()
    (ARTIFACTS / ('tools-native-result.json' if native else 'tools-result.json')).write_text(json.dumps({'_copyright':'版权所有：波哥','status':'passed','browsers':['chromium','webkit']}), encoding='utf-8')


if __name__ == '__main__':
    main()
