package org.pravah.launcher;

import android.app.Activity;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.webkit.JavascriptInterface;
import java.util.List;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Immersive Fullscreen OS Mode
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        webView = new WebView(this);
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
                // Immediately open the Windows Metro Living Drawer
                view.evaluateJavascript(
                    "setTimeout(function() { if (window.PravahLivingDrawer) window.PravahLivingDrawer.expand(); }, 200);",
                    null
                );
            }
        });

        // Load local bundled assets
        webView.loadUrl("file:///android_asset/shell/index.html");
    }

    @Override
    public void onBackPressed() {
        finish();
    }

    public class PravahBridge {
        @JavascriptInterface
        public void launchApp(String packageName) {
            PackageManager pm = getPackageManager();
            Intent intent = pm.getLaunchIntentForPackage(packageName);
            if (intent != null) {
                startActivity(intent);
            }
        }

        @JavascriptInterface
        public String getInstalledApps() {
            PackageManager pm = getPackageManager();
            Intent intent = new Intent(Intent.ACTION_MAIN, null);
            intent.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> apps = pm.queryIntentActivities(intent, 0);
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < apps.size(); i++) {
                ResolveInfo ri = apps.get(i);
                sb.append("{\"label\":\"").append(ri.loadLabel(pm))
                  .append("\",\"pkg\":\"").append(ri.activityInfo.packageName).append("\"}");
                if (i < apps.size() - 1) sb.append(",");
            }
            sb.append("]");
            return sb.toString();
        }
    }
}
