package org.pravah.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.View;

/**
 * Non-interactive Windows Vista Aero Glass visual layer composited cleanly over
 * the Pixel Home Screen workspace (Smartspace capsule, App row shelf, and Hotseat dock).
 */
public class HomeGlassOverlayView extends View {
    private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint sheenPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint innerRimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path clipPath = new Path();

    private boolean lightTheme = false;
    private boolean customTheme = false;
    private int customColor = 0xFF0B2847;

    public HomeGlassOverlayView(Context context) {
        super(context);
        strokePaint.setStyle(Paint.Style.STROKE);
        innerRimPaint.setStyle(Paint.Style.STROKE);
        setWillNotDraw(false);
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        refreshThemeState();
    }

    public void refreshThemeState() {
        Context ctx = getContext();
        if (ctx != null) {
            SharedPreferences prefs = ctx.getSharedPreferences("pravah_vista_theme", Context.MODE_PRIVATE);
            String mode = prefs.getString("mode", "system");
            String customHex = prefs.getString("custom_color", "#0b2847");
            lightTheme = PravahIntentWidgetProvider.isLightTheme(ctx);
            customTheme = !lightTheme && "custom".equalsIgnoreCase(mode);
            try {
                customColor = Color.parseColor(customHex);
            } catch (Exception ignored) {
                customColor = 0xFF0B2847;
            }
        }
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int w = getWidth();
        int h = getHeight();
        if (w <= 0 || h <= 0) return;

        // 1. Top Smartspace / At-a-Glance Vista Glass Capsule
        RectF smartspace = new RectF(
                0.056f * w,
                0.122f * h,
                0.944f * w,
                0.178f * h
        );
        drawAeroGlassPanel(canvas, smartspace, dp(20));

        // 2. Home Workspace App Row Glass Shelf (Gmail, Photos, YouTube row)
        RectF appShelf = new RectF(
                0.052f * w,
                0.608f * h,
                0.948f * w,
                0.744f * h
        );
        drawAeroGlassPanel(canvas, appShelf, dp(24));

        // 3. Hotseat & Google Search Aero Glass Dock Tray
        RectF dockTray = new RectF(
                0.046f * w,
                0.768f * h,
                0.954f * w,
                0.962f * h
        );
        drawAeroGlassPanel(canvas, dockTray, dp(28));
    }

    private void drawAeroGlassPanel(Canvas canvas, RectF rect, float radius) {
        int startFill;
        int endFill;
        int outerRim;

        if (lightTheme) {
            startFill = Color.argb(64, 232, 246, 255);
            endFill = Color.argb(42, 190, 224, 248);
            outerRim = Color.argb(215, 255, 255, 255);
        } else if (customTheme) {
            int r = Color.red(customColor);
            int g = Color.green(customColor);
            int b = Color.blue(customColor);
            startFill = Color.argb(72, r, g, b);
            endFill = Color.argb(96, Math.max(0, r / 3), Math.max(0, g / 3), Math.max(0, b / 3));
            outerRim = Color.argb(175, 190, 232, 255);
        } else {
            startFill = Color.argb(62, 18, 56, 102);
            endFill = Color.argb(88, 7, 18, 36);
            outerRim = Color.argb(165, 154, 222, 255);
        }

        fillPaint.setShader(new LinearGradient(
                rect.left, rect.top, rect.right * 0.4f, rect.bottom,
                startFill, endFill, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(rect, radius, radius, fillPaint);

        // Clipped upper-half Aero Glass diagonal specular sheen
        int saveCount = canvas.save();
        clipPath.reset();
        clipPath.addRoundRect(rect, radius, radius, Path.Direction.CW);
        canvas.clipPath(clipPath);

        float sheenBottom = rect.top + rect.height() * 0.44f;
        sheenPaint.setShader(new LinearGradient(
                rect.left, rect.top, rect.left + rect.width() * 0.14f, sheenBottom,
                Color.argb(lightTheme ? 105 : 68, 255, 255, 255),
                Color.argb(0, 255, 255, 255),
                Shader.TileMode.CLAMP));
        canvas.drawRect(rect.left, rect.top, rect.right, sheenBottom, sheenPaint);
        canvas.restoreToCount(saveCount);

        // Inner crisp specular bevel rim + outer luminous Aero glass rim
        RectF innerRect = new RectF(rect.left + dp(1.3f), rect.top + dp(1.3f), rect.right - dp(1.3f), rect.bottom - dp(1.3f));
        innerRimPaint.setStrokeWidth(dp(1.0f));
        innerRimPaint.setColor(Color.argb(lightTheme ? 185 : 92, 255, 255, 255));
        canvas.drawRoundRect(innerRect, Math.max(4f, radius - dp(1.3f)), Math.max(4f, radius - dp(1.3f)), innerRimPaint);

        strokePaint.setStrokeWidth(dp(1.4f));
        strokePaint.setColor(outerRim);
        canvas.drawRoundRect(rect, radius, radius, strokePaint);
    }

    private float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }
}
