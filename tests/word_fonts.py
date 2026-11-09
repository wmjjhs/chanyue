# 版权所有：波哥
import io
import json
import mimetypes
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse
from xml.sax.saxutils import escape
from playwright.sync_api import sync_playwright, expect
from android_bridge import MOCK, HEADERS
from e2e import upload, close_import, assert_reader_layout
from typography import NS, library, style_at

ROOT = Path(__file__).resolve().parents[1]
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'


def package(body, styles='', theme=None, malicious=False):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr('word/document.xml', f'<w:document xmlns:w="{NS}"><w:body>{body}</w:body></w:document>')
        z.writestr('word/styles.xml', f'<w:styles xmlns:w="{NS}">{styles}</w:styles>')
        if theme:
            z.writestr('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme2.xml"/></Relationships>')
            z.writestr('word/theme/theme2.xml', ('<!DOCTYPE a:theme [<!ENTITY leak SYSTEM "https://example.invalid/font">]>' if malicious else '') + theme)
    return data.getvalue()


def run(text, properties=''):
    return f'<w:r><w:rPr>{properties}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def mixed_fonts(clear=False):
    pairs = [('宋常', 'SimSun', False), ('宋重', 'SimSun', True), ('楷常', 'KaiTi', False), ('楷重', 'KaiTi', True), ('黑常', 'Microsoft YaHei', False), ('黑重', 'Microsoft YaHei', True)]
    paragraph = ''.join(run(text, '' if clear else f'<w:rFonts w:eastAsia="{font}"/><w:b w:val="{int(bold)}"/>') for text, font, bold in pairs)
    paragraph += run('AB', '' if clear else '<w:rFonts w:ascii="Courier New" w:eastAsia="KaiTi"/>')
    body = f'<w:p>{paragraph}</w:p>' + '<w:p>' + run('这里是普通正文，用来验证字号变化、滚动与进度不改变原格式。' * 40) + '</w:p>'
    return package(body), pairs


def inherited_fonts(default_value):
    styles = f'''<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/><w:rFonts w:ascii="Times New Roman" w:eastAsiaTheme="minorEastAsia"/></w:rPr></w:rPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:default="{default_value}" w:styleId="Normal"><w:rPr><w:b/><w:rFonts w:eastAsia="SimSun"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="K"><w:rPr><w:rFonts w:eastAsia="KaiTi"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="H"><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Theme"><w:rPr><w:rFonts w:eastAsiaTheme="minorEastAsia" w:asciiTheme="majorAscii"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
      <w:style w:type="character" w:styleId="Strong"><w:rPr><w:b/></w:rPr></w:style>'''
    body = '<w:p>' + run(f'默认{default_value}') + run('取消粗体', '<w:b w:val="off"/>') + '</w:p>'
    body += '<w:p><w:pPr><w:pStyle w:val="K"/></w:pPr>' + run('楷继承', '<w:rStyle w:val="Strong"/>') + '</w:p>'
    body += '<w:p><w:pPr><w:pStyle w:val="H"/></w:pPr>' + run('黑继承', '<w:rStyle w:val="Strong"/>') + '</w:p>'
    body += '<w:p><w:pPr><w:pStyle w:val="Theme"/></w:pPr>' + run('主题字ABC') + run('直接字', '<w:rFonts w:eastAsia="SimSun"/><w:b w:val="false"/>') + '</w:p>'
    body += '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' + run('普通标题') + '</w:p>'
    body += '<w:p>' + run('عرب', '<w:rFonts w:cs="Arial"/><w:b w:val="0"/><w:bCs/><w:szCs w:val="36"/>') + run('原型安全', '<w:rFonts w:eastAsia="bad&amp;quot;;url(x)"/>') + '</w:p>'
    body += '<w:p>' + run('“中文”', '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="KaiTi" w:hint="eastAsia"/>') + run('كتاب', '<w:rFonts w:cstheme="minorBidi"/><w:lang w:bidi="ar-SA"/><w:bCs w:val="0"/>') + '</w:p>'
    theme = f'<a:theme xmlns:a="{A}"><a:themeElements><a:fontScheme name="test"><a:majorFont><a:latin typeface="Courier New"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Hans" typeface="KaiTi"/><a:font script="Arab" typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>'
    return package(body, styles, theme), package(body, styles, theme, malicious=True)


def native_library(page):
    return page.evaluate('''() => {
      const files=JSON.parse(localStorage.getItem('mock-files')||'{}'), prefs=JSON.parse(localStorage.getItem('mock-prefs')||'{}');
      return Object.values(files).map(s=>{try{return JSON.parse(s)}catch{return null}}).filter(b=>b&&b.id&&b.lines).map(b=>({...b,...JSON.parse(prefs['chanyue-position:'+b.id]||'{}')}));
    }''')


def assert_rendered(page, book, pairs):
    for text, font, bold in pairs:
        offset = len('\n'.join(book['lines']).split(text)[0].encode('utf-16-le')) // 2
        cell = page.locator(f'.reading-glyph[data-source="{offset}"] > span')
        expect(cell).to_be_attached()
        style = cell.evaluate('e=>({font:getComputedStyle(e).fontFamily,weight:getComputedStyle(e).fontWeight})')
        assert style['weight'] == ('700' if bold else '400'), (text, style)
        assert style['font'].split(',')[0].strip(' "') == font, (text, style)


def main():
    bundle = (ROOT / 'dist-native').resolve()
    bridge = (ROOT / 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js').read_text(encoding='utf-8')
    results = []
    with sync_playwright() as p:
        for engine in ['chromium', 'webkit']:
            for native in [False, True]:
                browser = getattr(p, engine).launch(headless=True)
                context = browser.new_context(viewport={'width':390,'height':844}, service_workers='block')
                errors = []
                def resource(route):
                    url=urlparse(route.request.url); path=(bundle/(unquote(url.path).lstrip('/') or 'index.html')).resolve()
                    if url.hostname!='localhost' or not path.is_relative_to(bundle) or not path.is_file():
                        errors.append('Unexpected request');route.abort();return
                    route.fulfill(body=path.read_bytes(), content_type={'.js':'application/javascript','.mjs':'application/javascript'}.get(path.suffix) or mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
                context.route('**/*',resource)
                if native: context.add_init_script(MOCK+'\n'+bridge+'\n'+HEADERS)
                books = native_library if native else library
                page=context.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
                try:
                    page.goto('https://localhost');page.wait_for_load_state('networkidle')
                    data,pairs=mixed_fonts();upload(page,'字体粗细.docx',data);close_import(page)
                    book=next(b for b in books(page) if b['title']=='字体粗细')
                    for text,font,bold in pairs + [('AB','Courier New',False)]:
                        style=style_at(book,text);assert style.get('font')==font and style['bold']==bold,(text,style)
                    page.get_by_role('button',name='阅读《字体粗细》',exact=True).click();assert_rendered(page,book,pairs)
                    for font_button in ['黑体 清晰简洁','楷体 笔墨之间','宋体 温润书卷']:
                        page.get_by_role('button',name='阅读设置',exact=True).click()
                        page.get_by_role('button',name=font_button,exact=True).click();page.locator('#font-size').fill('24')
                        page.get_by_role('button',name='完成设置',exact=True).click()
                        assert_rendered(page,book,pairs);assert_reader_layout(page)
                    page.screenshot(path=str(ROOT/f'artifacts/word-fonts-{engine}-{native}.png'))
                    page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(250);assert_rendered(page,book,pairs)
                    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(250)
                    page.get_by_role('button',name='开始',exact=True).click();page.wait_for_timeout(400)
                    page.get_by_role('button',name='停止',exact=True).click()
                    source=float(page.locator('.reading-band').get_attribute('data-source'))
                    page.get_by_role('button',name='返回书架',exact=True).click();page.reload();page.wait_for_load_state('networkidle')
                    saved=next(b for b in books(page) if b['id']==book['id']);assert saved['typography']==book['typography']
                    clear,_=mixed_fonts(clear=True);upload(page,'字体粗细.docx',clear);expect(page.locator('.import-results')).to_contain_text('阅读进度保持不变');close_import(page)
                    cleared=next(b for b in books(page) if b['id']==book['id']);assert not cleared['typography']
                    page.get_by_role('button',name='阅读《字体粗细》',exact=True).click()
                    assert abs(float(page.locator('.reading-band').get_attribute('data-source'))-source)<.01
                    assert page.locator('.reading-glyph > span').evaluate_all("els=>els.every(e=>getComputedStyle(e).fontWeight==='400')")
                    page.get_by_role('button',name='返回书架',exact=True).click()
                    upload(page,'字体粗细.docx',data);close_import(page)
                    upload(page,'纯文.txt','\n'.join(book['lines']).encode(),success=False);close_import(page)
                    assert next(b for b in books(page) if b['id']==book['id'])['typography']==book['typography']
                    for value in ['true','on','1']:
                        doc,bad=inherited_fonts(value);title='继承'+value
                        upload(page,title+'.docx',doc);close_import(page)
                        b=next(b for b in books(page) if b['title']==title)
                        for text,font,bold,scale in [('默认'+value,'SimSun',True,1),('取消粗体','SimSun',False,1),('楷继承','KaiTi',True,1),('黑继承','Microsoft YaHei',True,1),('主题字','KaiTi',False,1),('ABC','Courier New',False,1),('直接字','SimSun',False,1),('普通标题','KaiTi',False,1),('عرب','Arial',True,1.5),('“','KaiTi',True,1),('”','KaiTi',True,1),('كتاب','Arial',False,1)]:
                            actual=style_at(b,text);assert actual.get('font')==font and actual['bold']==bold and actual['scale']==scale,(text,actual)
                        upload(page,'恶意主题.docx',bad,success=False);close_import(page)
                    assert not errors,errors
                    results.append({'engine':engine,'nativeStorageMock':native,'status':'passed'})
                    print('PASS',engine,'native' if native else 'web','source fonts/bold, theme/inheritance, settings/reflow, restore formatting, progress, restart, safe XML',flush=True)
                finally: context.close();browser.close()
    (ROOT/'artifacts/word-fonts-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
