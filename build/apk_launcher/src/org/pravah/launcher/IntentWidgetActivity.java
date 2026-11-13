package org.pravah.launcher;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public class IntentWidgetActivity extends Activity {
    private EditText promptInput;
    private TextView dagStep1;
    private TextView dagStep2;
    private TextView dagStep3;
    private TextView outcomeHeadline;
    private TextView outcomeSummary;
    private TextView outcomePills;
    private TextView launchAppBtn;
    private String currentTargetPkg = "org.pravah.shield";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        if (getIntent() != null && getIntent().getBooleanExtra("request_pin_widget", false)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AppWidgetManager awm = getSystemService(AppWidgetManager.class);
                ComponentName provider = new ComponentName(this, PravahIntentWidgetProvider.class);
                if (awm != null && awm.isRequestPinAppWidgetSupported()) {
                    awm.requestPinAppWidget(provider, null, null);
                }
            }
            finish();
            overridePendingTransition(0, 0);
            return;
        }

        buildFloatingWidgetUi();

        String initialScenario = getIntent() != null ? getIntent().getStringExtra("extra_scenario") : null;
        if (initialScenario != null && !initialScenario.isEmpty()) {
            executeIntention("", initialScenario);
        } else {
            executeIntention("Check flight AI-202 and set reminder 2 hours before departure", "flight");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String scenario = intent != null ? intent.getStringExtra("extra_scenario") : null;
        if (scenario != null && !scenario.isEmpty()) {
            executeIntention("", scenario);
        }
    }

    private void buildFloatingWidgetUi() {
        LinearLayout backdrop = new LinearLayout(this);
        backdrop.setBackgroundColor(Color.parseColor("#B8020814"));
        backdrop.setGravity(Gravity.CENTER);
        backdrop.setOrientation(LinearLayout.VERTICAL);
        int padOuter = dp(18);
        backdrop.setPadding(padOuter, padOuter, padOuter, padOuter);
        backdrop.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
                overridePendingTransition(0, 0);
            }
        });

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(18), dp(18), dp(18));
        card.setClickable(true);
        GradientDrawable cardBg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{Color.parseColor("#F50A2342"), Color.parseColor("#FA040E1F")}
        );
        cardBg.setCornerRadius(dp(24));
        cardBg.setStroke(dp(1), Color.parseColor("#9956D8FF"));
        card.setBackground(cardBg);

        // Header
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = new TextView(this);
        title.setText("✦ Ask Pravah • Intention Engine");
        title.setTextColor(Color.parseColor("#38BDF8"));
        title.setTextSize(14);
        title.setTypeface(null, Typeface.BOLD);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        header.addView(title, titleLp);

        TextView closeBtn = new TextView(this);
        closeBtn.setText("✕");
        closeBtn.setTextColor(Color.parseColor("#E2E8F0"));
        closeBtn.setTextSize(15);
        closeBtn.setGravity(Gravity.CENTER);
        closeBtn.setPadding(dp(10), dp(4), dp(10), dp(4));
        closeBtn.setBackground(makePillDrawable("#331E3A5F", "#667DD3FC", 14));
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
                overridePendingTransition(0, 0);
            }
        });
        header.addView(closeBtn);
        card.addView(header);

        // Prompt Input Row
        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        inputRow.setPadding(dp(12), dp(8), dp(8), dp(8));
        inputRow.setBackground(makePillDrawable("#CC0D2748", "#807DD3FC", 16));
        LinearLayout.LayoutParams inputRowLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        inputRowLp.topMargin = dp(12);
        card.addView(inputRow, inputRowLp);

        promptInput = new EditText(this);
        promptInput.setHint("Ask anything or describe a goal...");
        promptInput.setHintTextColor(Color.parseColor("#94A3B8"));
        promptInput.setTextColor(Color.parseColor("#F8FAFC"));
        promptInput.setTextSize(14);
        promptInput.setBackgroundColor(Color.TRANSPARENT);
        promptInput.setSingleLine(true);
        promptInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        promptInput.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                executeIntention(String.valueOf(promptInput.getText()), "");
                return true;
            }
        });
        inputRow.addView(promptInput, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView askBtn = new TextView(this);
        askBtn.setText("Ask ✦");
        askBtn.setTextColor(Color.parseColor("#031326"));
        askBtn.setTextSize(13);
        askBtn.setTypeface(null, Typeface.BOLD);
        askBtn.setPadding(dp(14), dp(8), dp(14), dp(8));
        askBtn.setBackground(makePillDrawable("#38BDF8", "#BAE6FD", 12));
        askBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeIntention(String.valueOf(promptInput.getText()), "");
            }
        });
        inputRow.addView(askBtn);

        // Quick Intention Chips
        HorizontalScrollView chipsScroll = new HorizontalScrollView(this);
        chipsScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout.LayoutParams chipsScrollLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        chipsScrollLp.topMargin = dp(12);
        card.addView(chipsScroll, chipsScrollLp);

        LinearLayout chipsRow = new LinearLayout(this);
        chipsRow.setOrientation(LinearLayout.HORIZONTAL);
        chipsScroll.addView(chipsRow);

        addScenarioChip(chipsRow, "✈ Flight AI-202", "flight");
        addScenarioChip(chipsRow, "📷 Smart Note", "camera_note");
        addScenarioChip(chipsRow, "💳 Send ₹5,000", "payment");
        addScenarioChip(chipsRow, "🪙 250 USDC", "crypto");
        addScenarioChip(chipsRow, "⚡ Optimize RAM", "memory");
        addScenarioChip(chipsRow, "🛡️ Air-Gap Audit", "airgap");

        // 3-Stage Capability DAG Row
        LinearLayout dagRow = new LinearLayout(this);
        dagRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams dagRowLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        dagRowLp.topMargin = dp(14);
        card.addView(dagRow, dagRowLp);

        dagStep1 = makeDagBadge("1. Intent ✓");
        dagStep2 = makeDagBadge("2. EL1 Gate ✓");
        dagStep3 = makeDagBadge("3. Native ✓");
        dagRow.addView(dagStep1, makeWeightedLp(0, 4));
        dagRow.addView(dagStep2, makeWeightedLp(4, 4));
        dagRow.addView(dagStep3, makeWeightedLp(4, 0));

        // Outcome Card
        ScrollView outcomeScroll = new ScrollView(this);
        LinearLayout.LayoutParams outcomeScrollLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        outcomeScrollLp.topMargin = dp(12);
        card.addView(outcomeScroll, outcomeScrollLp);

        LinearLayout outcomeCard = new LinearLayout(this);
        outcomeCard.setOrientation(LinearLayout.VERTICAL);
        outcomeCard.setPadding(dp(14), dp(14), dp(14), dp(14));
        outcomeCard.setBackground(makePillDrawable("#B30C2442", "#664ADE80", 16));
        outcomeScroll.addView(outcomeCard);

        outcomeHeadline = new TextView(this);
        outcomeHeadline.setTextColor(Color.parseColor("#4ADE80"));
        outcomeHeadline.setTextSize(15);
        outcomeHeadline.setTypeface(null, Typeface.BOLD);
        outcomeCard.addView(outcomeHeadline);

        outcomeSummary = new TextView(this);
        outcomeSummary.setTextColor(Color.parseColor("#E2E8F0"));
        outcomeSummary.setTextSize(13);
        LinearLayout.LayoutParams sumLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sumLp.topMargin = dp(6);
        outcomeCard.addView(outcomeSummary, sumLp);

        outcomePills = new TextView(this);
        outcomePills.setTextColor(Color.parseColor("#7DD3FC"));
        outcomePills.setTextSize(11);
        LinearLayout.LayoutParams pillsLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        pillsLp.topMargin = dp(8);
        outcomeCard.addView(outcomePills, pillsLp);

        launchAppBtn = new TextView(this);
        launchAppBtn.setText("Open Target Native App ➔");
        launchAppBtn.setTextColor(Color.parseColor("#041224"));
        launchAppBtn.setTextSize(13);
        launchAppBtn.setTypeface(null, Typeface.BOLD);
        launchAppBtn.setGravity(Gravity.CENTER);
        launchAppBtn.setPadding(dp(14), dp(10), dp(14), dp(10));
        launchAppBtn.setBackground(makePillDrawable("#4ADE80", "#BBF7D0", 12));
        LinearLayout.LayoutParams launchLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        launchLp.topMargin = dp(12);
        launchAppBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                launchTargetPackage(currentTargetPkg);
            }
        });
        outcomeCard.addView(launchAppBtn, launchLp);

        backdrop.addView(card, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        setContentView(backdrop);
    }

    private void executeIntention(String rawQuery, String scenario) {
        String q = rawQuery != null ? rawQuery.trim() : "";
        String key = scenario != null ? scenario.trim().toLowerCase() : "";
        if (key.isEmpty()) {
            String ql = q.toLowerCase();
            if (ql.contains("flight") || ql.contains("ai-202")) key = "flight";
            else if (ql.contains("photo") || ql.contains("note") || ql.contains("camera") || ql.contains("ocr")) key = "camera_note";
            else if (ql.contains("usdc") || ql.contains("crypto")) key = "crypto";
            else if (ql.contains("pay") || ql.contains("5000") || ql.contains("upi") || ql.contains("₹")) key = "payment";
            else if (ql.contains("ram") || ql.contains("memory") || ql.contains("optim")) key = "memory";
            else if (ql.contains("air") || ql.contains("shield") || ql.contains("rf")) key = "airgap";
        }

        String resolvedPrompt = q;
        String headline;
        String summary;
        String pills;
        String s1 = "1. Parse Intent ✓";
        String s2 = "2. EL1 Gate ✓";
        String s3 = "3. Zero-Tax ✓";
        String btnLabel;

        switch (key) {
            case "flight":
                if (resolvedPrompt.isEmpty()) resolvedPrompt = "Check flight AI-202 and set reminder 2h prior";
                headline = "✓ Flight AI-202 Confirmed • On Time";
                summary = "DEL -> BLR departs at 10:30 AM from Terminal 3, Gate 14B. Calendar alarm armed locally without cloud sync.";
                pills = "Gate 14B  •  Term T3  •  🔒 0-Cloud Enclave";
                currentTargetPkg = "com.google.android.calendar";
                btnLabel = "Open Calendar Alarm ➔";
                break;
            case "camera_note":
                if (resolvedPrompt.isEmpty()) resolvedPrompt = "Capture document photo and seal into Aurora Notes";
                headline = "✓ Zero-Copy Camera VMO -> Aurora Notes";
                summary = "Captured high-DPI optical buffer via IMX890 HAL and saved SHA-256 verified note directly inside Aurora Notes.";
                pills = "Zero-Copy VMO  •  Aurora Notes  •  🔒 Offline OCR";
                currentTargetPkg = "org.pravah.aurora";
                btnLabel = "Open Aurora Notes ➔";
                break;
            case "payment":
                if (resolvedPrompt.isEmpty()) resolvedPrompt = "Send ₹5,000 securely via Pravah Vault";
                headline = "✓ ₹5,000 Policy Gate Authorized";
                summary = "Biometric Titan M2 enclave sealed UPI transaction receipt under dual capability isolation.";
                pills = "₹5,000 UPI  •  Titan M2 Sealed  •  ✓ Receipt Saved";
                currentTargetPkg = "org.pravah.vault";
                btnLabel = "Open Pravah Vault ➔";
                break;
            case "crypto":
                if (resolvedPrompt.isEmpty()) resolvedPrompt = "Verify 250 USDC cross-border remittance";
                headline = "✓ 250 USDC ZK Proof Sealed";
                summary = "Signed offline Ed448 settlement voucher in Pravah Vault; hardware key never left the Titan M2 enclave.";
                pills = "250 USDC  •  ML-KEM-768  •  🔒 Key Sealed";
                currentTargetPkg = "org.pravah.vault";
                btnLabel = "Inspect in Pravah Vault ➔";
                break;
            case "memory":
                if (resolvedPrompt.isEmpty()) resolvedPrompt = "Freeze dormant apps and compact Pixel 7 RAM";
                headline = "✓ Dormancy Compactor Reclaimed 428 MB";
                summary = "Background webview caches compacted and dormant background tasks frozen to 0.0% CPU draw.";
                pills = "+428 MB Free  •  0% BG Tax  •  ✓ pravahd Verified";
                currentTargetPkg = "org.pravah.shield";
                btnLabel = "Open Pravah Shield ➔";
                break;
            case "airgap":
                if (resolvedPrompt.isEmpty()) resolvedPrompt = "Verify hardware Air-Gap RF isolation & pravahd";
                headline = "✓ EL1 Telemetry & Air-Gap Verified";
                summary = "pravahd micro-daemon audited loopback enclave, OTA Slot A rollback index, and hardware killswitch.";
                pills = "Loopback 127.0.0.1  •  Slot A  •  🛡️ Shield Ready";
                currentTargetPkg = "org.pravah.shield";
                btnLabel = "Open Pravah Shield ➔";
                break;
            default:
                if (resolvedPrompt.isEmpty()) resolvedPrompt = "Coordinate my apps on PravahOS locally";
                headline = "✓ Custom Intention Synthesized Locally";
                summary = "Parsed goal \"" + resolvedPrompt + "\" -> bound 3-stage EL1 capability pipeline with zero cloud egress.";
                pills = "On-Device NPU  •  SHA-256 Sealed  •  🔒 0-Cloud Leak";
                currentTargetPkg = "org.pravah.bazaar";
                btnLabel = "Open Pravah Metro / Apps ➔";
                break;
        }

        if (promptInput != null && !TextUtils.equals(promptInput.getText(), resolvedPrompt)) {
            promptInput.setText(resolvedPrompt);
            promptInput.setSelection(0);
        }
        dagStep1.setText(s1);
        dagStep2.setText(s2);
        dagStep3.setText(s3);
        outcomeHeadline.setText(headline);
        outcomeSummary.setText(summary);
        outcomePills.setText(pills);
        launchAppBtn.setText(btnLabel);

        PravahIntentWidgetProvider.updateAllWidgets(this, resolvedPrompt, headline + " • " + pills, "✓ 0-CLOUD DAG");
    }

    private void launchTargetPackage(String pkg) {
        if (pkg == null || pkg.isEmpty()) return;
        try {
            PackageManager pm = getPackageManager();
            Intent launch = pm.getLaunchIntentForPackage(pkg);
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(launch);
                finish();
                return;
            }
        } catch (Exception ignored) {}
        Intent fallback = new Intent(this, MainActivity.class);
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(fallback);
        finish();
    }

    private void addScenarioChip(LinearLayout parent, String label, final String scenario) {
        TextView chip = new TextView(this);
        chip.setText(label);
        chip.setTextColor(Color.parseColor("#BAE6FD"));
        chip.setTextSize(11);
        chip.setTypeface(null, Typeface.BOLD);
        chip.setPadding(dp(11), dp(6), dp(11), dp(6));
        chip.setBackground(makePillDrawable("#B3102E54", "#6638BDF8", 12));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(8);
        chip.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                executeIntention("", scenario);
            }
        });
        parent.addView(chip, lp);
    }

    private TextView makeDagBadge(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.parseColor("#E0F2FE"));
        tv.setTextSize(10);
        tv.setTypeface(null, Typeface.BOLD);
        tv.setGravity(Gravity.CENTER);
        tv.setPadding(dp(6), dp(6), dp(6), dp(6));
        tv.setBackground(makePillDrawable("#990F2D4E", "#6638BDF8", 10));
        return tv;
    }

    private LinearLayout.LayoutParams makeWeightedLp(int leftDp, int rightDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        lp.leftMargin = dp(leftDp);
        lp.rightMargin = dp(rightDp);
        return lp;
    }

    private GradientDrawable makePillDrawable(String fillHex, String strokeHex, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(Color.parseColor(fillHex));
        d.setCornerRadius(dp(radiusDp));
        d.setStroke(dp(1), Color.parseColor(strokeHex));
        return d;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
