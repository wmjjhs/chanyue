# 版权所有：波哥
import io
import json
import mimetypes
from urllib.parse import unquote, urlparse
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
from playwright.sync_api import sync_playwright, expect
from e2e import upload, close_import, assert_reader_layout

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts'
NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def styled_docx(malicious=False):
    styles = f'''<w:styles xmlns:w="{NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="TitleBase"><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="TitleBase"/></w:style>
    <w:style w:type="character" w:styleId="Strong"><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="Twice"><w:basedOn w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="LoopA"><w:basedOn w:val="LoopB"/><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="LoopB"><w:basedOn w:val="LoopA"/></w:style></w:styles>'''
    if malicious:
        styles = '<!DOCTYPE w:styles [<!ENTITY xxe SYSTEM "https://example.invalid/secret">]>' + styles
    body = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 看见重点</w:t></w:r></w:p>'
    body += '<w:p><w:r><w:t>普通正文足够长，作为阅读基准字号。</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Strong"/><w:sz w:val="36"/></w:rPr><w:t>重点Bold🌱</w:t></w:r>'
    body += '<w:r><w:rPr><w:rStyle w:val="Strong"/><w:b w:val="0"/></w:rPr><w:t>取消加粗</w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>小字注释</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Twice"/></w:rPr><w:t>样式翻转</w:t></w:r></w:p>'
    body += '<w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>表格重点</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    body += '<w:p><w:hyperlink><w:r><w:t>' + escape('<img src=x onerror=alert(1)>') + '</w:t></w:r></w:hyperlink><w:r><w:rPr><w:rStyle w:val="LoopA"/></w:rPr><w:t>循环继承安全</w:t></w:r></w:p>'
    body += ('<w:p><w:r><w:t>这一段普通的文字用来验证持续阅读、重新排版和保存阅读进度。</w:t></w:r></w:p>' * 90)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('word/document.xml', f'<w:document xmlns:w="{NS}"><w:body>{body}</w:body></w:document>')
        archive.writestr('word/styles.xml', styles)
    return output.getvalue()


def styled_pdf():
    commands = b'BT /F2 24 Tf 60 750 Td (Large Heading) Tj /F1 12 Tf 0 -35 Td (Regular body text used as the base font size.) Tj /F2 12 Tf 0 -22 Td (Bold emphasis) Tj /F1 9 Tf 0 -20 Td (Small note) Tj /F1 12 Tf 0 -22 Td (More regular body text to preserve a reliable base font size.) Tj ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>', b'<< /Length ' + str(len(commands)).encode() + b' >>\nstream\n' + commands + b'\nendstream']
    data, offsets = b'%PDF-1.4\n', [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data)); data += str(index).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
    xref = len(data)
    data += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
    for offset in offsets[1:]:
        data += f'{offset:010d} 00000 n \n'.encode()
    return data + f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()


def library(page):
    return page.evaluate('''()=>new Promise((resolve,reject)=>{const req=indexedDB.open('chanyue-library');req.onsuccess=()=>{const db=req.result,r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>{db.close();resolve(r.result);};r.onerror=()=>reject(r.error);};})''')


def style_at(book, text):
    offset = len('\n'.join(book['lines']).split(text)[0].encode('utf-16-le')) // 2
    assert text in '\n'.join(book['lines']), text
    return next((run for run in book.get('typography', []) if run['start'] <= offset < run['end']), {'scale': 1, 'bold': False})


def geometry(page):
    assert_reader_layout(page)
    assert page.evaluate('''()=>[...document.querySelectorAll('.reading-row')].every(row=>{
      const r=row.getBoundingClientRect(),cells=[...row.querySelectorAll('.reading-glyph')];
      return cells.every((cell,i)=>{const c=cell.getBoundingClientRect(),inner=cell.firstElementChild.getBoundingClientRect();return c.left>=r.left-.2&&c.right<=r.right+.2&&(!i||c.left>=cells[i-1].getBoundingClientRect().right-.2)&&inner.top>=r.top-.5&&inner.bottom<=r.bottom+.5;});
    })''')


def assert_import_typography(page, label):
    before = len(library(page))
    upload(page, '重点文档.docx', styled_docx()); close_import(page)
    book = next(value for value in library(page) if value['title'] == '重点文档')
    for text, scale, bold in [('第一章', 2, True), ('重点Bold', 1.5, True), ('取消加粗', 1, False), ('小字注释', .75, False), ('样式翻转', 1, False), ('表格重点', 1, True), ('普通正文', 1, False)]:
        actual = style_at(book, text)
        assert actual['scale'] == scale and actual['bold'] == bold, (text, actual)
    page.get_by_role('button', name='阅读《重点文档》', exact=True).click()
    geometry(page)
    bold = page.locator('.reading-glyph[data-source="0"]')
    assert bold.evaluate('(e)=>getComputedStyle(e).fontWeight') == '700'
    assert 'weight' in bold.locator('span').evaluate('(e)=>getComputedStyle(e).fontSynthesis')
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#font-size').fill('24')
    page.get_by_role('button', name='完成设置').click()
    geometry(page)
    page.screenshot(path=str(ARTIFACTS / f'typography-{label}.png'))
    assert page.locator('.flowing-text img,.flowing-text script').count() == 0
    page.get_by_role('button', name='开始', exact=True).click(); page.wait_for_timeout(450)
    page.get_by_role('button', name='停止', exact=True).click()
    source = float(page.locator('.reading-band').get_attribute('data-source'))
    for mode in ['紧凑排列', '无标点密排', '语义段落']:
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.get_by_role('button', name=mode, exact=True).click()
        page.locator('#font-size').fill('24')
        page.get_by_role('button', name='划线留痕', exact=True).click()
        page.get_by_role('button', name='完成设置').click()
        geometry(page)
        assert abs(float(page.locator('.reading-band').get_attribute('data-source')) - source) < .01
    page.set_viewport_size({'width':844,'height':390}); page.wait_for_timeout(250); geometry(page)
    page.set_viewport_size({'width':390,'height':844}); page.wait_for_timeout(250); geometry(page)
    page.get_by_role('button', name='返回书架').click()
    page.reload(); page.wait_for_load_state('networkidle')
    saved = next(value for value in library(page) if value['id'] == book['id'])
    assert saved['typography'] == book['typography']
    page.get_by_role('button', name='阅读《重点文档》', exact=True).click()
    assert abs(float(page.locator('.reading-band').get_attribute('data-source')) - source) < .01
    page.get_by_role('button', name='返回书架').click()
    page.evaluate('''id=>new Promise(resolve=>{const request=indexedDB.open('chanyue-library');request.onsuccess=()=>{const db=request.result,tx=db.transaction('books','readwrite'),store=tx.objectStore('books'),r=store.get(id);r.onsuccess=()=>{const b=r.result;delete b.typography;delete b.typographyVersion;store.put(b);};tx.oncomplete=()=>{db.close();resolve();};};})''', book['id'])
    page.reload(); page.wait_for_load_state('networkidle')
    upload(page, '重点文档.docx', styled_docx())
    expect(page.locator('.import-results')).to_contain_text('阅读进度保持不变'); close_import(page)
    assert len(library(page)) == before + 1
    updated = next(value for value in library(page) if value['id'] == book['id'])
    assert updated['typography'] == book['typography']
    page.get_by_role('button', name='阅读《重点文档》', exact=True).click()
    assert abs(float(page.locator('.reading-band').get_attribute('data-source')) - source) < .01
    page.get_by_role('button', name='返回书架').click()
    upload(page, '纯文本.txt', '\n'.join(book['lines']).encode(), success=False); close_import(page)
    upload(page, '重复重点.docx', styled_docx(), success=False); close_import(page)
    upload(page, '异常样式.docx', styled_docx(malicious=True), success=False); close_import(page)
    upload(page, 'PDF重点.pdf', styled_pdf()); close_import(page)
    pdf = next(value for value in library(page) if value['title'] == 'PDF重点')
    for text, scale, bold in [('Large Heading', 2, True), ('Regular body', 1, False), ('Bold emphasis', 1, True), ('Small note', .75, False)]:
        actual = style_at(pdf, text)
        assert actual['scale'] == scale and actual['bold'] == bold, (label, text, actual, pdf['typography'])
    page.get_by_role('button', name='阅读《PDF重点》', exact=True).click(); geometry(page)
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='恢复默认', exact=True).click()
    page.get_by_role('button', name='完成设置').click()
    page.get_by_role('button', name='返回书架').click()
    print('PASS', label, 'DOCX inherited/direct size and weight, normalization, safe text, PDF fonts, layout, reload, old-book formatting update and progress', flush=True)


def main():
    native = '--native' in sys.argv
    url = 'https://chanyue-format-offline.invalid' if native else sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4173'
    bundle = (ROOT / 'dist-native').resolve()
    with sync_playwright() as p:
        for engine in [p.chromium, p.webkit]:
            browser = engine.launch(headless=True)
            context = browser.new_context(**p.devices['iPhone 13'], service_workers='block' if native else 'allow')
            page = context.new_page(); errors = []
            if native:
                def bundled(route):
                    parsed = urlparse(route.request.url)
                    target = (bundle / (unquote(parsed.path).lstrip('/') or 'index.html')).resolve()
                    if parsed.hostname != 'chanyue-format-offline.invalid' or not target.is_relative_to(bundle) or not target.is_file():
                        errors.append(route.request.url); route.abort(); return
                    mime = {'.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.bcmap':'application/octet-stream'}.get(target.suffix)
                    route.fulfill(body=target.read_bytes(), content_type=mime or mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
                context.route('**/*', bundled)
                if engine.name == 'chromium':
                    context.set_offline(True)
                else:
                    print('WebKit: all resources intercepted from bundle; offline network flag unsupported on this host', flush=True)
            page.on('pageerror', lambda e: errors.append(str(e)))
            try:
                page.goto(url); page.wait_for_load_state('networkidle')
                assert_import_typography(page, engine.name + ('-native' if native else ''))
                assert not errors, errors
            finally:
                context.close(); browser.close()
    name = 'typography-native-result.json' if native else 'typography-result.json'
    (ARTIFACTS / name).write_text(json.dumps({'_copyright':'版权所有：波哥','status':'passed','browsers':['chromium','webkit'],'bundledOffline':native}), encoding='utf-8')


if __name__ == '__main__':
    main()
