package org.pravah.launcher;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;

public class PravahMetroService extends AccessibilityService {
    private long lastTriggerUptimeMs = 0L;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return;
        }

        CharSequence pkg = event.getPackageName();
        if (pkg == null || !"com.google.android.apps.nexuslauncher".equals(pkg.toString())) {
            return;
        }

        CharSequence cls = event.getClassName();
        CharSequence desc = event.getContentDescription();
        String clsStr = cls != null ? cls.toString() : "";
        String descStr = desc != null ? desc.toString() : "";

        StringBuilder textSb = new StringBuilder();
        if (event.getText() != null) {
            for (CharSequence t : event.getText()) {
                if (t != null) textSb.append(t).append(' ');
            }
        }
        String textStr = textSb.toString().toLowerCase();

        boolean isAllApps = clsStr.contains("AllApps")
                || descStr.toLowerCase().contains("all apps")
                || textStr.contains("all apps")
                || textStr.contains("search apps");

        if (isAllApps) {
            long now = SystemClock.uptimeMillis();
            if (now - lastTriggerUptimeMs >= 800L) {
                lastTriggerUptimeMs = now;
                Intent launchIntent = new Intent(this, MainActivity.class);
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                launchIntent.putExtra("auto_expand", true);
                startActivity(launchIntent);
            }
        }
    }

    @Override
    public void onInterrupt() {
        // Required override
    }
}
