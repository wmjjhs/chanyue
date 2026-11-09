// 版权所有：波哥
package app.chanyue.reader;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SystemSpeechPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
