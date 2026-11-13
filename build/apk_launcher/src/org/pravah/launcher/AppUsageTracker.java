package org.pravah.launcher;

import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Tracks recently used apps and sequential app-to-app transition probabilities
 * (App A -> App B) from both live Accessibility/Launcher events and AOSP UsageEvents
 * to drive Pixel-inspired Recent & Related app predictions.
 */
public class AppUsageTracker {
    private static final String PREFS_NAME = "pravah_app_predictor";
    private static final String KEY_STATE = "usage_state_json";
    private static final String KEY_SYNC_TS = "last_usage_event_sync_ts";
    private static final int MAX_RECENT = 20;
    private static final long DEBOUNCE_SAME_PKG_MS = 1500L;

    private static boolean isIgnoredPackage(Context context, String pkg) {
        if (pkg == null || pkg.isEmpty()) return true;
        if ("com.google.android.apps.nexuslauncher".equals(pkg)
                || "org.pravah.launcher".equals(pkg)
                || "com.android.systemui".equals(pkg)
                || "com.android.launcher3".equals(pkg)
                || "com.google.android.inputmethod.latin".equals(pkg)
                || "com.android.permissioncontroller".equals(pkg)
                || "com.google.android.permissioncontroller".equals(pkg)
                || "com.android.packageinstaller".equals(pkg)
                || "com.google.android.packageinstaller".equals(pkg)
                || "android".equals(pkg)) {
            return true;
        }
        try {
            PackageManager pm = context.getPackageManager();
            return pm.getLaunchIntentForPackage(pkg) == null;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static synchronized void recordAppLaunch(Context context, String pkg) {
        if (context == null || isIgnoredPackage(context, pkg)) return;
        try {
            JSONObject root = loadStateObject(context);
            long now = System.currentTimeMillis();
            if (applyEventToRoot(root, pkg, now)) {
                saveStateObject(context, root);
            }
        } catch (Exception ignored) {}
    }

    public static synchronized String getUsageStateJson(Context context) {
        if (context == null) return "{\"lastPkg\":\"\",\"recent\":[],\"transitions\":{}}";
        try {
            JSONObject root = loadStateObject(context);
            syncFromSystemUsageEvents(context, root);
            return root.toString();
        } catch (Exception e) {
            return "{\"lastPkg\":\"\",\"recent\":[],\"transitions\":{}}";
        }
    }

    private static JSONObject loadStateObject(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_STATE, "");
        if (raw != null && !raw.isEmpty()) {
            try {
                return new JSONObject(raw);
            } catch (Exception ignored) {}
        }
        JSONObject root = new JSONObject();
        try {
            root.put("lastPkg", "");
            root.put("lastKey", "");
            root.put("lastTs", 0L);
            root.put("recent", new JSONArray());
            root.put("transitions", new JSONObject());
        } catch (Exception ignored) {}
        return root;
    }

    private static void saveStateObject(Context context, JSONObject root) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_STATE, root.toString())
                .apply();
    }

    private static void syncFromSystemUsageEvents(Context context, JSONObject root) {
        try {
            UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return;

            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            long now = System.currentTimeMillis();
            long lastSyncTs = prefs.getLong(KEY_SYNC_TS, 0L);
            long startTs = lastSyncTs > 0L ? (lastSyncTs + 1L) : (now - 86400000L);
            if (startTs >= now) return;

            boolean changed = false;
            long maxObservedTs = lastSyncTs;

            UsageEvents events = usm.queryEvents(startTs, now);
            if (events != null) {
                UsageEvents.Event ev = new UsageEvents.Event();
                while (events.hasNextEvent()) {
                    events.getNextEvent(ev);
                    int type = ev.getEventType();
                    if (type == UsageEvents.Event.ACTIVITY_RESUMED || type == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                        String pkg = ev.getPackageName();
                        long ts = ev.getTimeStamp();
                        if (ts > maxObservedTs) maxObservedTs = ts;
                        if (!isIgnoredPackage(context, pkg) && applyEventToRoot(root, pkg, ts)) {
                            changed = true;
                        }
                    }
                }
            }

            // Fallback to aggregated stats only if UsageEvents yielded nothing and recent is still empty
            JSONArray rec = root.optJSONArray("recent");
            if ((rec == null || rec.length() == 0)) {
                List<UsageStats> stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 86400000L, now);
                if (stats != null && !stats.isEmpty()) {
                    List<UsageStats> filtered = new ArrayList<>();
                    for (UsageStats s : stats) {
                        if (s != null && s.getLastTimeUsed() > 0 && !isIgnoredPackage(context, s.getPackageName())) {
                            filtered.add(s);
                        }
                    }
                    Collections.sort(filtered, new Comparator<UsageStats>() {
                        @Override
                        public int compare(UsageStats a, UsageStats b) {
                            return Long.compare(a.getLastTimeUsed(), b.getLastTimeUsed());
                        }
                    });
                    for (UsageStats s : filtered) {
                        if (applyEventToRoot(root, s.getPackageName(), s.getLastTimeUsed())) {
                            changed = true;
                        }
                    }
                }
            }

            if (changed) {
                saveStateObject(context, root);
            }
            if (maxObservedTs > lastSyncTs) {
                prefs.edit().putLong(KEY_SYNC_TS, maxObservedTs).apply();
            }
        } catch (Exception ignored) {}
    }

    private static boolean applyEventToRoot(JSONObject root, String pkg, long eventTs) {
        try {
            String lastPkg = root.optString("lastPkg", "");
            long lastTs = root.optLong("lastTs", 0L);

            if (eventTs < lastTs) {
                return false;
            }
            if (pkg.equals(lastPkg) && Math.abs(eventTs - lastTs) < DEBOUNCE_SAME_PKG_MS) {
                return false;
            }

            JSONObject transitions = root.optJSONObject("transitions");
            if (transitions == null) {
                transitions = new JSONObject();
                root.put("transitions", transitions);
            }
            if (!lastPkg.isEmpty() && !lastPkg.equals(pkg)) {
                JSONObject targets = transitions.optJSONObject(lastPkg);
                if (targets == null) {
                    targets = new JSONObject();
                    transitions.put(lastPkg, targets);
                }
                targets.put(pkg, targets.optInt(pkg, 0) + 1);
            }

            JSONArray oldRecent = root.optJSONArray("recent");
            JSONArray newRecent = new JSONArray();
            int existingCount = 0;
            if (oldRecent != null) {
                for (int i = 0; i < oldRecent.length(); i++) {
                    JSONObject entry = oldRecent.optJSONObject(i);
                    if (entry != null && pkg.equals(entry.optString("pkg", ""))) {
                        existingCount = entry.optInt("count", 0);
                    }
                }
            }

            JSONObject updatedHead = new JSONObject();
            updatedHead.put("pkg", pkg);
            updatedHead.put("key", pkg);
            updatedHead.put("ts", eventTs);
            updatedHead.put("count", existingCount + 1);
            newRecent.put(updatedHead);

            if (oldRecent != null) {
                for (int i = 0; i < oldRecent.length() && newRecent.length() < MAX_RECENT; i++) {
                    JSONObject entry = oldRecent.optJSONObject(i);
                    if (entry != null && !pkg.equals(entry.optString("pkg", ""))) {
                        newRecent.put(entry);
                    }
                }
            }

            root.put("recent", newRecent);
            root.put("lastPkg", pkg);
            root.put("lastKey", pkg);
            root.put("lastTs", eventTs);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
