// 版权所有：波哥
package com.getcapacitor.myapp;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.BridgeActivity;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();

    private String evaluate(WebView view, String script) throws Exception {
        CountDownLatch ready = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> view.evaluateJavascript(script, result -> {
            value.set(result);
            ready.countDown();
        }));
        assertTrue("WebView evaluation timed out", ready.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private void await(WebView view, String expression) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 20000;
        while (SystemClock.uptimeMillis() < deadline) {
            if ("true".equals(evaluate(view, expression))) return;
            SystemClock.sleep(100);
        }
        fail("UI condition timed out: " + expression);
    }

    @Test
    public void settingsLayoutOnDevice() throws Exception {
        assertEquals("app.chanyue.reader", instrumentation.getTargetContext().getPackageName());
        Intent intent = instrumentation.getTargetContext().getPackageManager()
            .getLaunchIntentForPackage("app.chanyue.reader");
        assertNotNull(intent);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = instrumentation.startActivitySync(intent);
        WebView view = ((BridgeActivity) activity).getBridge().getWebView();
        await(view, "!!document.querySelector('.mobile-nav button')");
        evaluate(view, "document.querySelectorAll('.mobile-nav button')[2].click()");
        await(view, "!!document.querySelector('.settings-modal[open]')");
        String script = "JSON.stringify((()=>{"
            + "const d=document.querySelector('.settings-modal'),s=getComputedStyle(d),b=d.getBoundingClientRect();"
            + "const boxes=q=>[...d.querySelectorAll(q)].map(e=>e.getBoundingClientRect());"
            + "const f=boxes('.font-options button'),t=boxes('.theme-options>button');"
            + "const c=d.querySelector('.transparent-setting'),i=c.querySelector('input');"
            + "const r=document.createRange();r.selectNodeContents(c);r.setStartAfter(i);"
            + "return {background:s.backgroundColor,opacity:s.opacity,display:s.display,"
            + "width:b.width,height:b.height,viewport:innerWidth,overflow:d.scrollWidth>d.clientWidth+1,"
            + "fontSameRow:f.every(x=>Math.abs(x.top-f[0].top)<1),"
            + "fontEqualWidth:f.every(x=>Math.abs(x.width-f[0].width)<1),fontGap:f[1].left-f[0].right,"
            + "themeGap:t[1].left-t[0].right,checkboxGap:r.getBoundingClientRect().left-i.getBoundingClientRect().right,"
            + "backdrop:getComputedStyle(d,'::backdrop').backgroundColor,blur:getComputedStyle(d,'::backdrop').getPropertyValue('backdrop-filter'),"
            + "agent:navigator.userAgent};})())";
        String raw = (String) new JSONTokener(evaluate(view, script)).nextValue();
        JSONObject result = new JSONObject(raw);
        System.out.println("CHANYUE_SETTINGS_METRICS " + result);
        assertEquals("rgb(252, 252, 248)", result.getString("background"));
        assertEquals("1", result.getString("opacity"));
        assertEquals("blur(5px)", result.getString("blur"));
        assertFalse("Settings overflow horizontally", result.getBoolean("overflow"));
        assertTrue("Font buttons must share a row", result.getBoolean("fontSameRow"));
        assertTrue("Font buttons must have equal widths", result.getBoolean("fontEqualWidth"));
        assertEquals("Font spacing", 10, result.getDouble("fontGap"), 1);
        assertTrue("Theme spacing", result.getDouble("themeGap") >= 12);
        assertTrue("Checkbox spacing", result.getDouble("checkboxGap") >= 8);
        evaluate(view, "document.querySelector('.settings-modal').scrollTop=100000");
        await(view, "(()=>{const d=document.querySelector('.settings-modal'),b=d.getBoundingClientRect(),f=d.querySelector('.modal-footer').getBoundingClientRect();return f.bottom<=b.bottom+1&&f.top>=b.top;})()");
        evaluate(view, "document.querySelector('.settings-modal .modal-footer .primary-button').click()");
        await(view, "!document.querySelector('.settings-modal')");
    }
}
