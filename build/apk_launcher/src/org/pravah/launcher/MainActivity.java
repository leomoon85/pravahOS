package org.pravah.launcher;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class MainActivity extends Activity {
    private WebView webView;
    private boolean pageLoaded = false;
    private String cachedInstalledAppsJson = null;
    private int cachedAppsCount = -1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Immersive Fullscreen OS Mode with Live Wallpaper Compositing
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        // Native PravahOS System Bridge
        webView.addJavascriptInterface(new PravahBridge(), "PravahNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                expandDrawer();
            }
        });

        // Load local bundled assets
        webView.loadUrl("file:///android_asset/shell/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        overridePendingTransition(0, 0);
        if (pageLoaded && webView != null) {
            expandDrawer();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        overridePendingTransition(0, 0);
        if (pageLoaded && webView != null) {
            expandDrawer();
        }
    }

    private boolean isSystemNightMode() {
        try {
            android.app.UiModeManager uiManager = (android.app.UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (uiManager != null && uiManager.getNightMode() == android.app.UiModeManager.MODE_NIGHT_YES) {
                return true;
            }
            if (uiManager != null && uiManager.getNightMode() == android.app.UiModeManager.MODE_NIGHT_NO) {
                return false;
            }
        } catch (Exception ignored) {}
        int nightMask = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return nightMask == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (pageLoaded && webView != null && newConfig != null) {
            boolean isNight = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            final String sysTheme = isNight ? "dark" : "light";
            webView.evaluateJavascript(
                "if (window.livingDrawer && window.livingDrawer.onSystemThemeChanged) { window.livingDrawer.onSystemThemeChanged('" + sysTheme + "'); }",
                null
            );
        }
    }

    private void expandDrawer() {
        if (webView == null) return;
        webView.evaluateJavascript(
            "setTimeout(function() { " +
            "if (typeof document !== 'undefined' && document.body) { document.body.classList.add('native-metro-mode'); } " +
            "if (window.livingDrawer) { window.livingDrawer.expand(); window.livingDrawer.syncSystemTheme && window.livingDrawer.syncSystemTheme(); window.livingDrawer.syncNativeTelemetry && window.livingDrawer.syncNativeTelemetry(); } " +
            "else if (window.toggleLivingDrawer) { window.toggleLivingDrawer(true); } " +
            "}, 150);",
            null
        );
    }

    private void returnToPixelHome() {
        try {
            Intent homeIntent = new Intent(Intent.ACTION_MAIN);
            homeIntent.addCategory(Intent.CATEGORY_HOME);
            homeIntent.setPackage("com.google.android.apps.nexuslauncher");
            homeIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            startActivity(homeIntent);
            overridePendingTransition(0, 0);
        } catch (Exception e) {
            moveTaskToBack(true);
        }
    }

    @Override
    public void onBackPressed() {
        returnToPixelHome();
    }

    private static String drawableToDataUri(Drawable drawable) {
        if (drawable == null) return "";
        try {
            int size = 96;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
            drawable.draw(canvas);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 90, baos);
            bitmap.recycle();
            byte[] bytes = baos.toByteArray();
            return "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    private static String escapeJson(String input) {
        if (input == null) return "";
        StringBuilder sb = new StringBuilder(input.length() + 8);
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                    break;
            }
        }
        return sb.toString();
    }

    public class PravahBridge {
        @JavascriptInterface
        public void closeMetroDrawer() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    returnToPixelHome();
                }
            });
        }

        @JavascriptInterface
        public void syncIntentWidget(String prompt, String outcome, String badge) {
            PravahIntentWidgetProvider.updateAllWidgets(MainActivity.this, prompt, outcome, badge);
        }

        @JavascriptInterface
        public void openFloatingIntentWidget(String scenario) {
            Intent intent = new Intent(MainActivity.this, IntentWidgetActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            if (scenario != null && !scenario.isEmpty()) {
                intent.putExtra("extra_scenario", scenario);
            }
            startActivity(intent);
        }

        @JavascriptInterface
        public String getVistaThemeConfig() {
            SharedPreferences prefs = getSharedPreferences("pravah_vista_theme", MODE_PRIVATE);
            String mode = prefs.getString("mode", "system");
            String customColor = prefs.getString("custom_color", "#0b2847");
            String sysTheme = isSystemNightMode() ? "dark" : "light";
            return "{\"mode\":\"" + escapeJson(mode) + "\","
                 + "\"customColor\":\"" + escapeJson(customColor) + "\","
                 + "\"systemTheme\":\"" + sysTheme + "\"}";
        }

        @JavascriptInterface
        public void saveVistaThemeConfig(String mode, String customColor) {
            SharedPreferences prefs = getSharedPreferences("pravah_vista_theme", MODE_PRIVATE);
            prefs.edit()
                .putString("mode", mode != null ? mode : "system")
                .putString("custom_color", customColor != null ? customColor : "#0b2847")
                .apply();
        }

        @JavascriptInterface
        public void launchApp(String packageName) {
            if (packageName == null || packageName.isEmpty()) return;
            PackageManager pm = getPackageManager();
            Intent intent = pm.getLaunchIntentForPackage(packageName);
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            }
        }

        @JavascriptInterface
        public String getLiveSystemTelemetry() {
            int levelPct = 100;
            int voltageMv = 4200;
            double tempC = 30.0;
            boolean charging = false;
            int batteryStatus = BatteryManager.BATTERY_STATUS_UNKNOWN;

            try {
                IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                Intent batteryIntent = registerReceiver(null, ifilter);
                if (batteryIntent != null) {
                    int level = batteryIntent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = batteryIntent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                    if (level >= 0 && scale > 0) {
                        levelPct = Math.round((level * 100.0f) / scale);
                    }
                    voltageMv = batteryIntent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 4200);
                    int tempTenths = batteryIntent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 300);
                    tempC = tempTenths / 10.0;
                    batteryStatus = batteryIntent.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN);
                    int plugged = batteryIntent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
                    charging = (batteryStatus == BatteryManager.BATTERY_STATUS_CHARGING) || (plugged != 0);
                }
            } catch (Exception ignored) {}

            boolean musicActive = false;
            int musicVol = 0;
            int musicMaxVol = 15;
            try {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    musicActive = am.isMusicActive();
                    musicVol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                    musicMaxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                }
            } catch (Exception ignored) {}

            boolean airgap = false;
            try {
                airgap = Settings.Global.getInt(getContentResolver(), Settings.Global.AIRPLANE_MODE_ON, 0) != 0;
            } catch (Exception ignored) {}

            StringBuilder json = new StringBuilder();
            json.append("{");
            json.append("\"battery\":{")
                .append("\"level\":").append(levelPct).append(",")
                .append("\"charging\":").append(charging).append(",")
                .append("\"voltageMv\":").append(voltageMv).append(",")
                .append("\"tempC\":").append(String.format(java.util.Locale.US, "%.1f", tempC)).append(",")
                .append("\"statusCode\":").append(batteryStatus)
                .append("},");
            json.append("\"audio\":{")
                .append("\"musicActive\":").append(musicActive).append(",")
                .append("\"volume\":").append(musicVol).append(",")
                .append("\"maxVolume\":").append(musicMaxVol)
                .append("},");
            json.append("\"airgap\":").append(airgap);
            json.append("}");
            return json.toString();
        }

        @JavascriptInterface
        public String getInstalledApps() {
            final PackageManager pm = getPackageManager();
            Intent intent = new Intent(Intent.ACTION_MAIN, null);
            intent.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> apps = pm.queryIntentActivities(intent, 0);
            if (cachedInstalledAppsJson != null && apps.size() == cachedAppsCount) {
                return cachedInstalledAppsJson;
            }
            Collections.sort(apps, new Comparator<ResolveInfo>() {
                @Override
                public int compare(ResolveInfo a, ResolveInfo b) {
                    String la = String.valueOf(a.loadLabel(pm));
                    String lb = String.valueOf(b.loadLabel(pm));
                    return la.compareToIgnoreCase(lb);
                }
            });

            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (int i = 0; i < apps.size(); i++) {
                ResolveInfo ri = apps.get(i);
                String pkg = ri.activityInfo != null ? ri.activityInfo.packageName : "";
                if (pkg.isEmpty() || "org.pravah.launcher".equals(pkg)) {
                    continue;
                }
                String label = String.valueOf(ri.loadLabel(pm));
                boolean isPravah = pkg.startsWith("org.pravah.");
                String iconDataUri = "";
                try {
                    Drawable iconDrawable = ri.loadIcon(pm);
                    iconDataUri = drawableToDataUri(iconDrawable);
                } catch (Exception ignored) {}
                if (!first) sb.append(",");
                first = false;
                sb.append("{")
                  .append("\"label\":\"").append(escapeJson(label)).append("\",")
                  .append("\"pkg\":\"").append(escapeJson(pkg)).append("\",")
                  .append("\"isPravah\":").append(isPravah).append(",")
                  .append("\"icon\":\"").append(escapeJson(iconDataUri)).append("\"")
                  .append("}");
            }
            sb.append("]");
            cachedAppsCount = apps.size();
            cachedInstalledAppsJson = sb.toString();
            return cachedInstalledAppsJson;
        }
    }
}
