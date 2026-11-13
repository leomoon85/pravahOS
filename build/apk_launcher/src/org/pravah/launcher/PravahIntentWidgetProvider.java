package org.pravah.launcher;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

public class PravahIntentWidgetProvider extends AppWidgetProvider {
    private static final String PREFS_NAME = "pravah_intent_widget_prefs";
    private static final String KEY_PROMPT = "last_prompt";
    private static final String KEY_OUTCOME = "last_outcome";
    private static final String KEY_BADGE = "last_badge";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String prompt = prefs.getString(KEY_PROMPT, "Ask anything, or tap a goal below...");
        String outcome = prefs.getString(KEY_OUTCOME, "Ready: Flight AI-202 • Gate 14B • 0-Cloud Enclave");
        String badge = prefs.getString(KEY_BADGE, "✓ 0-CLOUD DAG");

        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = buildRemoteViews(context, prompt, outcome, badge);
            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
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
        views.setTextViewText(R.id.widget_prompt_text, prompt);
        views.setTextViewText(R.id.widget_outcome_text, outcome);
        views.setTextViewText(R.id.widget_status_badge, badge);

        PendingIntent openComposer = createScenarioIntent(context, 100, "");
        views.setOnClickPendingIntent(R.id.widget_prompt_bar, openComposer);
        views.setOnClickPendingIntent(R.id.widget_btn_ask, openComposer);
        views.setOnClickPendingIntent(R.id.widget_outcome_text, openComposer);

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
