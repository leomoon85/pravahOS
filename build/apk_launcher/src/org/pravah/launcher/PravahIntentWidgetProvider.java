package org.pravah.launcher;

import android.app.PendingIntent;
import android.app.UiModeManager;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.widget.RemoteViews;

public class PravahIntentWidgetProvider extends AppWidgetProvider {
    private static final String PREFS_NAME = "pravah_intent_widget_prefs";
    private static final String VISTA_PREFS_NAME = "pravah_vista_theme";
    private static final String KEY_PROMPT = "last_prompt";
    private static final String KEY_OUTCOME = "last_outcome";
    private static final String KEY_BADGE = "last_badge";

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && Intent.ACTION_CONFIGURATION_CHANGED.equals(intent.getAction())) {
            refreshAllWidgets(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String prompt = prefs.getString(KEY_PROMPT, "Ask Gemini anything, or tap an action...");
        String outcome = prefs.getString(KEY_OUTCOME, "Gemini Ready: Smart summaries & instant actions");
        String badge = prefs.getString(KEY_BADGE, "✦ GEMINI ON-DEVICE");

        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = buildRemoteViews(context, prompt, outcome, badge);
            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }

    public static void refreshAllWidgets(Context context) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String prompt = prefs.getString(KEY_PROMPT, "Ask Gemini anything, or tap an action...");
        String outcome = prefs.getString(KEY_OUTCOME, "Gemini Ready: Smart summaries & instant actions");
        String badge = prefs.getString(KEY_BADGE, "✦ GEMINI ON-DEVICE");
        updateAllWidgets(context, prompt, outcome, badge);
    }

    public static boolean isLightTheme(Context context) {
        if (context == null) return false;
        SharedPreferences vistaPrefs = context.getSharedPreferences(VISTA_PREFS_NAME, Context.MODE_PRIVATE);
        String mode = vistaPrefs.getString("mode", "system");
        if ("white".equalsIgnoreCase(mode)) return true;
        if ("black".equalsIgnoreCase(mode) || "custom".equalsIgnoreCase(mode) || "wallpaper".equalsIgnoreCase(mode)) {
            return false;
        }
        try {
            UiModeManager uiManager = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
            if (uiManager != null && uiManager.getNightMode() == UiModeManager.MODE_NIGHT_YES) {
                return false;
            }
            if (uiManager != null && uiManager.getNightMode() == UiModeManager.MODE_NIGHT_NO) {
                return true;
            }
        } catch (Exception ignored) {}
        int nightMask = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return nightMask != Configuration.UI_MODE_NIGHT_YES;
    }

    public static void updateAllWidgets(Context context, String promptText, String outcomeText, String badgeText) {
        if (context == null) return;
        String safePrompt = (promptText != null && !promptText.trim().isEmpty())
                ? promptText.trim()
                : "Ask anything, or tap a goal below...";
        String safeOutcome = (outcomeText != null && !outcomeText.trim().isEmpty())
                ? outcomeText.trim()
                : "Ready: 0-Cloud Intention Enclave";
        String safeBadge = (badgeText != null && !badgeText.trim().isEmpty())
                ? badgeText.trim()
                : "✓ EXECUTED";

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_PROMPT, safePrompt)
                .putString(KEY_OUTCOME, safeOutcome)
                .putString(KEY_BADGE, safeBadge)
                .apply();

        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PravahIntentWidgetProvider.class));
        if (ids != null && ids.length > 0) {
            RemoteViews views = buildRemoteViews(context, safePrompt, safeOutcome, safeBadge);
            manager.updateAppWidget(ids, views);
        }
    }

    private static RemoteViews buildRemoteViews(Context context, String prompt, String outcome, String badge) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.pravah_intent_widget);
        boolean light = isLightTheme(context);

        views.setTextViewText(R.id.widget_prompt_text, prompt);
        views.setTextViewText(R.id.widget_outcome_text, outcome);
        views.setTextViewText(R.id.widget_status_badge, badge);

        views.setInt(R.id.widget_root_card, "setBackgroundResource",
                light ? R.drawable.bg_intent_widget_light : R.drawable.bg_intent_widget);
        views.setInt(R.id.widget_prompt_bar, "setBackgroundResource",
                light ? R.drawable.bg_intent_bar_light : R.drawable.bg_intent_bar);

        int chipBg = light ? R.drawable.bg_intent_chip_light : R.drawable.bg_intent_chip;
        views.setInt(R.id.widget_status_badge, "setBackgroundResource", chipBg);
        views.setInt(R.id.widget_btn_ask, "setBackgroundResource", chipBg);
        views.setInt(R.id.widget_chip_flight, "setBackgroundResource", chipBg);
        views.setInt(R.id.widget_chip_note, "setBackgroundResource", chipBg);
        views.setInt(R.id.widget_chip_usdc, "setBackgroundResource", chipBg);
        views.setInt(R.id.widget_chip_ram, "setBackgroundResource", chipBg);
        views.setInt(R.id.widget_btn_open_metro, "setBackgroundResource", chipBg);
        views.setInt(R.id.widget_outcome_box, "setBackgroundResource",
                light ? R.drawable.bg_intent_outcome_glass_light : R.drawable.bg_intent_outcome_glass);

        views.setTextColor(R.id.widget_status_badge, Color.parseColor(light ? "#0284C7" : "#38BDF8"));
        views.setTextColor(R.id.widget_prompt_text, Color.parseColor(light ? "#0F172A" : "#F8FAFC"));
        views.setTextColor(R.id.widget_btn_ask, Color.parseColor(light ? "#0369A1" : "#7DD3FC"));
        int chipTextColor = Color.parseColor(light ? "#0F172A" : "#F1F5F9");
        views.setTextColor(R.id.widget_chip_flight, chipTextColor);
        views.setTextColor(R.id.widget_chip_note, chipTextColor);
        views.setTextColor(R.id.widget_chip_usdc, chipTextColor);
        views.setTextColor(R.id.widget_chip_ram, chipTextColor);
        views.setTextColor(R.id.widget_outcome_title, Color.parseColor(light ? "#0284C7" : "#38BDF8"));
        views.setTextColor(R.id.widget_outcome_text, Color.parseColor(light ? "#1E293B" : "#E2E8F0"));
        views.setTextColor(R.id.widget_telemetry_pill, Color.parseColor(light ? "#0369A1" : "#7DD3FC"));
        views.setTextColor(R.id.widget_btn_open_metro, Color.parseColor(light ? "#0369A1" : "#E0F2FE"));

        PendingIntent openComposer = createScenarioIntent(context, 100, "");
        views.setOnClickPendingIntent(R.id.widget_prompt_bar, openComposer);
        views.setOnClickPendingIntent(R.id.widget_btn_ask, openComposer);
        views.setOnClickPendingIntent(R.id.widget_outcome_box, openComposer);

        Intent metroIntent = new Intent(context, MainActivity.class);
        metroIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        PendingIntent openMetro = PendingIntent.getActivity(
                context, 105, metroIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_btn_open_metro, openMetro);

        views.setOnClickPendingIntent(R.id.widget_chip_flight, createScenarioIntent(context, 101, "flight"));
        views.setOnClickPendingIntent(R.id.widget_chip_note, createScenarioIntent(context, 102, "camera_note"));
        views.setOnClickPendingIntent(R.id.widget_chip_usdc, createScenarioIntent(context, 103, "crypto"));
        views.setOnClickPendingIntent(R.id.widget_chip_ram, createScenarioIntent(context, 104, "memory"));

        return views;
    }

    private static PendingIntent createScenarioIntent(Context context, int requestCode, String scenario) {
        Intent intent = new Intent(context, IntentWidgetActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        if (scenario != null && !scenario.isEmpty()) {
            intent.putExtra("extra_scenario", scenario);
        }
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
