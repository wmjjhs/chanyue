# 版权所有：波哥
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, expect
from e2e import upload, close_import, assert_reader_layout, position

ARTIFACTS = Path(__file__).resolve().parents[1] / 'artifacts'
PROBE = '''(() => {
    const Native = window.AudioContext;
    window.__audioContexts = [];
    if(typeof Native!=='function')return;
    window.AudioContext = class extends Native {
        constructor(...args) {
            super(...args); this.probeSources=[]; this.probeGains=[];
            window.__audioContexts.push(this);
        }
        createBufferSource() {
            const source=super.createBufferSource(), info={source,started:false,ended:false};
            this.probeSources.push(info);
            const start=source.start.bind(source);
            source.start=(...args)=>{info.started=true;return start(...args);};
            source.addEventListener('ended',()=>{info.ended=true;});
            return source;
        }
        createGain() {
            const gain=super.createGain(), ramp=gain.gain.linearRampToValueAtTime.bind(gain.gain);
            gain.probeFadeEnd=0;
            gain.gain.linearRampToValueAtTime=(value,end)=>{gain.probeFadeEnd=end;return ramp(value,end);};
            this.probeGains.push(gain);return gain;
        }
    };
})()'''


def install_audio_probe(context):
    context.add_init_script(PROBE)


def active_count(page):
    return page.evaluate('window.__audioContexts.reduce((n,c)=>n+(c.state==="running"?c.probeSources.filter(s=>s.started&&!s.ended).length:0),0)')


def wait_audio(page, active):
    page.wait_for_function('''active=>{
        const n=window.__audioContexts.reduce((n,c)=>n+(c.state==='running'?c.probeSources.filter(s=>s.started&&!s.ended).length:0),0);
        return active?n===1:n===0;
    }''', arg=active, timeout=15000)


def wait_audio_fade(page):
    page.wait_for_function('''()=>{
        const c=window.__audioContexts.at(-1),g=c?.probeGains.at(-1);
        return c?.state==='running'&&g&&c.currentTime>=g.probeFadeEnd+0.05;
    }''', timeout=15000)


def assert_ambience(page, engine, loop_check=False):
    page.get_by_role('button', name='阅读设置', exact=True).click()
    expect(page.locator('#ambient-enabled')).not_to_be_checked()
    expect(page.locator('#ambient-volume')).to_have_value('20')
    expect(page.locator('#ambient-continue')).to_be_checked()
    page.locator('#ambient-enabled').check()
    assert page.evaluate('window.__audioContexts.length') == 0
    page.get_by_role('button', name='完成设置').click()
    assert active_count(page) == 0
    before = position(page)
    page.get_by_role('button', name='开始', exact=True).click()
    if not page.evaluate('typeof window.AudioContext==="function"'):
        page.wait_for_timeout(300)
        assert position(page) > before
        page.get_by_role('button', name='阅读设置', exact=True).click()
        expect(page.locator('.ambient-status')).to_have_attribute('data-audio-state', 'error')
        page.locator('#ambient-enabled').uncheck()
        page.get_by_role('button', name='完成设置').click()
        for sound in ['rain', 'wind', 'stream']:
            data = page.evaluate('''async sound=>{
                const r=await fetch('/ambience/'+sound+'.wav'),b=new Uint8Array(await r.arrayBuffer());
                return {ok:r.ok,size:b.length,header:String.fromCharCode(...b.slice(0,4))};
            }''', sound)
            assert data == {'ok': True, 'size': 1058444, 'header': 'RIFF'}, data
        print(f'SKIP {engine}: real audio unavailable (no AudioContext); PASS error fallback keeps reading, all three WAV resources accessible', flush=True)
        return False
    wait_audio(page, True)
    page.get_by_role('button', name='停止', exact=True).click()
    for sound, name in [('rain', '柔雨'), ('wind', '微风'), ('stream', '流水')]:
        page.get_by_role('button', name='阅读设置', exact=True).click()
        page.get_by_role('button', name=name, exact=True).click()
        expect(page.locator('.ambient-status')).to_have_attribute('data-audio-state', 'playing', timeout=15000)
        wait_audio_fade(page)
        wait_audio(page, True)
        data = page.evaluate('''()=>{
            const c=window.__audioContexts.at(-1), s=c.probeSources.filter(s=>s.started&&!s.ended).at(-1).source;
            const a=s.buffer.getChannelData(0);let energy=0;for(let i=0;i<a.length;i++)energy+=a[i]*a[i];
            return {duration:s.buffer.duration,loop:s.loop,rms:Math.sqrt(energy/a.length),gain:c.probeGains.at(-1).gain.value};
        }''')
        assert data['duration'] == 24 and data['loop'] and 0.05 < data['rms'] < 0.2, data
        assert abs(data['gain'] - 0.2) < 0.01, (engine, sound, data)
        page.get_by_role('button', name='完成设置').click()
    if loop_check:
        start = page.evaluate('window.__audioContexts.at(-1).currentTime')
        sources = page.evaluate('window.__audioContexts.at(-1).probeSources.length')
        page.wait_for_function('start=>window.__audioContexts.at(-1).currentTime-start>=24.1', arg=start, timeout=35000)
        assert page.evaluate('window.__audioContexts.at(-1).probeSources.length') == sources
        wait_audio(page, True)
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#ambient-volume').fill('37')
    wait_audio_fade(page)
    assert abs(page.evaluate('window.__audioContexts.at(-1).probeGains.at(-1).gain.value') - 0.37) < 0.01
    page.locator('#ambient-volume').fill('0')
    wait_audio(page, False)
    page.locator('#ambient-volume').fill('20')
    wait_audio(page, True)
    page.locator('#ambient-continue').uncheck()
    wait_audio(page, False)
    page.get_by_role('button', name='完成设置').click()
    assert active_count(page) == 0
    page.get_by_role('button', name='开始', exact=True).click()
    wait_audio(page, True)
    page.get_by_role('button', name='停止', exact=True).click()
    wait_audio(page, False)
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#ambient-continue').check()
    wait_audio(page, True)
    page.get_by_role('button', name='完成设置').click()
    page.evaluate('window.dispatchEvent(new Event("pagehide"))')
    wait_audio(page, False)
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='柔雨', exact=True).click()
    assert active_count(page) == 0
    page.get_by_role('button', name='完成设置').click()
    page.get_by_role('button', name='开始', exact=True).click()
    wait_audio(page, True)
    page.get_by_role('button', name='返回书架').click()
    wait_audio(page, False)
    page.get_by_role('button', name='继续阅读', exact=True).click()
    assert active_count(page) == 0
    page.get_by_role('button', name='阅读设置', exact=True).click()
    expect(page.locator('#ambient-enabled')).to_be_checked()
    page.locator('#ambient-enabled').uncheck()
    page.get_by_role('button', name='完成设置').click()
    print(f'PASS {engine}: real Web Audio decoding/loop/gain, three sounds, pause preference, silent entry, simulated pagehide and shelf cleanup', flush=True)


def fade_sample(page, duration=0):
    return page.evaluate('''duration=>new Promise(resolve=>{
        const frames=[];let start;
        const tick=time=>{
            start??=time;const d=document.querySelector('.reading-band').dataset;
            const rows=[...document.querySelectorAll('.reading-row')].map(row=>{
                const line=row.querySelector('.reading-trail');return {row:Number(row.dataset.row),opacity:Number(line.style.opacity),width:line.style.width,hidden:line.hidden};
            });
            frames.push({position:Number(d.position),row:Number(d.row),cols:Number(d.columns),rows});
            if(time-start>=duration)resolve(frames);else requestAnimationFrame(tick);
        };requestAnimationFrame(tick);
    })''', duration)


def assert_fade(page, engine):
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.get_by_role('button', name='划线留痕', exact=True).click()
    page.get_by_role('button', name='无标点密排', exact=True).click()
    page.locator('#font-size').fill('28')
    page.locator('#max-lines').fill('10')
    page.locator('#cursor-row').fill('8')
    page.locator('#reading-speed').fill('600')
    expect(page.locator('#trail-fade')).to_be_checked()
    for key, value in [('trailCurrent', '100'), ('trailRecent', '65'), ('trailMinimum', '25')]:
        expect(page.locator('#'+key)).to_have_value(value)
    page.get_by_role('button', name='完成设置').click()
    page.get_by_label('跳转页码').fill('3')
    page.get_by_role('button', name='跳转', exact=True).click()
    page.get_by_role('button', name='开始', exact=True).click()
    frames = fade_sample(page, 3300)
    page.get_by_role('button', name='停止', exact=True).click()
    assert frames[-1]['row'] > frames[0]['row']
    def target(age):
        return 1 if age <= 0 else (65 - 40 * min(1, max(0, age-1) / 5)) / 100
    for frame in frames:
        elapsed = (frame['position'] - frame['row'] * frame['cols']) / 10
        t = min(1, max(0, elapsed) / 0.4)
        blend = t*t*(3-2*t)
        for row in frame['rows']:
            age = frame['row'] - row['row']
            expected = 1 if age <= 0 else target(age-1) + (target(age)-target(age-1))*blend
            assert abs(row['opacity']-expected) < 0.001, (frame, row, expected)
    snapshot = fade_sample(page)[0]
    page.wait_for_timeout(600)
    assert fade_sample(page)[0] == snapshot
    page.screenshot(path=str(ARTIFACTS / f'{engine}-fade-reading.png'))
    page.get_by_role('button', name='返回书架').click()
    page.reload()
    page.get_by_role('button', name='继续阅读', exact=True).click()
    assert fade_sample(page)[0] == snapshot
    before = position(page)
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#trailCurrent').fill('50')
    expect(page.locator('#trailRecent')).to_have_value('50')
    expect(page.locator('#trailMinimum')).to_have_attribute('max', '50')
    page.locator('#trailRecent').fill('35')
    page.locator('#trailMinimum').fill('0')
    page.locator('#trail-fade-lines').fill('1')
    page.locator('#trail-fade-duration').fill('0')
    page.screenshot(path=str(ARTIFACTS / f'{engine}-fade-settings.png'))
    page.get_by_role('button', name='完成设置').click()
    assert position(page) == before
    sample=fade_sample(page)[0]
    for row in sample['rows']:
        age=sample['row']-row['row']
        assert row['opacity'] == (0.5 if age <= 0 else 0.35 if age == 1 else 0)
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#trail-fade').uncheck()
    page.get_by_role('button', name='完成设置').click()
    assert all(row['opacity'] == 1 for row in fade_sample(page)[0]['rows'])
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#cursor-transparent').check()
    page.get_by_role('button', name='完成设置').click()
    assert all(row['opacity'] == 0 for row in fade_sample(page)[0]['rows'])
    page.get_by_role('button', name='阅读设置', exact=True).click()
    page.locator('#cursor-transparent').uncheck()
    page.get_by_role('button', name='恢复留痕默认', exact=True).click()
    page.get_by_role('button', name='指读', exact=True).click()
    expect(page.locator('#trail-fade')).to_be_disabled()
    expect(page.locator('#trailRecent')).to_be_disabled()
    page.get_by_role('button', name='完成设置').click()
    expect(page.locator('.reading-trail:not([hidden])')).to_have_count(0)
    assert_reader_layout(page)
    print(f'PASS {engine}: opacity gradients/transitions, pause/reload equality, constrained sliders, zero floor, transparent override, pointer unaffected', flush=True)


def main():
    url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4173'
    results=[]
    with sync_playwright() as p:
        for engine in [p.chromium,p.webkit]:
            browser=engine.launch(headless=True)
            context=browser.new_context(**p.devices['iPhone 13'])
            install_audio_probe(context)
            page=context.new_page(); errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            try:
                page.goto(url);page.wait_for_load_state('networkidle')
                upload(page,'声音与层次.txt',('甲乙丙丁戊己庚辛壬癸'*3000).encode())
                close_import(page)
                page.get_by_role('button',name='阅读《声音与层次》',exact=True).click()
                assert_ambience(page,engine.name,loop_check=True)
                assert_fade(page,engine.name)
                if engine.name == 'chromium':
                    page.evaluate('async()=>{await navigator.serviceWorker.ready;}')
                    page.get_by_role('button',name='返回书架').click()
                    page.reload()
                    page.wait_for_function('navigator.serviceWorker.controller!==null')
                    context.set_offline(True)
                    page.reload()
                    page.get_by_role('button',name='继续阅读',exact=True).click()
                    assert_ambience(page,'chromium PWA offline')
                    context.set_offline(False)
                assert not errors,errors
                results.append({'browser': engine.name, 'fade': 'passed', 'audio': 'passed' if page.evaluate('typeof window.AudioContext==="function"') else 'skipped: no AudioContext; fallback passed'})
            except Exception:
                page.screenshot(path=str(ARTIFACTS/f'{engine.name}-comfort-failure.png'))
                raise
            finally:
                context.close();browser.close()
    print(json.dumps({'results':results}),flush=True)
    return results


if __name__=='__main__':
    try:
        results = main()
    except Exception as error:
        (ARTIFACTS/'comfort-result.json').write_text(json.dumps({'status':'failed','error':str(error)},ensure_ascii=False),encoding='utf-8')
        raise
    else:
        (ARTIFACTS/'comfort-result.json').write_text(json.dumps({'status':'completed','results':results}),encoding='utf-8')
