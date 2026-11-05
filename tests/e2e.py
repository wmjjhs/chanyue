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
    if page.locator('.import-top').is_visible():
        page.get_by_role('button', name='导入书籍', exact=True).click()
    else:
        page.get_by_role('navigation', name='手机导航').get_by_role('button', name='导入', exact=True).click()
    page.locator('input[type=file]').set_input_files({'name': name, 'mimeType': 'application/octet-stream', 'buffer': data})
    result = page.locator('.import-results li').last
    expect(result).to_have_class('success' if success else 'error', timeout=40000)
    return result


def close_import(page):
    page.get_by_role('button', name='关闭弹窗').click()


def position(page):
    return float(page.locator('.reading-band').get_attribute('data-position'))


def assert_reader_layout(page):
    page.wait_for_function('''() => {
        const band=document.querySelector('.reading-band')?.getBoundingClientRect();
        const controls=document.querySelector('.reader-controls')?.getBoundingClientRect();
        return band && controls && band.y >= 0 && band.bottom <= controls.y + 2;
    }''', timeout=5000)
    boxes = page.evaluate('''() => Object.fromEntries(['reading-band','reader-controls','page-navigation'].map(name=>{
        const r=document.querySelector('.'+name).getBoundingClientRect();
        return [name,{x:r.x,y:r.y,width:r.width,height:r.height}];
    }))''')
    band = boxes['reading-band']
    viewport = page.viewport_size
    controls = boxes['reader-controls']
    assert band['x'] >= 0 and band['y'] >= 0 and band['x'] + band['width'] <= viewport['width'] + 1
    assert controls['y'] >= band['y'] + band['height'] - 2, (band, controls)
    assert controls['y'] + controls['height'] < viewport['height'], (controls, viewport)
    visible = int(page.locator('.reading-band').get_attribute('data-visible-lines'))
    maximum = int(page.locator('.reading-band').get_attribute('data-max-lines'))
    assert 2 <= visible <= maximum <= 15
    assert page.locator('.reading-row').count() <= visible + 5
    assert page.locator('.reader-controls button').count() == 3
    navigation = boxes['page-navigation']
    assert navigation['y'] + navigation['height'] <= viewport['height'], (navigation, viewport)
    rows = int(page.locator('.reading-band').get_attribute('data-rows'))
    assert int(page.locator('.reading-band').get_attribute('data-pages')) == (rows + visible - 1) // visible
    assert page.locator('.flowing-text').evaluate('(e) => new DOMMatrix(getComputedStyle(e).transform).m41') == 0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    expect(page.locator('.reading-glyph.is-current')).to_have_count(1)
    if page.locator('.reading-band').get_attribute('data-cursor-mode') == 'pointer':
        assert page.locator('.scan-cursor').evaluate('e => {const c=e.getBoundingClientRect(),g=document.querySelector(".reading-grid").getBoundingClientRect();return c.width>0&&c.left>=g.left-1&&c.right<=g.right+1&&c.height>=1&&c.height<=6;}')
        expect(page.locator('.reading-trail:not([hidden])')).to_have_count(0)
    else:
        expect(page.locator('.scan-cursor')).to_be_hidden()
        assert page.locator('.reading-trail').count() == page.locator('.reading-row').count()
    assert page.evaluate('''() => {
        const center=e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};};
        const header=document.querySelector('.reader-header');
        const top=[...header.children].map(center);
        const buttons=[...document.querySelectorAll('.reader-controls button')].map(center);
        const bottom=[...document.querySelector('.page-navigation').children].filter(e=>!e.classList.contains('sr-only')).map(center);
        const workspace=document.querySelector('.reading-workspace').getBoundingClientRect();
        const band=document.querySelector('.reading-band').getBoundingClientRect();
        return header.getBoundingClientRect().height<=48 && top.length===3 && Math.max(...top.map(p=>p.y))-Math.min(...top.map(p=>p.y))<1
            && Math.abs(buttons[1].x-innerWidth/2)<1 && Math.abs((buttons[0].x+buttons[2].x)/2-buttons[1].x)<1
            && Math.max(...buttons.map(p=>p.y))-Math.min(...buttons.map(p=>p.y))<1
            && Math.max(...bottom.map(p=>p.y))-Math.min(...bottom.map(p=>p.y))<1
            && workspace.height>=innerHeight-160 && band.y<=header.getBoundingClientRect().bottom+8;
    }''')
    assert page.locator('.reading-glyph > span').evaluate_all('(nodes)=>nodes.every(e=>getComputedStyle(e).transform==="none")')


def sample_motion(page, duration):
    return page.evaluate('''duration => new Promise(resolve => {
        const samples=[]; let started, previousNodes=new Map();
        const tick=time=>{
            started??=time;
            const band=document.querySelector('.reading-band');
            const cursor=document.querySelector('.scan-cursor');
            const matrix=new DOMMatrix(getComputedStyle(cursor).transform);
            const nodes=new Map([...document.querySelectorAll('.reading-row')].map(e=>[e.dataset.row,e]));
            const parent=new DOMMatrix(getComputedStyle(document.querySelector('.flowing-text')).transform);
            const rows=Object.fromEntries([...nodes].map(([key,e])=>[key,{x:parent.m41,y:parent.m42+parseFloat(getComputedStyle(e).top)}]));
            const replaced=[...nodes].some(([key,e])=>previousNodes.has(key)&&previousNodes.get(key)!==e);
            previousNodes=nodes;
            samples.push({time, position:Number(band.dataset.position), scroll:Number(band.dataset.scroll),
                x:matrix.m41,y:matrix.m42,width:cursor.getBoundingClientRect().width,phase:cursor.dataset.phase,row:Number(band.dataset.row),
                rows,replaced,unscaled:[...document.querySelectorAll('.reading-glyph > span')].every(e=>getComputedStyle(e).transform==='none'&&getComputedStyle(e).color===getComputedStyle(band).color),
                underlineHeight:cursor.getBoundingClientRect().height,
                below:cursor.getBoundingClientRect().top>=document.querySelector('.is-current > span').getBoundingClientRect().bottom+1});
            if(time-started>duration)resolve(samples);else requestAnimationFrame(tick);
        };requestAnimationFrame(tick);
    })''', duration)


def assert_guided_reading(page, engine):
    page.get_by_role('tab', name='全部书籍').click()
    content = ('甲乙丙丁戊己庚辛壬癸春夏秋冬山水云风' * 300) + '\n第二个完整段落。\nhello world 👨‍👩‍👧‍👦'
    upload(page, '多行扫读.txt', content.encode())
    close_import(page)
    page.get_by_role('button', name='阅读《多行扫读》', exact=True).click()
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='紧凑排列', exact=True).click()
    page.locator('#font-size').fill('28')
    page.locator('#max-lines').fill('4')
    page.locator('#cursor-thickness').fill('3')
    page.get_by_label('下划线颜色', exact=True).fill('#e5b77b')
    page.locator('#reading-speed').fill('600')
    page.get_by_role('button', name='完成设置').click()
    assert_reader_layout(page)
    expect(page.locator('.scan-cursor')).to_have_css('background-color', 'rgb(229, 183, 123)')
    expect(page.locator('.is-current > span')).to_have_css('transform', 'none')
    expect(page.locator('.scan-cursor')).to_have_css('height', '3px')
    cols = int(page.locator('.reading-band').get_attribute('data-columns'))
    assert page.locator('.reading-row').first.locator('[data-char]').count() == cols
    page.get_by_role('button', name='开始', exact=True).click()
    samples = sample_motion(page, max(2400, cols * 220))
    height = float(page.locator('.reading-band').get_attribute('data-line-height'))
    cell_width = float(page.locator('.reading-band').get_attribute('data-cell-width'))
    assert samples[-1]['position'] - samples[0]['position'] > cols * 2
    assert all(sample['phase'] == 'scan' for sample in samples)
    assert samples[-1]['row'] > samples[0]['row']
    fractional_moves = 0
    for previous, current in zip(samples, samples[1:]):
        delta = min(0.1, (current['time'] - previous['time']) / 1000)
        advance = current['position'] - previous['position']
        assert abs(advance - 10 * delta) < 0.2, (previous, current)
        assert abs(current['scroll'] - previous['scroll'] - advance * height / cols) < 0.05
        assert abs(current['y'] - previous['y'] - (current['row'] - previous['row']) * height + current['scroll'] - previous['scroll']) < 0.02
        expected_x = (current['position'] - current['row'] * cols) / cols * (cols - 1) * cell_width
        assert abs(current['x'] - expected_x) < 0.02
        if current['row'] == previous['row']:
            assert abs(current['x'] - previous['x'] - (cols - 1) / cols * cell_width * advance) < 0.02
        assert abs(current['width'] - cell_width) < 0.1
        assert not current['replaced']
        assert len(current['rows']) <= 9
        assert current['unscaled'] and current['below'] and abs(current['underlineHeight'] - 3) < 0.01, current
        column = current['x'] / cell_width
        if current['row'] == previous['row'] and abs(column - round(column)) > 0.001 and abs(current['x'] - previous['x']) > 0.001:
            fractional_moves += 1
        for row in current['rows'].keys() & previous['rows'].keys():
            assert current['rows'][row]['x'] == 0
            assert abs(current['rows'][row]['y'] - previous['rows'][row]['y'] + current['scroll'] - previous['scroll']) < 0.02
    (ARTIFACTS / f'{engine}-motion-samples.json').write_text(json.dumps(samples), encoding='utf-8')
    assert fractional_moves > len(samples) * 0.6, (engine, fractional_moves, len(samples), cols)
    page.get_by_role('button', name='停止', exact=True).click()
    saved = position(page)
    source = page.locator('.reading-band').get_attribute('data-source')
    page.wait_for_timeout(250)
    assert position(page) == saved
    page.get_by_role('button', name='返回书架').click()
    page.reload()
    page.get_by_role('button', name='继续阅读', exact=True).click()
    assert abs(position(page) - saved) < 0.0001
    page.get_by_role('button', name='阅读设置', exact=True).click()
    expect(page.locator('#max-lines')).to_have_value('4')
    expect(page.locator('#cursor-thickness')).to_have_value('3')
    expect(page.locator('#cursor-scale')).to_have_count(0)
    expect(page.locator('#cursor-words')).to_have_value('1')
    page.get_by_role('button', name='无标点密排', exact=True).click()
    page.locator('#cursor-words').fill('10')
    page.locator('#font-size').fill('18')
    page.locator('#cursor-thickness').fill('1')
    page.get_by_role('button', name='完成设置').click()
    expect(page.locator('.reading-band')).to_have_attribute('data-mode', 'plain')
    expect(page.locator('.reading-band')).to_have_attribute('data-source', source)
    expect(page.locator('.scan-cursor')).to_have_attribute('data-span', '10')
    assert page.locator('.reading-glyph[data-word="-1"]').count() == 0
    page.get_by_role('button', name='开始', exact=True).click()
    wide_samples = sample_motion(page, 1000)
    assert all(abs(sample['width'] - 10 * float(page.locator('.reading-band').get_attribute('data-cell-width'))) < 0.1 for sample in wide_samples)
    page.get_by_role('button', name='停止', exact=True).click()
    saved = position(page)
    source = page.locator('.reading-band').get_attribute('data-source')
    page.get_by_role('button', name='返回书架').click()
    page.reload()
    page.get_by_role('button', name='继续阅读', exact=True).click()
    assert abs(position(page) - saved) < 0.0001
    page.get_by_role('button', name='阅读设置', exact=True).click()
    expect(page.locator('#cursor-words')).to_have_value('10')
    expect(page.get_by_role('button', name='无标点密排', exact=True)).to_have_attribute('aria-pressed', 'true')
    page.locator('#cursor-words').fill('5')
    page.locator('#cursor-thickness').fill('3')
    page.get_by_role('button', name='语义段落', exact=True).click()
    page.locator('#max-lines').fill('12')
    page.locator('#font-size').fill('44')
    page.get_by_role('button', name='完成设置').click()
    expect(page.locator('.reading-band')).to_have_attribute('data-source', source)
    assert abs(position(page) - saved) < 0.0001
    page.screenshot(path=str(ARTIFACTS / f'{engine}-multiline-reader.png'))
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='夜读', exact=True).click()
    page.locator('#font-size').fill('64')
    page.locator('#cursor-thickness').fill('6')
    page.locator('#reading-speed').fill('1600')
    page.get_by_role('button', name='完成设置').click()
    page.set_viewport_size({'width': 844, 'height': 390})
    page.wait_for_timeout(180)
    assert_reader_layout(page)
    expect(page.locator('.reading-band')).to_have_attribute('data-source', source)
    page.screenshot(path=str(ARTIFACTS / f'{engine}-multiline-landscape.png'))
    page.set_viewport_size({'width': 320, 'height': 568})
    page.wait_for_timeout(180)
    assert_reader_layout(page)
    expect(page.locator('.reading-band')).to_have_attribute('data-source', source)
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#cursor-words').fill('10')
    assert page.locator('.settings-preview').evaluate('e => {const box=e.getBoundingClientRect();return [...e.querySelectorAll(".preview-window > span")].every(s=>{const b=s.getBoundingClientRect();return b.left>=box.left&&b.right<=box.right;});}')
    page.locator('.settings-preview').scroll_into_view_if_needed()
    page.screenshot(path=str(ARTIFACTS / f'{engine}-narrow-preview.png'))
    page.get_by_role('button', name='完成设置').click()
    page.set_viewport_size({'width': 844, 'height': 390})
    page.wait_for_timeout(180)
    page.get_by_role('button', name='开始', exact=True).click()
    fast_samples = sample_motion(page, 800)
    assert fast_samples[-1]['position'] > fast_samples[0]['position']
    for previous, current in zip(fast_samples, fast_samples[1:]):
        delta = min(0.1, (current['time'] - previous['time']) / 1000)
        assert abs(current['position'] - previous['position'] - 1600 / 60 * delta) < 0.2
    (ARTIFACTS / f'{engine}-fast-motion-samples.json').write_text(json.dumps(fast_samples), encoding='utf-8')
    page.get_by_role('button', name='阅读设置', exact=True).click()
    paused = position(page)
    page.wait_for_timeout(200)
    assert position(page) == paused
    page.screenshot(path=str(ARTIFACTS / f'{engine}-multiline-settings.png'))
    page.get_by_role('button', name='恢复默认').click()
    page.get_by_role('button', name='完成设置').click()
    expect(page.get_by_role('button', name='开始', exact=True)).to_be_visible()
    page.get_by_role('button', name='前进一页').click()
    after = position(page)
    page.get_by_role('button', name='后退一页').click()
    assert position(page) < after
    page.get_by_role('button', name='返回书架').click()
    page.set_viewport_size({'width': 390, 'height': 844})
    upload(page, '短文.txt', '甲。\n乙。'.encode())
    close_import(page)
    page.get_by_role('button', name='阅读《短文》', exact=True).click()
    page.get_by_role('button', name='开始', exact=True).click()
    expect(page.get_by_role('button', name='重新阅读', exact=True)).to_be_visible(timeout=5000)
    expect(page.get_by_role('button', name='前进一页')).to_be_disabled()
    page.get_by_role('button', name='重新阅读', exact=True).click()
    page.get_by_role('button', name='停止', exact=True).click()
    assert position(page) < 3
    assert_reader_layout(page)
    expect(page.locator('.reading-band')).to_have_attribute('data-total', '2')
    page.get_by_role('button', name='返回书架').click()
    upload(page, '密集标点.txt', '“甲”，……！！\n（乙）？！'.encode())
    close_import(page)
    page.get_by_role('button', name='阅读《密集标点》', exact=True).click()
    for mode in ['语义段落', '紧凑排列', '无标点密排']:
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.get_by_role('button', name=mode, exact=True).click()
        page.locator('#cursor-words').fill('10')
        page.get_by_role('button', name='完成设置').click()
        expect(page.locator('.reading-band')).to_have_attribute('data-total', '2')
        if mode == '无标点密排':
            expect(page.locator('.flowing-text')).to_have_text('甲乙')
        else:
            assert page.locator('.reading-glyph[data-word="-1"]').count() > 0
        print(f'CHECK {engine}: punctuation timing / {mode}', flush=True)
        timing = page.evaluate('''() => new Promise((resolve,reject) => {
            const button=document.querySelector('.play-button'), started=performance.now();
            const samples=[];
            let animation;
            const timeout=setTimeout(()=>{
                cancelAnimationFrame(animation);
                reject(new Error(JSON.stringify({reason:'reading timeout',hidden:document.hidden,
                    button:button.getAttribute('aria-label'),disabled:button.disabled,
                    band:{...document.querySelector('.reading-band').dataset}})));
            },5000);
            button.click();
            const tick=time=>{
                const position=Number(document.querySelector('.reading-band').dataset.position);
                samples.push({time,position});
                if(position===2){clearTimeout(timeout);resolve({elapsed:performance.now()-started,samples});}
                else animation=requestAnimationFrame(tick);
            };
            animation=requestAnimationFrame(tick);
        })''')
        assert timing['elapsed'] >= 450, (mode, timing)
        assert timing['samples'][-1]['position'] == 2
        for previous, current in zip(timing['samples'], timing['samples'][1:]):
            if previous['position'] == 0:
                continue
            delta = min(0.1, (current['time'] - previous['time']) / 1000)
            assert current['position'] >= previous['position']
            assert abs(current['position'] - min(2, previous['position'] + 4 * delta)) < 0.2, (mode, previous, current)
        if timing['elapsed'] > 950:
            print(f'NOTE {engine}: slow rendering ({timing["elapsed"]}ms); verified frame-clock timing, not real-device FPS', flush=True)
    page.get_by_role('button', name='返回书架').click()
    upload(page, '仅标点.txt', '……，。！？'.encode())
    close_import(page)
    page.get_by_role('button', name='阅读《仅标点》', exact=True).click()
    expect(page.get_by_role('button', name='开始', exact=True)).to_be_disabled()
    expect(page.locator('.line-counter')).to_contain_text('没有可计数的文字')
    expect(page.locator('.scan-cursor')).to_be_hidden()
    page.get_by_role('button', name='返回书架').click()
    print(f'PASS {engine}: continuous pointer/direct line switch, stable DOM rows, punctuation-free timing, 1/5/10-word windows, three layouts, resume, orientation, 1600 chars/min, completion/restart')


def assert_pagination(page, engine):
    page.set_viewport_size({'width': 1440, 'height': 1060})
    upload(page, '分页测试.txt', ('甲乙丙丁戊己庚辛壬癸' * 1000).encode())
    close_import(page)
    page.get_by_role('button', name='阅读《分页测试》', exact=True).click()
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='恢复默认').click()
    page.get_by_role('button', name='无标点密排', exact=True).click()
    page.locator('#font-size').fill('12')
    page.locator('#max-lines').fill('15')
    page.locator('#cursor-words').fill('50')
    page.locator('#cursor-thickness').fill('3')
    page.locator('#cursor-transparent').check()
    expect(page.get_by_label('下划线颜色', exact=True)).to_be_disabled()
    expect(page.locator('.preview-underline')).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
    expect(page.locator('.settings-preview')).to_contain_text('预览仅示意10字')
    page.get_by_role('button', name='完成设置').click()
    band = page.locator('.reading-band')
    assert_reader_layout(page)
    expect(band).to_have_css('font-size', '12px')
    expect(band).to_have_attribute('data-visible-lines', '15')
    expect(band).to_have_attribute('data-cursor-words', '50')
    expect(page.locator('.scan-cursor')).to_have_attribute('data-span', '50')
    expect(page.locator('.scan-cursor')).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
    expect(page.locator('.is-current > span')).to_have_css('transform', 'none')
    assert page.locator('.is-current > span').evaluate('(e)=>getComputedStyle(e).color') == band.evaluate('(e)=>getComputedStyle(e).color')
    page.get_by_role('button', name='前进一页').click()
    expect(band).to_have_attribute('data-row', '15')
    expect(band).to_have_attribute('data-page', '2')
    page.get_by_role('button', name='后退一页').click()
    expect(band).to_have_attribute('data-page', '1')
    expect(page.get_by_role('button', name='后退一页')).to_be_disabled()
    total = int(band.get_attribute('data-pages'))
    for invalid in ['0', '-1', '1.5', str(total + 1), '']:
        before = position(page)
        page.get_by_label('跳转页码').fill(invalid)
        page.get_by_role('button', name='跳转', exact=True).click()
        assert position(page) == before
        assert not page.get_by_label('跳转页码').evaluate('(e)=>e.checkValidity()')
    page.get_by_label('跳转页码').fill(str(total))
    page.get_by_role('button', name='跳转', exact=True).click()
    expect(band).to_have_attribute('data-page', str(total))
    expect(band).to_have_attribute('data-row', str((total - 1) * 15))
    expect(page.get_by_role('button', name='前进一页')).to_be_disabled()
    page.get_by_label('跳转页码').fill('3')
    page.get_by_label('跳转页码').press('Enter')
    expect(band).to_have_attribute('data-row', '30')
    page.get_by_role('button', name='开始', exact=True).click()
    page.wait_for_timeout(250)
    page.get_by_label('跳转页码').focus()
    stopped = position(page)
    page.wait_for_timeout(150)
    assert position(page) == stopped
    page.get_by_label('跳转页码').fill('2')
    page.get_by_role('button', name='跳转', exact=True).click()
    expect(page.get_by_role('button', name='开始', exact=True)).to_be_visible()
    page.locator('.reader-book-name').click()
    page.keyboard.press('ArrowRight')
    expect(band).to_have_attribute('data-page', '3')
    page.keyboard.press('ArrowLeft')
    expect(band).to_have_attribute('data-page', '2')
    saved = position(page)
    source = float(band.get_attribute('data-source'))
    page.get_by_role('button', name='返回书架').click()
    page.reload()
    page.get_by_role('button', name='继续阅读', exact=True).click()
    assert abs(position(page) - saved) < 0.0001
    expect(band).to_have_attribute('data-page', '2')
    expect(page.locator('.scan-cursor')).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
    page.get_by_role('button', name='阅读设置', exact=True).click()
    expect(page.locator('#font-size')).to_have_value('12')
    expect(page.locator('#max-lines')).to_have_value('15')
    expect(page.locator('#cursor-words')).to_have_value('50')
    expect(page.locator('#cursor-transparent')).to_be_checked()
    page.locator('#cursor-transparent').uncheck()
    expect(page.get_by_label('下划线颜色', exact=True)).to_be_enabled()
    expect(page.locator('#cursor-thickness')).to_have_value('3')
    page.get_by_role('button', name='完成设置').click()
    expect(page.locator('.scan-cursor')).to_have_css('background-color', 'rgb(123, 146, 89)')
    pages_before = band.get_attribute('data-pages')
    for thickness in ['1', '6']:
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.locator('#cursor-thickness').fill(thickness)
        expect(page.locator('.preview-underline')).to_have_css('height', thickness + 'px')
        page.get_by_role('button', name='完成设置').click()
        expect(page.locator('.scan-cursor')).to_have_css('height', thickness + 'px')
        expect(band).to_have_attribute('data-pages', pages_before)
        assert abs(float(band.get_attribute('data-source')) - source) < 0.0001
        assert_reader_layout(page)
    for width, height in [(390, 844), (844, 390), (320, 568)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(200)
        assert_reader_layout(page)
        assert abs(float(band.get_attribute('data-source')) - source) < 0.0001
        rows = int(band.get_attribute('data-rows'))
        size = int(band.get_attribute('data-visible-lines'))
        row = int(band.get_attribute('data-row'))
        expect(band).to_have_attribute('data-page', str(row // size + 1))
        expect(band).to_have_attribute('data-pages', str((rows + size - 1) // size))
        assert int(page.locator('.scan-cursor').get_attribute('data-span')) <= min(50, int(band.get_attribute('data-columns')))
        page.screenshot(path=str(ARTIFACTS / f'{engine}-pagination-{width}.png'))
    page.get_by_role('button', name='返回书架').click()
    upload(page, '标点分页.txt', '甲乙\n丙丁\n！！\n？？\n戊己\n庚辛\n。。\n……'.encode())
    close_import(page)
    page.get_by_role('button', name='阅读《标点分页》', exact=True).click()
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='语义段落', exact=True).click()
    page.locator('#max-lines').fill('2')
    page.get_by_role('button', name='完成设置').click()
    expect(band).to_have_attribute('data-pages', '4')
    for target in [2, 3, 4, 1]:
        page.get_by_label('跳转页码').fill(str(target))
        page.get_by_role('button', name='跳转', exact=True).click()
        expect(band).to_have_attribute('data-page', str(target))
        expect(band).to_have_attribute('data-row', str((target - 1) * 2))
    page.get_by_label('跳转页码').fill('4')
    page.get_by_role('button', name='跳转', exact=True).click()
    page.get_by_role('button', name='返回书架').click()
    page.reload()
    page.get_by_role('button', name='继续阅读', exact=True).click()
    expect(band).to_have_attribute('data-page', '4')
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='恢复默认').click()
    expect(page.locator('#cursor-transparent')).not_to_be_checked()
    expect(page.locator('#cursor-words')).to_have_value('1')
    page.get_by_role('button', name='完成设置').click()
    page.get_by_role('button', name='返回书架').click()
    print(f'PASS {engine}: 12px/15 lines/50 words, underline colors/thickness/transparency, no text scaling, compact header/footer, page count/jump/bounds, pause/resume, responsive repagination, punctuation-only pages', flush=True)


def sample_trails(page, duration=0):
    return page.evaluate('''duration => new Promise(resolve=>{
        const samples=[]; let started;
        const tick=time=>{
            started??=time;
            const band=document.querySelector('.reading-band');
            const position=Number(band.dataset.position), cell=Number(band.dataset.cellWidth);
            const rows=[...document.querySelectorAll('.reading-row')].map(row=>{
                const glyphs=[...row.querySelectorAll('.reading-glyph')];
                const line=row.querySelector('.reading-trail'), box=line.getBoundingClientRect();
                const expected=Math.min(glyphs.length,Math.max(0,position-Number(glyphs[0].dataset.word)))*cell;
                const start=glyphs[0].getBoundingClientRect(), end=glyphs.at(-1).getBoundingClientRect();
                return {row:Number(row.dataset.row),width:parseFloat(line.style.width),expected,
                    below:line.hidden||box.top>=glyphs[0].firstElementChild.getBoundingClientRect().bottom+1,
                    bounded:line.hidden||(box.left>=start.left-1&&box.right<=end.right+1),
                    height:parseFloat(line.style.height),hidden:line.hidden};
            });
            samples.push({time,position,row:Number(band.dataset.row),rows});
            if(time-started>=duration)resolve(samples);else requestAnimationFrame(tick);
        };requestAnimationFrame(tick);
    })''', duration)


def assert_trail_modes(page, engine):
    page.set_viewport_size({'width': 390, 'height': 844})
    upload(page, '双模式测试.txt', ('甲乙丙丁戊己庚辛壬癸' * 400).encode())
    close_import(page)
    page.get_by_role('button', name='阅读《双模式测试》', exact=True).click()
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='恢复默认').click()
    expect(page.get_by_role('button', name='指读', exact=True)).to_have_attribute('aria-pressed', 'true')
    page.get_by_role('button', name='无标点密排', exact=True).click()
    page.locator('#font-size').fill('28')
    page.locator('#max-lines').fill('6')
    page.locator('#cursor-words').fill('5')
    page.locator('#cursor-thickness').fill('3')
    page.locator('#reading-speed').fill('600')
    page.get_by_role('button', name='划线留痕', exact=True).click()
    expect(page.locator('#cursor-words')).to_be_disabled()
    page.get_by_role('button', name='完成设置').click()
    band = page.locator('.reading-band')
    expect(band).to_have_attribute('data-cursor-mode', 'trail')
    assert_reader_layout(page)
    assert all(row['width'] == 0 for row in sample_trails(page)[0]['rows'])
    page.get_by_role('button', name='开始', exact=True).click()
    cols = int(band.get_attribute('data-columns'))
    frames = sample_trails(page, max(3000, cols * 280))
    page.get_by_role('button', name='停止', exact=True).click()
    assert frames[-1]['row'] >= frames[0]['row'] + 2
    assert any(any(row['width'] > 0 for row in frame['rows']) for frame in frames)
    for frame in frames:
        assert len(frame['rows']) <= 11
        for row in frame['rows']:
            assert abs(row['width'] - row['expected']) < 0.02, (engine, frame)
            assert row['below'] and row['bounded'] and row['height'] == 3, (engine, frame)
    (ARTIFACTS / f'{engine}-trail-frames.json').write_text(json.dumps(frames), encoding='utf-8')
    before = sample_trails(page)[0]
    page.wait_for_timeout(180)
    assert sample_trails(page)[0]['rows'] == before['rows']
    source = band.get_attribute('data-source')
    page.screenshot(path=str(ARTIFACTS / f'{engine}-trail-mode.png'))
    page.get_by_role('button', name='返回书架').click()
    page.reload()
    page.get_by_role('button', name='继续阅读', exact=True).click()
    expect(band).to_have_attribute('data-source', source)
    expect(band).to_have_attribute('data-cursor-mode', 'trail')
    assert sample_trails(page)[0]['rows'] == before['rows']
    page.get_by_role('button', name='阅读设置', exact=True).click()
    expect(page.get_by_role('button', name='划线留痕', exact=True)).to_have_attribute('aria-pressed', 'true')
    page.get_by_role('button', name='指读', exact=True).click()
    expect(page.locator('#cursor-words')).to_be_enabled()
    expect(page.locator('#cursor-words')).to_have_value('5')
    page.get_by_role('button', name='完成设置').click()
    expect(band).to_have_attribute('data-source', source)
    expect(page.locator('.reading-trail:not([hidden])')).to_have_count(0)
    expect(page.locator('.scan-cursor')).to_be_visible()
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='划线留痕', exact=True).click()
    page.get_by_role('button', name='完成设置').click()
    assert sample_trails(page)[0]['rows'] == before['rows']
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#cursor-transparent').check()
    page.get_by_role('button', name='完成设置').click()
    expect(page.locator('.reading-trail:not([hidden])').first).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
    assert sample_trails(page)[0]['rows'] == before['rows']
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#cursor-transparent').uncheck()
    page.get_by_label('下划线颜色', exact=True).fill('#e5b77b')
    page.locator('#cursor-thickness').fill('6')
    page.get_by_role('button', name='完成设置').click()
    expect(page.locator('.reading-trail:not([hidden])').first).to_have_css('background-color', 'rgb(229, 183, 123)')
    for width, height in [(844, 390), (320, 568), (390, 844)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(220)
        assert_reader_layout(page)
        expect(band).to_have_attribute('data-source', source)
        for row in sample_trails(page)[0]['rows']:
            assert abs(row['width'] - row['expected']) < 0.02
            assert row['below'] and row['bounded'] and row['height'] == 6
    for mode in ['语义段落', '紧凑排列', '无标点密排']:
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.get_by_role('button', name=mode, exact=True).click()
        page.get_by_role('button', name='完成设置').click()
        expect(band).to_have_attribute('data-source', source)
        assert_reader_layout(page)
    for target in ['30', '2', '1']:
        page.get_by_label('跳转页码').fill(target)
        page.get_by_role('button', name='跳转', exact=True).click()
        expect(band).to_have_attribute('data-page', target)
        for row in sample_trails(page)[0]['rows']:
            assert abs(row['width'] - row['expected']) < 0.02
        assert page.locator('.reading-trail').count() <= 11
    expect(page.locator('.reading-trail:not([hidden])')).to_have_count(0)
    page.get_by_role('button', name='返回书架').click()
    upload(page, '留痕短书.txt', '甲，乙。\n！！'.encode())
    close_import(page)
    page.get_by_role('button', name='阅读《留痕短书》', exact=True).click()
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='语义段落', exact=True).click()
    page.get_by_role('button', name='完成设置').click()
    page.get_by_role('button', name='开始', exact=True).click()
    expect(page.get_by_role('button', name='重新阅读')).to_be_visible()
    assert page.locator('.reading-trail:not([hidden])').count() == page.locator('.reading-row').count()
    page.screenshot(path=str(ARTIFACTS / f'{engine}-trail-completed.png'))
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#reading-speed').fill('30')
    page.get_by_role('button', name='完成设置').click()
    page.get_by_role('button', name='重新阅读').click()
    page.get_by_role('button', name='停止', exact=True).click()
    assert page.locator('.reading-trail:not([hidden])').count() <= 1
    assert position(page) < 1
    page.get_by_role('button', name='返回书架').click()
    print(f'PASS {engine}: pointer/trail, no return flight, retained per-row ink, rewind/restart/reflow/reload, colors/transparency, bounded buffers', flush=True)


def main():
    with sync_playwright() as p:
        for engine in [p.chromium, p.webkit]:
            browser = engine.launch(headless=True)
            context = browser.new_context(**(p.devices['iPhone 13'] if engine == p.webkit else {'viewport': {'width': 1440, 'height': 1060}}))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(URL)
            page.wait_for_load_state('networkidle')
            expect(page.locator('.book-card')).to_have_count(3)
            page.get_by_role('button', name='阅读《山间的一日》', exact=True).click()
            assert_reader_layout(page)
            page.screenshot(path=str(ARTIFACTS / f'{engine.name}-reader-default.png'))
            expect(page.get_by_role('button', name='后退一页')).to_be_disabled()
            page.get_by_role('button', name='前进一页').click()
            expect(page.locator('.reading-band')).to_have_attribute('data-page', '2')
            page.get_by_role('button', name='后退一页').click()
            expect(page.locator('.reading-band')).to_have_attribute('data-page', '1')
            expect(page.locator('.reader-mode-info, .focus-toggle, .reader-footer, .reader-hint')).to_have_count(0)
            page.get_by_role('button', name='返回书架').click()
            for name, data in [('溪边.txt', '溪边第一行。\n溪边第二行。'.encode()), ('竹林.docx', docx_bytes()), ('英文.pdf', pdf_bytes()), ('中文.pdf', pdf_bytes('山中清风，流水静好。', chinese=True))]:
                upload(page, name, data)
                close_import(page)
            expect(page.locator('.book-card')).to_have_count(7)
            page.get_by_role('button', name='阅读《竹林》', exact=True).click()
            expect(page.locator('.flowing-text')).to_contain_text('文档的第一行')
            expect(page.locator('.paragraph-start')).to_have_count(2)
            page.get_by_role('button', name='返回书架').click()
            upload(page, '重复.txt', '溪边第一行。\n溪边第二行。'.encode(), False)
            expect(page.locator('.import-results')).to_contain_text('相同内容')
            close_import(page)
            upload(page, '旧格式.doc', b'legacy', False)
            expect(page.locator('.import-results')).to_contain_text('另存为 .docx')
            close_import(page)
            upload(page, '扫描.pdf', pdf_bytes(blank=True), False)
            expect(page.locator('.import-results')).to_contain_text('OCR')
            close_import(page)
            upload(page, '安全.txt', b'<img src=x onerror=window.unsafe=true>')
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
            page.evaluate('async () => { await navigator.serviceWorker.ready; }')
            page.reload()
            page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=30000)
            if engine.name == 'chromium':
                context.set_offline(True)
                page.reload()
                expect(page.locator('.book-card')).to_have_count(7)
                upload(page, '离线.pdf', pdf_bytes('Offline import remains private.'))
                close_import(page)
                page.get_by_role('button', name='阅读《离线》', exact=True).click()
                expect(page.locator('.flowing-text')).to_contain_text('Offline')
                context.set_offline(False)
                page.get_by_role('button', name='返回书架').click()
                print('PASS Chromium PWA offline reload and PDF import')
            else:
                print('SKIP Windows WebKit offline=True PWA reload: internal navigation error; native_offline.py separately validates bundled-resource-only loading')
            try:
                assert_guided_reading(page, engine.name)
                assert_pagination(page, engine.name)
                assert_trail_modes(page, engine.name)
                assert not errors, errors
            except Exception:
                page.screenshot(path=str(ARTIFACTS / f'{engine.name}-failure.png'))
                print(json.dumps({'engine': engine.name, 'page_errors': errors}, ensure_ascii=False), flush=True)
                raise
            print(f'PASS {engine.name}: TXT/DOCX/PDF/CJK PDF, duplicates, errors, XSS, rename/delete')
            context.close()
            browser.close()
    print(json.dumps({'status': 'passed', 'screenshots': str(ARTIFACTS)}, ensure_ascii=False))


if __name__ == '__main__':
    from datetime import datetime, timezone

    result_path = ARTIFACTS / 'e2e-result.json'
    result = {'status': 'running', 'started': datetime.now(timezone.utc).isoformat()}
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    try:
        main()
    except Exception as error:
        result.update(status='failed', error=str(error))
        raise
    else:
        result.update(status='passed', browsers=['chromium', 'webkit'], skipped=['Windows WebKit offline=True PWA reload'])
    finally:
        result['finished'] = datetime.now(timezone.utc).isoformat()
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
