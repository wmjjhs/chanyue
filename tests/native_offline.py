# 版权所有：波哥
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright, expect
from e2e import docx_bytes, pdf_bytes, assert_reader_layout
from comfort import install_audio_probe, assert_ambience, assert_fade, active_count

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'dist-native'
ORIGIN = 'https://chanyue-offline.invalid'


def main():
    with sync_playwright() as p:
        for engine in [p.chromium, p.webkit]:
            browser = engine.launch(headless=True)
            context = browser.new_context(**p.devices['iPhone 13'], service_workers='block', offline=engine.name == 'chromium')
            external = []
            missing = []
            errors = []
            requested = []

            def bundled_resource(route):
                parsed = urlparse(route.request.url)
                if parsed.hostname != 'chanyue-offline.invalid':
                    external.append(route.request.url)
                    route.abort()
                    return
                relative = unquote(parsed.path).lstrip('/') or 'index.html'
                target = (BUNDLE / relative).resolve()
                if not target.is_relative_to(BUNDLE.resolve()) or not target.is_file():
                    missing.append(relative)
                    route.abort()
                    return
                requested.append(relative)
                mime = {'.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream'}.get(target.suffix)
                route.fulfill(body=target.read_bytes(), content_type=mime or mimetypes.guess_type(str(target))[0] or 'application/octet-stream')

            context.route('**/*', bundled_resource)
            install_audio_probe(context)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(ORIGIN)
            page.wait_for_load_state('networkidle')
            expect(page.locator('.book-card')).to_have_count(3)
            if engine.name == 'chromium':
                assert page.evaluate('navigator.onLine') is False
            for name, data in [
                ('离线文本.txt', ('甲乙丙丁戊己庚辛壬癸' * 3000).encode()),
                ('离线文档.docx', docx_bytes()),
                ('离线中文.pdf', pdf_bytes('完全离线，文字仍然流动。', chinese=True)),
            ]:
                page.get_by_role('navigation', name='手机导航').get_by_role('button', name='导入', exact=True).click()
                page.locator('input[type=file]').set_input_files({'name': name, 'mimeType': 'application/octet-stream', 'buffer': data})
                expect(page.locator('.import-results li')).to_have_class('success', timeout=40000)
                page.get_by_role('button', name='回书架，开始阅读').click()
            expect(page.locator('.book-card')).to_have_count(6)
            page.get_by_role('button', name='阅读《离线文本》', exact=True).click()
            assert_ambience(page, engine.name + ' bundled offline')
            assert_fade(page, engine.name + '-native')
            page.get_by_role('button', name='阅读设置', exact=True).click()
            page.get_by_role('button', name='恢复默认', exact=True).click()
            page.get_by_role('button', name='完成设置').click()
            page.get_by_role('button', name='返回书架').click()
            page.get_by_role('button', name='阅读《离线中文》', exact=True).click()
            expect(page.locator('.flowing-text')).to_contain_text('完全离线')
            assert_reader_layout(page)
            page.get_by_role('button', name='阅读设置', exact=True).click()
            page.get_by_role('button', name='无标点密排', exact=True).click()
            page.locator('#cursor-words').fill('50')
            page.locator('#font-size').fill('12')
            page.locator('#max-lines').fill('30')
            page.locator('#cursor-row').fill('18')
            page.get_by_label('下划线颜色', exact=True).fill('#e5b77b')
            page.locator('#cursor-thickness').fill('6')
            page.get_by_role('button', name='划线留痕', exact=True).click()
            for key, value in [('trailCurrent', '80'), ('trailRecent', '45'), ('trailMinimum', '0'), ('trail-fade-lines', '7'), ('trail-fade-duration', '0.7'), ('ambient-volume', '0')]:
                page.locator('#' + key).fill(value)
            page.locator('#ambient-enabled').check()
            page.locator('#ambient-continue').uncheck()
            page.get_by_role('button', name='微风', exact=True).click()
            page.get_by_role('button', name='完成设置').click()
            page.get_by_role('button', name='开始', exact=True).click()
            page.wait_for_timeout(250)
            page.get_by_role('button', name='停止', exact=True).click()
            source = float(page.locator('.reading-band').get_attribute('data-source'))
            trail_widths = page.locator('.reading-trail').evaluate_all('(nodes)=>nodes.map(e=>e.style.width)')
            assert any(float(width[:-2]) > 0 for width in trail_widths)
            page.get_by_role('button', name='返回书架').click()
            page.reload()
            expect(page.locator('.book-card')).to_have_count(6)
            page.get_by_role('button', name='继续阅读', exact=True).click()
            expect(page.locator('.flowing-text')).to_contain_text('完全离线')
            assert abs(float(page.locator('.reading-band').get_attribute('data-source')) - source) < 0.0001
            expect(page.locator('.reading-band')).to_have_attribute('data-mode', 'plain')
            expect(page.locator('.reading-band')).to_have_attribute('data-cursor-words', '50')
            expect(page.locator('.reading-band')).to_have_attribute('data-max-lines', '30')
            expect(page.locator('.reading-band')).to_have_attribute('data-requested-cursor-row', '18')
            visible = int(page.locator('.reading-band').get_attribute('data-visible-lines'))
            expect(page.locator('.reading-band')).to_have_attribute('data-cursor-row', str(min(18, visible)))
            expect(page.locator('.reading-band')).to_have_css('font-size', '12px')
            expect(page.locator('.reading-band')).to_have_attribute('data-cursor-mode', 'trail')
            expect(page.locator('.scan-cursor')).to_be_hidden()
            expect(page.locator('.reading-trail').first).to_have_css('background-color', 'rgb(229, 183, 123)')
            expect(page.locator('.reading-trail').first).to_have_css('height', '6px')
            assert page.locator('.reading-trail').evaluate_all('(nodes)=>nodes.map(e=>e.style.width)') == trail_widths
            expect(page.locator('.is-current > span')).to_have_css('transform', 'none')
            expect(page.locator('.reading-glyph[data-word="-1"]')).to_have_count(0)
            assert active_count(page) == 0
            page.get_by_role('button', name='阅读设置', exact=True).click()
            for key, value in [('trailCurrent', '80'), ('trailRecent', '45'), ('trailMinimum', '0'), ('trail-fade-lines', '7'), ('trail-fade-duration', '0.7'), ('ambient-volume', '0')]:
                expect(page.locator('#' + key)).to_have_value(value)
            expect(page.locator('#ambient-enabled')).to_be_checked()
            expect(page.locator('#ambient-continue')).not_to_be_checked()
            expect(page.get_by_role('button', name='微风', exact=True)).to_have_attribute('aria-pressed', 'true')
            assert all(f'ambience/{sound}.wav' in requested for sound in ['rain', 'wind', 'stream']), requested
            assert not errors, errors
            assert not external, external
            assert not missing, missing
            assert any('pdf.worker' in path for path in requested), requested
            assert not any('sw.js' in path or 'registerSW' in path for path in requested)
            mode = 'offline=True' if engine.name == 'chromium' else 'all requests intercepted; non-bundled requests blocked'
            print(f'PASS {engine.name} ({mode}): fresh context, packaged files only, no server/SW, TXT/DOCX/CJK PDF, restart reading; native storage tested separately with plugin mocks')
            context.close()
            browser.close()


if __name__ == '__main__':
    main()
