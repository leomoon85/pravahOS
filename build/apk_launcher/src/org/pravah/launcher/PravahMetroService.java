package org.pravah.launcher;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
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
import java.util.ArrayList;
import java.util.List;

/**
 * Accessibility bridge driving the Metro Drawer swipe-up launch and rendering
 * dynamic Windows Vista Aero Glass overlays over Home icons and Notification Shade.
 */
public class PravahMetroService extends AccessibilityService {
    private static final String PKG_NEXUS = "com.google.android.apps.nexuslauncher";
    private static final String PKG_SYSTEMUI = "com.android.systemui";
    private static final String PKG_PRAVAH = "org.pravah.launcher";

    private static PravahMetroService instance;
    private long lastTriggerUptimeMs = 0L;
    private long lastContentSyncUptimeMs = 0L;
    private boolean metroDrawerOpen = false;
    private boolean shadeExpanded = false;
    private WindowManager windowManager;
    private HomeGlassOverlayView homeGlassOverlay;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final Runnable delayedSyncRunnable = new Runnable() {
        @Override
        public void run() {
            syncWindowsAndOverlay(true);
        }
    };

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
                    if (!svc.shadeExpanded) {
                        svc.setHomeGlassVisible(false);
                    }
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
                        svc.syncWindowsAndOverlay(true);
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
                info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                        | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
                info.eventTypes |= AccessibilityEvent.TYPE_WINDOWS_CHANGED
                        | AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                        | AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED;
                setServiceInfo(info);
            }
        } catch (Exception ignored) {}
        ensureHomeGlassOverlay();
        syncWindowsAndOverlay(true);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (homeGlassOverlay != null) {
            homeGlassOverlay.refreshThemeState();
        }
        syncWindowsAndOverlay(!MainActivity.isActivityVisible() && !metroDrawerOpen);
        PravahIntentWidgetProvider.refreshAllWidgets(this);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        mainHandler.removeCallbacks(delayedSyncRunnable);
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

    private void syncWindowsAndOverlay(boolean fallbackHomeVisible) {
        ensureHomeGlassOverlay();
        if (homeGlassOverlay == null) return;

        List<AccessibilityNodeInfo> obtainedRoots = new ArrayList<AccessibilityNodeInfo>();
        try {
            AccessibilityNodeInfo systemUiRoot = null;
            AccessibilityNodeInfo nexusRoot = null;
            boolean otherAppActive = false;
            boolean fullScreenSystemShadeWindow = false;

            List<AccessibilityWindowInfo> windows = getWindows();
            if (windows != null) {
                for (AccessibilityWindowInfo w : windows) {
                    if (w == null) continue;
                    Rect winBounds = new Rect();
                    w.getBoundsInScreen(winBounds);
                    boolean isFullSystemShade = (w.getType() == AccessibilityWindowInfo.TYPE_SYSTEM
                            && winBounds.height() > dpInt(320)
                            && (w.isActive() || w.isFocused()));
                    if (isFullSystemShade) {
                        fullScreenSystemShadeWindow = true;
                    }

                    AccessibilityNodeInfo root = w.getRoot();
                    if (root == null) continue;
                    obtainedRoots.add(root);

                    CharSequence pkgSeq = root.getPackageName();
                    String pkg = pkgSeq != null ? pkgSeq.toString() : "";
                    if (PKG_SYSTEMUI.equals(pkg) && (isFullSystemShade || isExpandedNotificationShadeRoot(root))) {
                        systemUiRoot = root;
                    } else if (PKG_NEXUS.equals(pkg)) {
                        nexusRoot = root;
                    } else if (w.getType() == AccessibilityWindowInfo.TYPE_APPLICATION
                            && (w.isActive() || w.isFocused())
                            && !PKG_NEXUS.equals(pkg)) {
                        otherAppActive = true;
                    }
                }
            }

            if (systemUiRoot == null && (fullScreenSystemShadeWindow || nexusRoot == null)) {
                AccessibilityNodeInfo activeRoot = getRootInActiveWindow();
                if (activeRoot != null) {
                    obtainedRoots.add(activeRoot);
                    CharSequence pkgSeq = activeRoot.getPackageName();
                    String pkg = pkgSeq != null ? pkgSeq.toString() : "";
                    if (PKG_SYSTEMUI.equals(pkg) && (fullScreenSystemShadeWindow || isExpandedNotificationShadeRoot(activeRoot))) {
                        systemUiRoot = activeRoot;
                    } else if (PKG_NEXUS.equals(pkg)) {
                        nexusRoot = activeRoot;
                    }
                }
            }

            if (systemUiRoot != null || fullScreenSystemShadeWindow) {
                RectF headerRect = new RectF();
                List<RectF> tileRects = new ArrayList<RectF>();
                List<RectF> cardRects = new ArrayList<RectF>();
                if (systemUiRoot != null) {
                    extractShadeElements(systemUiRoot, headerRect, tileRects, cardRects);
                }
                shadeExpanded = true;
                homeGlassOverlay.updateShadeElements(headerRect.isEmpty() ? null : headerRect, tileRects, cardRects);
                homeGlassOverlay.setDisplayMode(HomeGlassOverlayView.MODE_NOTIFICATION_SHADE);
                setHomeGlassVisible(true);
                return;
            }

            shadeExpanded = false;
            homeGlassOverlay.setDisplayMode(HomeGlassOverlayView.MODE_HOME);

            if (MainActivity.isActivityVisible() || metroDrawerOpen || otherAppActive) {
                setHomeGlassVisible(false);
                return;
            }

            if (nexusRoot != null) {
                RectF dateRect = new RectF();
                RectF searchRect = new RectF();
                List<RectF> workspaceRects = new ArrayList<RectF>();
                List<RectF> hotseatRects = new ArrayList<RectF>();
                extractHomeElements(nexusRoot, dateRect, workspaceRects, hotseatRects, searchRect);
                if (!workspaceRects.isEmpty() || !hotseatRects.isEmpty()) {
                    homeGlassOverlay.updateHomeElements(
                            dateRect.isEmpty() ? null : dateRect,
                            workspaceRects,
                            hotseatRects,
                            searchRect.isEmpty() ? null : searchRect
                    );
                }
                setHomeGlassVisible(true);
                return;
            }

            setHomeGlassVisible(fallbackHomeVisible);
        } catch (Exception ignored) {
            if (!shadeExpanded && (MainActivity.isActivityVisible() || metroDrawerOpen)) {
                setHomeGlassVisible(false);
            } else {
                setHomeGlassVisible(fallbackHomeVisible || shadeExpanded);
            }
        } finally {
            for (AccessibilityNodeInfo r : obtainedRoots) {
                try {
                    r.recycle();
                } catch (Exception ignored) {}
            }
        }
    }

    private static RectF headerRectOut(RectF target) {
        return target;
    }

    private boolean isExpandedNotificationShadeRoot(AccessibilityNodeInfo root) {
        if (root == null) return false;
        Rect bounds = new Rect();
        root.getBoundsInScreen(bounds);
        if (bounds.height() < dpInt(320)) {
            return false;
        }
        return containsVisibleShadeMarker(root, 0);
    }

    private boolean containsVisibleShadeMarker(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 8) return false;
        String viewId = node.getViewIdResourceName();
        if (viewId != null && node.isVisibleToUser()) {
            if (viewId.equals("com.android.systemui:id/notification_panel")
                    || viewId.equals("com.android.systemui:id/qs_frame")
                    || viewId.equals("com.android.systemui:id/quick_qs_panel")
                    || viewId.equals("com.android.systemui:id/quick_settings_panel")
                    || viewId.equals("com.android.systemui:id/expandableNotificationRow")) {
                Rect r = new Rect();
                node.getBoundsInScreen(r);
                if (r.height() > dpInt(48)) {
                    return true;
                }
            }
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            try {
                if (containsVisibleShadeMarker(child, depth + 1)) {
                    return true;
                }
            } finally {
                child.recycle();
            }
        }
        return false;
    }

    private static boolean isQsContainerId(String viewId) {
        if (viewId == null) return false;
        return "com.android.systemui:id/qs_frame".equals(viewId)
                || "com.android.systemui:id/quick_settings_container".equals(viewId)
                || "com.android.systemui:id/expanded_qs_scroll_view".equals(viewId)
                || "com.android.systemui:id/quick_settings_panel".equals(viewId)
                || "com.android.systemui:id/qs_pager".equals(viewId)
                || "com.android.systemui:id/tile_page".equals(viewId)
                || "com.android.systemui:id/brightness_slider".equals(viewId)
                || "com.android.systemui:id/slider".equals(viewId)
                || "com.android.systemui:id/header".equals(viewId)
                || "com.android.systemui:id/quick_qs_panel".equals(viewId)
                || "com.android.systemui:id/qqs_tile_layout".equals(viewId)
                || "com.android.systemui:id/qs_footer_actions".equals(viewId);
    }

    private boolean hasVisibleNodeWithId(AccessibilityNodeInfo node, String targetId, int depth) {
        if (node == null || depth > 24) return false;
        String viewId = node.getViewIdResourceName();
        if (isQsContainerId(viewId)) {
            try {
                node.refresh();
            } catch (Exception ignored) {}
        }
        if (targetId.equals(viewId) && node.isVisibleToUser()) {
            Rect r = new Rect();
            node.getBoundsInScreen(r);
            if (!r.isEmpty() && r.height() > dpInt(16)) {
                return true;
            }
        }
        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            try {
                if (hasVisibleNodeWithId(child, targetId, depth + 1)) {
                    return true;
                }
            } finally {
                child.recycle();
            }
        }
        return false;
    }

    private void extractShadeElements(
            AccessibilityNodeInfo node,
            RectF headerRectOut,
            List<RectF> tileRectsOut,
            List<RectF> cardRectsOut
    ) {
        boolean fullQsExpanded = hasVisibleNodeWithId(node, "com.android.systemui:id/tile_page", 0)
                || hasVisibleNodeWithId(node, "com.android.systemui:id/brightness_slider", 0)
                || hasVisibleNodeWithId(node, "com.android.systemui:id/qs_footer_actions", 0);
        traverseShadeNode(node, tileRectsOut, cardRectsOut, fullQsExpanded, 0);

        int w = getResources().getDisplayMetrics().widthPixels;
        int h = getResources().getDisplayMetrics().heightPixels;
        if (!fullQsExpanded && tileRectsOut.isEmpty() && cardRectsOut.isEmpty()) {
            fullQsExpanded = true;
        }

        if (fullQsExpanded) {
            headerRectOut.set(dp(14), dp(10), w - dp(14), dp(122));
            if (tileRectsOut.isEmpty()) {
                // Brightness slider
                tileRectsOut.add(new RectF(0.0389f * w, 0.1529f * h, 0.9611f * w, 0.2054f * h));
                // 8 Quick Settings tiles (4 rows x 2 columns)
                tileRectsOut.add(new RectF(0.0389f * w, 0.2229f * h, 0.4898f * w, 0.3104f * h));
                tileRectsOut.add(new RectF(0.5093f * w, 0.2229f * h, 0.9602f * w, 0.3104f * h));
                tileRectsOut.add(new RectF(0.0389f * w, 0.3192f * h, 0.4898f * w, 0.4067f * h));
                tileRectsOut.add(new RectF(0.5093f * w, 0.3192f * h, 0.9602f * w, 0.4067f * h));
                tileRectsOut.add(new RectF(0.0389f * w, 0.4154f * h, 0.4898f * w, 0.5029f * h));
                tileRectsOut.add(new RectF(0.5093f * w, 0.4154f * h, 0.9602f * w, 0.5029f * h));
                tileRectsOut.add(new RectF(0.0389f * w, 0.5117f * h, 0.4898f * w, 0.5992f * h));
                tileRectsOut.add(new RectF(0.5093f * w, 0.5117f * h, 0.9602f * w, 0.5992f * h));
                // 3 Footer action pills (Owner, Settings, Power)
                tileRectsOut.add(new RectF(0.6250f * w, 0.9180f * h, 0.7360f * w, 0.9680f * h));
                tileRectsOut.add(new RectF(0.7420f * w, 0.9180f * h, 0.8530f * w, 0.9680f * h));
                tileRectsOut.add(new RectF(0.8580f * w, 0.9180f * h, 0.9690f * w, 0.9680f * h));
            }
        } else {
            headerRectOut.set(dp(14), dp(6), w - dp(14), dp(44));
        }
    }

    private void traverseShadeNode(
            AccessibilityNodeInfo node,
            List<RectF> tileRectsOut,
            List<RectF> cardRectsOut,
            boolean fullQsExpanded,
            int depth
    ) {
        if (node == null || depth > 28) return;
        String viewId = node.getViewIdResourceName();
        if (isQsContainerId(viewId)) {
            try {
                node.refresh();
            } catch (Exception ignored) {}
        }
        String cls = node.getClassName() != null ? node.getClassName().toString() : "";
        CharSequence nodeText = node.getText();
        String textStr = nodeText != null ? nodeText.toString() : "";

        if (fullQsExpanded) {
            if ("com.android.systemui:id/quick_qs_panel".equals(viewId)
                    || "com.android.systemui:id/qqs_tile_layout".equals(viewId)
                    || "com.android.systemui:id/notification_stack_scroller".equals(viewId)) {
                return;
            }
        } else {
            if ("com.android.systemui:id/quick_settings_panel".equals(viewId)
                    || "com.android.systemui:id/tile_page".equals(viewId)) {
                return;
            }
        }

        Rect r = new Rect();
        node.getBoundsInScreen(r);
        boolean visible = node.isVisibleToUser() && !r.isEmpty();

        if (visible) {
            if (fullQsExpanded) {
                if (("com.android.systemui:id/slider".equals(viewId) || "android.widget.SeekBar".equals(cls))
                        && r.height() > dpInt(24)) {
                    tileRectsOut.add(new RectF(r));
                    return;
                } else if ("com.android.systemui:id/tile_page".equals(viewId)) {
                    int childCount = node.getChildCount();
                    for (int i = 0; i < childCount; i++) {
                        AccessibilityNodeInfo child = node.getChild(i);
                        if (child == null) continue;
                        try {
                            try {
                                child.refresh();
                            } catch (Exception ignored) {}
                            if (child.isVisibleToUser()) {
                                Rect cr = new Rect();
                                child.getBoundsInScreen(cr);
                                if (!cr.isEmpty() && cr.width() > dpInt(90) && cr.height() > dpInt(36)) {
                                    tileRectsOut.add(new RectF(cr));
                                }
                            }
                        } finally {
                            child.recycle();
                        }
                    }
                    return;
                } else if ("com.android.systemui:id/multi_user_switch".equals(viewId)
                        || "com.android.systemui:id/settings_button_container".equals(viewId)
                        || "com.android.systemui:id/pm_lite".equals(viewId)) {
                    if (r.width() > dpInt(20) && r.height() > dpInt(20)) {
                        tileRectsOut.add(new RectF(
                                r.left - dp(2),
                                r.top - dp(2),
                                r.right + dp(2),
                                r.bottom + dp(2)
                        ));
                    }
                    return;
                }
            } else {
                if ("com.android.systemui:id/qqs_tile_layout".equals(viewId)) {
                    int childCount = node.getChildCount();
                    for (int i = 0; i < childCount; i++) {
                        AccessibilityNodeInfo child = node.getChild(i);
                        if (child == null) continue;
                        try {
                            try {
                                child.refresh();
                            } catch (Exception ignored) {}
                            if (child.isVisibleToUser()) {
                                Rect cr = new Rect();
                                child.getBoundsInScreen(cr);
                                if (!cr.isEmpty() && cr.width() > dpInt(90) && cr.height() > dpInt(36)) {
                                    tileRectsOut.add(new RectF(cr));
                                }
                            }
                        } finally {
                            child.recycle();
                        }
                    }
                    return;
                } else if ("com.android.systemui:id/expandableNotificationRow".equals(viewId)
                        && r.height() > dpInt(28) && r.width() > dpInt(80)) {
                    cardRectsOut.add(new RectF(r));
                    return;
                } else if (("com.android.systemui:id/manage_text".equals(viewId)
                        || "com.android.systemui:id/dismiss_text".equals(viewId)
                        || ("android.widget.Button".equals(cls) && ("Manage".equals(textStr) || "Clear all".equals(textStr))))
                        && r.height() > dpInt(24)) {
                    cardRectsOut.add(new RectF(r));
                }
            }
        }

        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            try {
                traverseShadeNode(child, tileRectsOut, cardRectsOut, fullQsExpanded, depth + 1);
            } finally {
                child.recycle();
            }
        }
    }

    private void extractHomeElements(
            AccessibilityNodeInfo root,
            RectF dateRectOut,
            List<RectF> workspaceRectsOut,
            List<RectF> hotseatRectsOut,
            RectF searchRectOut
    ) {
        traverseHomeNode(root, dateRectOut, workspaceRectsOut, hotseatRectsOut, searchRectOut, false, false, false, 0);
    }

    private void traverseHomeNode(
            AccessibilityNodeInfo node,
            RectF dateRectOut,
            List<RectF> workspaceRectsOut,
            List<RectF> hotseatRectsOut,
            RectF searchRectOut,
            boolean inWorkspace,
            boolean inHotseat,
            boolean inWidget,
            int depth
    ) {
        if (node == null || depth > 16) return;
        String viewId = node.getViewIdResourceName();
        String cls = node.getClassName() != null ? node.getClassName().toString() : "";

        boolean nextWidget = inWidget || cls.contains("LauncherAppWidgetHostView");
        if (nextWidget) return;

        boolean nextWorkspace = inWorkspace || "com.google.android.apps.nexuslauncher:id/workspace".equals(viewId);
        boolean nextHotseat = inHotseat || "com.google.android.apps.nexuslauncher:id/hotseat".equals(viewId);

        if (node.isVisibleToUser()) {
            Rect r = new Rect();
            node.getBoundsInScreen(r);
            if (!r.isEmpty()) {
                if ("com.google.android.apps.nexuslauncher:id/date".equals(viewId)) {
                    dateRectOut.set(
                            r.left - dp(10),
                            r.top - dp(10),
                            r.right + dp(14),
                            r.bottom + dp(10)
                    );
                } else if ("com.google.android.apps.nexuslauncher:id/search_container_hotseat".equals(viewId)) {
                    searchRectOut.set(r);
                } else if ("android.widget.TextView".equals(cls) && node.isClickable()
                        && (nextWorkspace || nextHotseat)
                        && r.width() >= dpInt(44) && r.height() >= dpInt(48)) {
                    float cx = (r.left + r.right) * 0.5f;
                    float half = dp(37.5f);
                    if (nextHotseat) {
                        float cy = (r.top + r.bottom) * 0.5f - dp(0.4f);
                        hotseatRectsOut.add(new RectF(cx - half, cy - half, cx + half, cy + half));
                    } else {
                        float cy = r.top + dp(39.8f);
                        workspaceRectsOut.add(new RectF(cx - half, cy - half, cx + half, cy + half));
                    }
                }
            }
        }

        int count = node.getChildCount();
        for (int i = 0; i < count; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            try {
                traverseHomeNode(child, dateRectOut, workspaceRectsOut, hotseatRectsOut, searchRectOut,
                        nextWorkspace, nextHotseat, nextWidget, depth + 1);
            } finally {
                child.recycle();
            }
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) {
            return;
        }
        int eventType = event.getEventType();
        if (eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                && eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            return;
        }

        CharSequence pkg = event.getPackageName();
        String pkgStr = pkg != null ? pkg.toString() : "";
        CharSequence cls = event.getClassName();
        CharSequence desc = event.getContentDescription();
        String clsStr = cls != null ? cls.toString() : "";
        String descStr = desc != null ? desc.toString() : "";

        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && PKG_NEXUS.equals(pkgStr)) {
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
                shadeExpanded = false;
                setHomeGlassVisible(false);
                long now = SystemClock.uptimeMillis();
                if (now - lastTriggerUptimeMs >= 800L) {
                    lastTriggerUptimeMs = now;
                    Intent launchIntent = new Intent(this, MainActivity.class);
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                    launchIntent.putExtra("auto_expand", true);
                    startActivity(launchIntent);
                }
                return;
            }
            if (clsStr.contains("Recents")) {
                setHomeGlassVisible(false);
                return;
            }
        }

        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && PKG_PRAVAH.equals(pkgStr)) {
            if (clsStr.contains("MainActivity") || clsStr.contains("IntentWidgetActivity")) {
                metroDrawerOpen = true;
                if (!shadeExpanded) {
                    setHomeGlassVisible(false);
                }
            }
            return;
        }

        if (eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            if (!PKG_SYSTEMUI.equals(pkgStr) && !PKG_NEXUS.equals(pkgStr)) {
                return;
            }
            mainHandler.removeCallbacks(delayedSyncRunnable);
            mainHandler.postDelayed(delayedSyncRunnable, 260L);
            long now = SystemClock.uptimeMillis();
            if (now - lastContentSyncUptimeMs < 180L) {
                return;
            }
            lastContentSyncUptimeMs = now;
            boolean currentlyVisible = homeGlassOverlay != null && homeGlassOverlay.getVisibility() == View.VISIBLE;
            syncWindowsAndOverlay(currentlyVisible);
            return;
        }

        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && !PKG_NEXUS.equals(pkgStr)
                && !PKG_SYSTEMUI.equals(pkgStr)
                && !"com.google.android.inputmethod.latin".equals(pkgStr)
                && !"com.google.android.googlequicksearchbox".equals(pkgStr)
                && !"com.google.android.as".equals(pkgStr)
                && !"com.google.android.gms".equals(pkgStr)
                && !"android".equals(pkgStr)) {
            AppUsageTracker.recordAppLaunch(this, pkgStr);
            setHomeGlassVisible(false);
            return;
        }

        syncWindowsAndOverlay(true);
        mainHandler.removeCallbacks(delayedSyncRunnable);
        mainHandler.postDelayed(delayedSyncRunnable, 220L);
    }

    @Override
    public void onInterrupt() {
        setHomeGlassVisible(false);
    }

    private float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }

    private int dpInt(float v) {
        return Math.round(dp(v));
    }
}
