# 版权所有：波哥
import io
import json
import sys
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts'
ARTIFACTS.mkdir(exist_ok=True)
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173'


def docx_bytes():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>文档的第一行，风吹竹林。</w:t></w:r></w:p><w:p><w:r><w:t>文档的第二行，流水不争。</w:t></w:r></w:p></w:body></w:document>')
    return stream.getvalue()


def pdf_bytes(text='PDF reading flows peacefully.', chinese=False, blank=False):
    if chinese:
        command = f'BT /F1 18 Tf 72 720 Td <{text.encode("utf-16-be").hex()}> Tj ET'.encode()
        font = b'<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>'
    else:
        command = f'BT /F1 18 Tf 72 720 Td ({text}) Tj ET'.encode()
        font = b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    if blank:
        command = b''
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        font,
        b'<< /Length ' + str(len(command)).encode() + b' >>\nstream\n' + command + b'\nendstream',
    ]
    if chinese:
        objects.append(b'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>')
    data = b'%PDF-1.4\n'
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(data)
    data += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    for offset in offsets[1:]:
        data += f'{offset:010d} 00000 n \n'.encode()
    data += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()
    return data


def upload(page, name, data, success=True):
    page.get_by_role('button', name='导入书籍', exact=True).click()
    page.locator('input[type=file]').set_input_files({'name': name, 'mimeType': 'application/octet-stream', 'buffer': data})
    result = page.locator('.import-results li').last
    expect(result).to_have_class('success' if success else 'error', timeout=40000)
    return result


def close_import(page):
    page.get_by_role('button', name='关闭弹窗').click()


def transform_x(page):
    return page.locator('.flowing-text').evaluate('(e) => new DOMMatrix(getComputedStyle(e).transform).m41')


def assert_reader_layout(page):
    band = page.locator('.reading-band').bounding_box()
    viewport = page.viewport_size
    assert abs(band['y'] + band['height'] / 2 - viewport['height'] / 2) < 2, (band, viewport)
    controls = page.locator('.reader-controls').bounding_box()
    assert controls['y'] >= band['y'] + band['height']
    assert controls['y'] + controls['height'] < viewport['height'], (controls, viewport)
    assert page.locator('.flowing-text').evaluate('(e) => getComputedStyle(e).whiteSpace') == 'pre'
    assert page.locator('.reader-controls button').count() == 3


def assert_continuous_flow(page, engine):
    page.get_by_role('tab', name='全部书籍').click()
    if page.locator('.import-top').is_visible():
        page.get_by_role('button', name='导入书籍', exact=True).click()
    else:
        page.get_by_role('navigation', name='手机导航').get_by_role('button', name='导入', exact=True).click()
    content = '\n'.join('甲乙丙丁'[i % 4] for i in range(1000))
    page.locator('input[type=file]').set_input_files({'name': '高速连续.txt', 'mimeType': 'text/plain', 'buffer': content.encode()})
    expect(page.locator('.import-results li')).to_have_class('success')
    close_import(page)
    page.get_by_role('button', name='阅读《高速连续》', exact=True).click()
    page.get_by_role('button', name='阅读设置', exact=True).click()
    expect(page.locator('#reading-speed')).to_have_attribute('max', '1600')
    page.locator('#reading-speed').fill('1600')
    page.locator('#font-size').fill('18')
    page.get_by_role('button', name='完成设置').click()
    expect(page.locator('.flowing-text')).to_have_text(content.replace('\n', ''))
    page.get_by_role('button', name='开始', exact=True).click()
    samples = page.evaluate('''() => new Promise(resolve => {
        const samples = [];
        let started;
        const sample = time => {
            started ??= time;
            const flow = document.querySelector('.flowing-text');
            const nodes = [...flow.children];
            const boxes = nodes.slice(0, 10).map(node => node.getBoundingClientRect());
            const band = document.querySelector('.reading-band').getBoundingClientRect();
            samples.push({
                time,
                marker: flow.querySelector('[data-flow-line="500"]').getBoundingClientRect().left,
                line: Number(nodes[0].dataset.flowLine),
                gap: Math.max(0, ...boxes.slice(1).map((box, i) => Math.abs(box.left - boxes[i].right))),
                leading: boxes[0].left - band.left,
                trailing: nodes[nodes.length - 1].getBoundingClientRect().right - band.right,
            });
            if (time - started >= 1100) resolve(samples);
            else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    })''')
    assert samples[-1]['line'] - samples[0]['line'] > 40, samples[-1]
    for previous, current in zip(samples, samples[1:]):
        elapsed = min(current['time'] - previous['time'], 100) / 1000
        assert abs(previous['marker'] - current['marker'] - 1600 * elapsed) < 2, (previous, current)
        assert current['gap'] < 0.1 and current['leading'] <= 1 and current['trailing'] >= 0, current
    page.get_by_role('button', name='停止', exact=True).click()
    marker = page.locator('[data-flow-line="500"]')
    paused = marker.bounding_box()['x']
    page.wait_for_timeout(250)
    assert abs(marker.bounding_box()['x'] - paused) < 1
    current_line = int(page.locator('[data-flow-line]').first.get_attribute('data-flow-line'))
    page.get_by_role('button', name='前进1行').click()
    expect(page.locator('[data-flow-line]').first).to_have_attribute('data-flow-line', str(current_line + 1))
    page.get_by_role('button', name='后退1行').click()
    expect(page.locator('[data-flow-line]').first).to_have_attribute('data-flow-line', str(current_line))
    page.get_by_role('button', name='开始', exact=True).click()
    page.wait_for_timeout(200)
    page.get_by_role('button', name='停止', exact=True).click()
    current_line = page.locator('[data-flow-line]').first.get_attribute('data-flow-line')
    paused = marker.bounding_box()['x']
    page.get_by_role('button', name='返回书架').click()
    page.reload()
    page.get_by_role('button', name='继续阅读', exact=True).click()
    expect(page.locator('[data-flow-line]').first).to_have_attribute('data-flow-line', current_line)
    assert abs(marker.bounding_box()['x'] - paused) < 1
    page.set_viewport_size({'width': 844, 'height': 390})
    assert_reader_layout(page)
    page.screenshot(path=str(ARTIFACTS / f'{engine}-continuous-flow.png'))
    page.get_by_role('button', name='阅读设置', exact=True).click()
    expect(page.locator('#reading-speed')).to_have_value('1600')
    page.get_by_role('button', name='完成设置').click()
    page.get_by_role('button', name='返回书架').click()
    print(f'PASS {engine}: 1600px/s, seamless per-frame line boundaries, short lines, pause, step, resume, orientation, speed persistence')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1060})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(URL)
        page.wait_for_load_state('networkidle')
        expect(page.locator('.book-card')).to_have_count(3)
        page.screenshot(path=str(ARTIFACTS / 'desktop-library.png'), full_page=True)
        page.get_by_role('button', name='阅读《山间的一日》', exact=True).click()
        assert_reader_layout(page)
        expect(page.get_by_role('button', name='后退1行')).to_be_disabled()
        x = transform_x(page)
        page.get_by_role('button', name='开始', exact=True).click()
        page.wait_for_timeout(500)
        assert transform_x(page) < x - 10
        page.get_by_role('button', name='停止', exact=True).click()
        paused = transform_x(page)
        page.wait_for_timeout(350)
        assert abs(transform_x(page) - paused) < 1
        page.get_by_role('button', name='前进1行').click()
        expect(page.locator('.line-counter')).to_contain_text('第 2 行')
        page.get_by_role('button', name='后退1行').click()
        expect(page.locator('.line-counter')).to_contain_text('第 1 行')
        page.get_by_role('button', name='前进1行').click()
        page.get_by_role('button', name='返回书架').click()
        page.reload()
        page.get_by_role('button', name='继续阅读', exact=True).click()
        expect(page.locator('.line-counter')).to_contain_text('第 2 行')
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.get_by_role('button', name='楷体 笔墨之间').click()
        page.locator('#font-size').fill('44')
        page.locator('#reading-speed').fill('100')
        for label, color in [('文字颜色', '#123456'), ('文字背景', '#e0ebdb'), ('页面背景', '#f3f0e5')]:
            page.get_by_label(label, exact=True).fill(color)
        page.get_by_role('button', name='完成设置').click()
        expect(page.locator('.reading-band')).to_have_css('font-size', '44px')
        expect(page.locator('.reading-band')).to_have_css('background-color', 'rgb(224, 235, 219)')
        expect(page.locator('.reading-band')).to_have_css('color', 'rgb(18, 52, 86)')
        expect(page.locator('.reader')).to_have_css('background-color', 'rgb(243, 240, 229)')
        page.screenshot(path=str(ARTIFACTS / 'desktop-reader.png'))
        page.get_by_role('button', name='进入专注模式').click()
        assert page.locator('.reader-prelude').evaluate('(e) => getComputedStyle(e).visibility') == 'hidden'
        page.get_by_role('button', name='退出专注模式').click()
        page.get_by_role('button', name='返回书架').click()
        upload(page, '溪边.txt', '溪边第一行。\n溪边第二行。\n溪边第三行。'.encode())
        close_import(page)
        upload(page, '竹林.docx', docx_bytes())
        close_import(page)
        upload(page, '英文.pdf', pdf_bytes())
        close_import(page)
        upload(page, '中文.pdf', pdf_bytes('山中清风，流水静好。', chinese=True))
        close_import(page)
        expect(page.locator('.book-card')).to_have_count(7)
        page.get_by_role('button', name='阅读《竹林》', exact=True).click()
        expect(page.locator('.flowing-text')).to_have_text('文档的第一行，风吹竹林。文档的第二行，流水不争。')
        page.get_by_role('button', name='返回书架').click()
        page.get_by_role('button', name='阅读《中文》', exact=True).click()
        expect(page.locator('.flowing-text')).to_contain_text('山中清风')
        page.get_by_role('button', name='返回书架').click()
        upload(page, '重复.txt', '溪边第一行。\n溪边第二行。\n溪边第三行。'.encode(), False)
        expect(page.locator('.import-results')).to_contain_text('相同内容')
        close_import(page)
        upload(page, '旧格式.doc', b'legacy', False)
        expect(page.locator('.import-results')).to_contain_text('另存为 .docx')
        close_import(page)
        upload(page, '扫描.pdf', pdf_bytes(blank=True), False)
        expect(page.locator('.import-results')).to_contain_text('OCR')
        close_import(page)
        upload(page, '安全.txt', b'<img src=x onerror=window.unsafe=true>', True)
        close_import(page)
        page.get_by_role('button', name='阅读《安全》', exact=True).click()
        expect(page.locator('.reading-band img')).to_have_count(0)
        assert page.evaluate('window.unsafe') is None
        page.get_by_role('button', name='返回书架').click()
        page.get_by_role('button', name='管理《溪边》', exact=True).click()
        page.get_by_label('书籍名称').fill('溪边随笔')
        page.get_by_role('button', name='保存书名').click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.get_by_label('搜索书籍').fill('溪边随笔')
        expect(page.locator('.book-card')).to_have_count(1)
        page.get_by_role('button', name='管理《溪边随笔》', exact=True).click()
        page.get_by_role('button', name='从书架移除').click()
        page.get_by_role('button', name='再想想').click()
        page.get_by_role('button', name='从书架移除').click()
        page.get_by_role('button', name='确认移除').click()
        expect(page.locator('.empty-state')).to_be_visible()
        page.get_by_role('button', name='清除搜索').click()
        expect(page.locator('.book-card')).to_have_count(7)
        page.reload()
        expect(page.locator('.book-card')).to_have_count(7)
        page.get_by_role('button', name='阅读设置', exact=True).first.click()
        expect(page.locator('#font-size')).to_have_value('44')
        page.get_by_role('button', name='恢复默认').click()
        page.get_by_role('button', name='完成设置').click()
        page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=30000)
        context.set_offline(True)
        page.reload()
        expect(page.locator('.book-card')).to_have_count(7)
        upload(page, '离线.pdf', pdf_bytes('Offline import remains private.'))
        close_import(page)
        page.get_by_role('button', name='阅读《离线》', exact=True).click()
        expect(page.locator('.flowing-text')).to_contain_text('Offline import')
        context.set_offline(False)
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.locator('#font-size').fill('18')
        page.locator('#reading-speed').fill('160')
        page.get_by_role('button', name='完成设置').click()
        page.get_by_role('button', name='开始', exact=True).click()
        expect(page.locator('.line-counter')).to_contain_text('已读完', timeout=12000)
        page.get_by_role('button', name='重新阅读', exact=True).click()
        expect(page.get_by_role('button', name='停止', exact=True)).to_be_visible()
        page.wait_for_timeout(200)
        page.get_by_role('button', name='停止', exact=True).click()
        page.get_by_role('button', name='返回书架').click()
        upload(page, '两行.txt', '甲。\n乙。'.encode())
        close_import(page)
        page.get_by_role('button', name='阅读《两行》', exact=True).click()
        page.set_viewport_size({'width': 390, 'height': 844})
        page.get_by_role('button', name='开始', exact=True).click()
        expect(page.locator('.line-counter')).to_contain_text('第 2 行', timeout=5000)
        expect(page.locator('.line-counter')).to_contain_text('已读完', timeout=5000)
        expect(page.get_by_role('button', name='前进1行')).to_be_disabled()
        page.get_by_role('button', name='返回书架').click()
        page.get_by_role('tab', name='已读完', exact=True).click()
        expect(page.locator('.book-card')).to_have_count(1)
        assert_continuous_flow(page, 'Chromium')
        assert not errors, errors
        print('PASS Chromium: library, scrolling, pause, stepping, progress, settings, TXT/DOCX/PDF/CJK PDF, duplicates, errors, XSS, rename/delete, offline PDF')
        context.close()
        browser.close()

        webkit = p.webkit.launch(headless=True)
        context = webkit.new_context(**p.devices['iPhone 13'])
        page = context.new_page()
        mobile_errors = []
        page.on('pageerror', lambda error: mobile_errors.append(str(error)))
        page.goto(URL)
        page.wait_for_load_state('networkidle')
        expect(page.locator('.book-card')).to_have_count(3)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(ARTIFACTS / 'iphone-library.png'), full_page=True)
        page.get_by_role('button', name='阅读《山间的一日》', exact=True).click()
        assert_reader_layout(page)
        page.screenshot(path=str(ARTIFACTS / 'iphone-reader-portrait.png'))
        page.get_by_role('button', name='开始', exact=True).click()
        x = transform_x(page)
        page.wait_for_timeout(500)
        assert transform_x(page) < x - 10
        page.get_by_role('button', name='停止', exact=True).click()
        page.set_viewport_size({'width': 844, 'height': 390})
        page.wait_for_timeout(200)
        assert_reader_layout(page)
        page.screenshot(path=str(ARTIFACTS / 'iphone-reader-landscape.png'))
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.get_by_role('button', name='夜读', exact=True).click()
        page.locator('#font-size').fill('64')
        page.get_by_role('button', name='完成设置').click()
        assert_reader_layout(page)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.screenshot(path=str(ARTIFACTS / 'iphone-settings.png'))
        page.get_by_role('button', name='恢复默认').click()
        page.get_by_role('button', name='完成设置').click()
        page.get_by_role('button', name='返回书架').click()
        page.get_by_role('navigation', name='手机导航').get_by_role('button', name='导入', exact=True).click()
        page.locator('input[type=file]').set_input_files({'name': '手机.pdf', 'mimeType': 'application/pdf', 'buffer': pdf_bytes('Reading works on mobile WebKit.')})
        expect(page.locator('.import-results li')).to_have_class('success', timeout=40000)
        page.get_by_role('button', name='回书架，开始阅读').click()
        assert_continuous_flow(page, 'WebKit')
        assert not mobile_errors, mobile_errors
        print('PASS WebKit iPhone emulation: portrait/landscape, centered single line, controls, large font, night theme, PDF import')
        context.close()
        webkit.close()
    print(json.dumps({'status': 'passed', 'screenshots': str(ARTIFACTS)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
