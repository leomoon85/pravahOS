package org.pravah.launcher;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.util.List;

public class PravahMetroService extends AccessibilityService {
    private static PravahMetroService instance;
    private long lastTriggerUptimeMs = 0L;
    private boolean metroDrawerOpen = false;
    private WindowManager windowManager;
    private HomeGlassOverlayView homeGlassOverlay;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public static void refreshOverlayTheme() {
        final PravahMetroService svc = instance;
        if (svc != null && svc.homeGlassOverlay != null) {
            svc.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (svc.homeGlassOverlay != null) {
                        svc.homeGlassOverlay.refreshThemeState();
                    }
                }
            });
        }
    }

    public static void onMetroDrawerOpened() {
        final PravahMetroService svc = instance;
        if (svc != null) {
            svc.mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    svc.metroDrawerOpen = true;
                    svc.setHomeGlassVisible(false);
                }
            });
        }
    }

    public static void onMetroDrawerClosed() {
        final PravahMetroService svc = instance;
        if (svc != null) {
            svc.mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (!MainActivity.isActivityVisible()) {
                        svc.metroDrawerOpen = false;
                        svc.setHomeGlassVisible(true);
                    }
                }
            }, 150L);
        }
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        try {
            AccessibilityServiceInfo info = getServiceInfo();
            if (info != null) {
                info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
                info.eventTypes |= AccessibilityEvent.TYPE_WINDOWS_CHANGED
                        | AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;
                setServiceInfo(info);
            }
        } catch (Exception ignored) {}
        ensureHomeGlassOverlay();
        setHomeGlassVisible(true);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (homeGlassOverlay != null) {
            homeGlassOverlay.refreshThemeState();
        }
        if (MainActivity.isActivityVisible() || metroDrawerOpen) {
            setHomeGlassVisible(false);
        } else {
            setHomeGlassVisible(true);
        }
        PravahIntentWidgetProvider.refreshAllWidgets(this);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (windowManager != null && homeGlassOverlay != null) {
            try {
                windowManager.removeViewImmediate(homeGlassOverlay);
            } catch (Exception ignored) {}
        }
        homeGlassOverlay = null;
        if (instance == this) instance = null;
    }

    private void ensureHomeGlassOverlay() {
        if (homeGlassOverlay != null) return;
        try {
            windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (windowManager == null) return;
            homeGlassOverlay = new HomeGlassOverlayView(this);
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT
            );
            lp.gravity = Gravity.TOP | Gravity.START;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                lp.setFitInsetsTypes(0);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            }
            windowManager.addView(homeGlassOverlay, lp);
        } catch (Exception ignored) {
            homeGlassOverlay = null;
        }
    }

    private void setHomeGlassVisible(boolean visible) {
        ensureHomeGlassOverlay();
        if (homeGlassOverlay == null) return;
        if (visible) {
            homeGlassOverlay.refreshThemeState();
            if (homeGlassOverlay.getVisibility() != View.VISIBLE) {
                homeGlassOverlay.setVisibility(View.VISIBLE);
            }
        } else if (homeGlassOverlay.getVisibility() != View.GONE) {
            homeGlassOverlay.setVisibility(View.GONE);
        }
    }

    private boolean isNexusHomeForeground(boolean fallback) {
        try {
            List<AccessibilityWindowInfo> windows = getWindows();
            if (windows == null || windows.isEmpty()) {
                return fallback;
            }
            AccessibilityWindowInfo topApp = null;
            int topLayer = Integer.MIN_VALUE;
            for (AccessibilityWindowInfo w : windows) {
                if (w == null) continue;
                int type = w.getType();
                if (type == AccessibilityWindowInfo.TYPE_SYSTEM) {
                    CharSequence title = w.getTitle();
                    if (title != null) {
                        String t = title.toString().toLowerCase();
                        if (t.contains("notification") || t.contains("power") || t.contains("volume")) {
                            return false;
                        }
                    }
                    continue;
                }
                if (type == AccessibilityWindowInfo.TYPE_APPLICATION) {
                    int layer = w.getLayer();
                    if (w.isActive() || w.isFocused()) {
                        topApp = w;
                        break;
                    }
                    if (topApp == null || layer > topLayer) {
                        topApp = w;
                        topLayer = layer;
                    }
                }
            }
            if (topApp == null) {
                return fallback;
            }
            CharSequence winTitle = topApp.getTitle();
            String titleStr = winTitle != null ? winTitle.toString() : "";
            String lowerTitle = titleStr.toLowerCase();
            if (lowerTitle.contains("recent") || lowerTitle.contains("pravah") || lowerTitle.contains("widget")) {
                return false;
            }
            AccessibilityNodeInfo root = topApp.getRoot();
            if (root != null) {
                try {
                    CharSequence rootPkg = root.getPackageName();
                    if (rootPkg != null) {
                        return "com.google.android.apps.nexuslauncher".equals(rootPkg.toString());
                    }
                } finally {
                    root.recycle();
                }
            }
            if ("Home".equalsIgnoreCase(titleStr) || lowerTitle.contains("launcher")) {
                return true;
            }
            if (!titleStr.isEmpty()) {
                return false;
            }
        } catch (Exception ignored) {}
        return fallback;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return;
        }

        CharSequence pkg = event.getPackageName();
        if (pkg == null) {
            return;
        }
        String pkgStr = pkg.toString();
        CharSequence cls = event.getClassName();
        CharSequence desc = event.getContentDescription();
        String clsStr = cls != null ? cls.toString() : "";
        String descStr = desc != null ? desc.toString() : "";

        if ("org.pravah.launcher".equals(pkgStr)) {
            if (clsStr.contains("MainActivity") || clsStr.contains("IntentWidgetActivity")) {
                metroDrawerOpen = true;
                setHomeGlassVisible(false);
            }
            return;
        }

        if ("com.android.systemui".equals(pkgStr)
                || "com.google.android.inputmethod.latin".equals(pkgStr)
                || "com.google.android.googlequicksearchbox".equals(pkgStr)
                || "com.google.android.as".equals(pkgStr)
                || "com.google.android.gms".equals(pkgStr)
                || "android".equals(pkgStr)) {
            return;
        }

        if (!"com.google.android.apps.nexuslauncher".equals(pkgStr)) {
            setHomeGlassVisible(false);
            AppUsageTracker.recordAppLaunch(this, pkgStr);
            return;
        }

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
            metroDrawerOpen = true;
            setHomeGlassVisible(false);
            long now = SystemClock.uptimeMillis();
            if (now - lastTriggerUptimeMs >= 800L) {
                lastTriggerUptimeMs = now;
                Intent launchIntent = new Intent(this, MainActivity.class);
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                launchIntent.putExtra("auto_expand", true);
                startActivity(launchIntent);
            }
        } else if (clsStr.contains("Recents")) {
            setHomeGlassVisible(false);
        } else if (MainActivity.isActivityVisible()
                || (SystemClock.uptimeMillis() - lastTriggerUptimeMs < 1500L)) {
            setHomeGlassVisible(false);
        } else {
            metroDrawerOpen = false;
            setHomeGlassVisible(true);
        }
    }

    @Override
    public void onInterrupt() {
        setHomeGlassVisible(false);
    }
}
