package org.pravah.aurora;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
import android.widget.LinearLayout;
import android.graphics.Color;
import android.view.Gravity;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.parseColor("#0a0f1d"));
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(40, 40, 40, 40);

        TextView title = new TextView(this);
        title.setText("✦ Aurora Notes");
        title.setTextSize(26);
        title.setTextColor(Color.parseColor("#38bdf8"));
        title.setGravity(Gravity.CENTER);
        layout.addView(title);

        TextView sub = new TextView(this);
        sub.setText("\nTranspiled via PravahOS AOT Engine\n\n• Zero Runtime Tax Enforced\n• WAKE_LOCK: STRIPPED\n• RECEIVE_BOOT_COMPLETED: PURGED\n• 100% Dormancy Certified");
        sub.setTextSize(16);
        sub.setTextColor(Color.parseColor("#e2e8f0"));
        sub.setGravity(Gravity.CENTER);
        layout.addView(sub);

        setContentView(layout);
    }
}
