# 版权所有：波哥
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import expect, sync_playwright
from android_bridge import MOCK, HEADERS

ROOT = Path(__file__).resolve().parents[1]
METRICS = '''d => {
  const style = getComputedStyle(d), box = d.getBoundingClientRect();
  const rects = selector => [...d.querySelectorAll(selector)].map(e => e.getBoundingClientRect());
  const fonts = rects('.font-options button'), themes = rects('.theme-options > button');
  const label = d.querySelector('.transparent-setting'), input = label.querySelector('input');
  const text = document.createRange(); text.selectNodeContents(label); text.setStartAfter(input);
  const backdrop = getComputedStyle(d, '::backdrop');
  return { background: style.backgroundColor, opacity: style.opacity, width: box.width,
    fontWidths: fonts.map(b => b.width), sameRow: fonts.every(b => Math.abs(b.top - fonts[0].top) < 1),
    fontGap: fonts[1].left - fonts[0].right, themeGap: themes[1].left - themes[0].right,
    checkboxGap: text.getBoundingClientRect().left - input.getBoundingClientRect().right,
    blur: backdrop.getPropertyValue('backdrop-filter') || backdrop.getPropertyValue('-webkit-backdrop-filter'),
    overflow: d.scrollWidth > d.clientWidth + 1,
    colorWidths: rects('.color-options > label').map(b => b.width),
    checkboxAppearance: getComputedStyle(input).getPropertyValue('-webkit-appearance'),
    sliderAppearance: getComputedStyle(d.querySelector('input[type="range"]')).getPropertyValue('-webkit-appearance') };
}'''


def main():
    bundle = (ROOT / 'dist-native').resolve()
    script = (ROOT / 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js').read_text(encoding='utf-8')
    output = ROOT / 'artifacts/settings-layout'
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    with sync_playwright() as p:
        for name in ['chromium', 'webkit']:
            browser = getattr(p, name).launch(headless=True)
            results[name] = {}
            for width, height in [(320, 568), (360, 780), (390, 844), (844, 390), (1024, 768)]:
                key = f'{width}x{height}'
                context = browser.new_context(viewport={'width': width, 'height': height}, service_workers='block')
                errors = []
                def resource(route):
                    parsed = urlparse(route.request.url)
                    path = (bundle / (unquote(parsed.path).lstrip('/') or 'index.html')).resolve()
                    if parsed.hostname != 'localhost' or not path.is_relative_to(bundle) or not path.is_file():
                        errors.append('Unexpected network request'); route.abort(); return
                    mime = {'.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm'}.get(path.suffix)
                    route.fulfill(body=path.read_bytes(), content_type=mime or mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
                context.route('**/*', resource)
                context.add_init_script(MOCK + '\n' + script + '\n' + HEADERS)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    page.goto('https://localhost'); page.wait_for_load_state('networkidle')
                    (page.get_by_role('button', name='设置', exact=True) if width <= 760 else page.locator('.sidebar').get_by_role('button', name='阅读设置', exact=True)).click()
                    dialog = page.get_by_role('dialog', name='找到你的阅读节奏')
                    expect(dialog).to_be_visible()
                    metrics = dialog.evaluate(METRICS)
                    assert metrics['background'] == 'rgb(252, 252, 248)' and metrics['opacity'] == '1', metrics
                    assert metrics['blur'] == 'blur(5px)', metrics
                    assert metrics['sameRow'] and not metrics['overflow'], metrics
                    assert max(metrics['fontWidths']) - min(metrics['fontWidths']) < 1, metrics
                    assert max(metrics['colorWidths']) - min(metrics['colorWidths']) < 1, metrics
                    assert abs(metrics['fontGap'] - 10) < 1 and abs(metrics['themeGap'] - (13 if width <= 760 else 15)) < 1, metrics
                    assert metrics['checkboxGap'] >= 8, metrics
                    assert metrics['checkboxAppearance'] == 'none' and metrics['sliderAppearance'] == 'none', metrics
                    page.screenshot(path=str(output / f'{name}-{key}-top.png'))
                    page.get_by_role('button', name='楷体 笔墨之间').click()
                    expect(page.get_by_role('button', name='楷体 笔墨之间')).to_have_attribute('aria-pressed', 'true')
                    slider = page.get_by_role('slider', name='字体大小')
                    slider.fill('34'); expect(slider).to_have_value('34')
                    assert slider.evaluate("e => parseFloat(e.style.getPropertyValue('--range-fill'))") > 0
                    slider.focus(); page.keyboard.press('ArrowRight'); expect(slider).to_have_value('35')
                    checkbox = page.get_by_label('透明（隐藏下划线）')
                    checkbox.check(); expect(checkbox).to_be_checked()
                    checkbox.uncheck(); expect(checkbox).not_to_be_checked()
                    page.get_by_role('button', name='月白', exact=True).click()
                    expect(page.get_by_role('button', name='月白', exact=True)).to_have_attribute('aria-pressed', 'true')
                    finish = page.get_by_role('button', name='完成设置', exact=True)
                    finish.scroll_into_view_if_needed()
                    page.screenshot(path=str(output / f'{name}-{key}-bottom.png'))
                    finish.click(); expect(dialog).to_have_count(0)
                    page.reload(); page.wait_for_load_state('networkidle')
                    (page.get_by_role('button', name='设置', exact=True) if width <= 760 else page.locator('.sidebar').get_by_role('button', name='阅读设置', exact=True)).click()
                    expect(page.get_by_role('slider', name='字体大小')).to_have_value('35')
                    expect(page.get_by_role('button', name='楷体 笔墨之间')).to_have_attribute('aria-pressed', 'true')
                    expect(page.get_by_role('button', name='月白', exact=True)).to_have_attribute('aria-pressed', 'true')
                    page.get_by_role('button', name='关闭弹窗', exact=True).click()
                    expect(dialog).to_have_count(0)
                    assert not errors, errors
                    results[name][key] = metrics
                    print('PASS settings layout, controls and persistence', name, key, flush=True)
                finally:
                    context.close()
            browser.close()
    for key, chrome in results['chromium'].items():
        safari = results['webkit'][key]
        for prop in ['width', 'fontGap', 'themeGap', 'checkboxGap']:
            assert abs(chrome[prop] - safari[prop]) < 1, (key, prop, chrome[prop], safari[prop])
        assert all(abs(a - b) < 1 for a, b in zip(chrome['fontWidths'], safari['fontWidths'])), key
    (output / 'results.json').write_text(json.dumps({'status': 'passed', 'engines': results}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS Chromium/WebKit settings geometry parity')


if __name__ == '__main__':
    main()
