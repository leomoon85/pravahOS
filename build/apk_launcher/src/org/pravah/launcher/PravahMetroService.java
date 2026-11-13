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

        boolean isAllApps = clsStr.contains("AllApps")
                || descStr.toLowerCase().contains("all apps");

        if (isAllApps) {
            long now = SystemClock.uptimeMillis();
            if (now - lastTriggerUptimeMs >= 1500L) {
                lastTriggerUptimeMs = now;
                Intent launchIntent = new Intent(this, MainActivity.class);
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
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
