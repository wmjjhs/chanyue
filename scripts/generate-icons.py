# 版权所有：波哥
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
svg = (root / 'public/icon.svg').read_text(encoding='utf-8')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(device_scale_factor=1)
    for size, path in [(180, root / 'public/apple-touch-icon.png'), (1024, root / 'public/app-icon.png')]:
        page.set_viewport_size({'width': size, 'height': size})
        page.set_content('<html><head><style>html,body{margin:0;width:100%;height:100%;background:#536550}svg{display:block;width:100%;height:100%}</style></head><body>' + svg + '</body></html>')
        page.screenshot(path=str(path), omit_background=False)
        assert path.is_file(), str(path)
        print(f'Generated {path.name}: {path.stat().st_size} bytes')
    browser.close()
