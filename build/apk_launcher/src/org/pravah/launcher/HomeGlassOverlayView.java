package org.pravah.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.View;
import java.util.ArrayList;
import java.util.List;

/**
 * Non-interactive Windows Vista Aero Glass visual layer composited cleanly over
 * individual Pixel Home Screen icons/capsules or the pulled-down Notification Shade.
 */
public class HomeGlassOverlayView extends View {
    public static final int MODE_HOME = 0;
    public static final int MODE_NOTIFICATION_SHADE = 1;

    private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint backdropPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint haloPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint sheenPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint innerRimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint outerGlowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path clipPath = new Path();
    private final Path cutoutPath = new Path();

    private int displayMode = MODE_HOME;
    private final List<RectF> homeWorkspaceRects = new ArrayList<RectF>();
    private final List<RectF> homeHotseatRects = new ArrayList<RectF>();
    private RectF homeDateRect = null;
    private RectF homeSearchRect = null;

    private final List<RectF> shadeTileRects = new ArrayList<RectF>();
    private final List<RectF> shadeCardRects = new ArrayList<RectF>();
    private RectF shadeHeaderRect = null;
    private boolean hasLiveShadeData = false;

    private boolean lightTheme = false;
    private boolean customTheme = false;
    private int customColor = 0xFF0B2847;

    public HomeGlassOverlayView(Context context) {
        super(context);
        strokePaint.setStyle(Paint.Style.STROKE);
        innerRimPaint.setStyle(Paint.Style.STROKE);
        outerGlowPaint.setStyle(Paint.Style.STROKE);
        setWillNotDraw(false);
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        refreshThemeState();
    }

    public int getDisplayMode() {
        return displayMode;
    }

    public void setDisplayMode(int mode) {
        if (this.displayMode != mode) {
            this.displayMode = mode;
            invalidate();
        }
    }

    public void updateHomeElements(
            RectF dateRect,
            List<RectF> workspaceRects,
            List<RectF> hotseatRects,
            RectF searchRect
    ) {
        if (dateRect != null && !dateRect.isEmpty()) {
            this.homeDateRect = new RectF(dateRect);
        }
        if (searchRect != null && !searchRect.isEmpty()) {
            this.homeSearchRect = new RectF(searchRect);
        }
        if (workspaceRects != null && !workspaceRects.isEmpty()) {
            this.homeWorkspaceRects.clear();
            for (RectF r : workspaceRects) {
                if (r != null && !r.isEmpty()) {
                    this.homeWorkspaceRects.add(new RectF(r));
                }
            }
        }
        if (hotseatRects != null && !hotseatRects.isEmpty()) {
            this.homeHotseatRects.clear();
            for (RectF r : hotseatRects) {
                if (r != null && !r.isEmpty()) {
                    this.homeHotseatRects.add(new RectF(r));
                }
            }
        }
        invalidate();
    }

    public void updateShadeElements(RectF headerRect, List<RectF> tileRects, List<RectF> cardRects) {
        this.shadeHeaderRect = headerRect != null ? new RectF(headerRect) : null;
        this.shadeTileRects.clear();
        if (tileRects != null) {
            for (RectF r : tileRects) {
                if (r != null && !r.isEmpty()) {
                    this.shadeTileRects.add(new RectF(r));
                }
            }
        }
        this.shadeCardRects.clear();
        if (cardRects != null) {
            for (RectF r : cardRects) {
                if (r != null && !r.isEmpty()) {
                    this.shadeCardRects.add(new RectF(r));
                }
            }
        }
        this.hasLiveShadeData = this.shadeHeaderRect != null
                || !this.shadeTileRects.isEmpty()
                || !this.shadeCardRects.isEmpty();
        invalidate();
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

        if (displayMode == MODE_NOTIFICATION_SHADE) {
            drawNotificationShadeMode(canvas, w, h);
        } else {
            drawHomeMode(canvas, w, h);
        }
    }

    private void drawHomeMode(Canvas canvas, int w, int h) {
        float half = dp(37.5f);
        float tileRadius = dp(22f);

        // 1. Each Individual App Icon 1:1 Square Vista Aero Glass Tile (cutout preserves 100% crisp icon)
        if (!homeWorkspaceRects.isEmpty()) {
            for (RectF iconRect : homeWorkspaceRects) {
                drawHomeIconCutoutGlassTile(canvas, iconRect, tileRadius);
            }
        } else {
            float wsCy = 0.6648f * h;
            drawHomeIconCutoutGlassTile(canvas, makeSquare(0.3856f * w, wsCy, half), tileRadius);
            drawHomeIconCutoutGlassTile(canvas, makeSquare(0.6144f * w, wsCy, half), tileRadius);
            drawHomeIconCutoutGlassTile(canvas, makeSquare(0.8431f * w, wsCy, half), tileRadius);
        }

        if (!homeHotseatRects.isEmpty()) {
            for (RectF iconRect : homeHotseatRects) {
                drawHomeIconCutoutGlassTile(canvas, iconRect, tileRadius);
            }
        } else {
            float hsCy = 0.8206f * h;
            drawHomeIconCutoutGlassTile(canvas, makeSquare(0.1569f * w, hsCy, half), tileRadius);
            drawHomeIconCutoutGlassTile(canvas, makeSquare(0.3856f * w, hsCy, half), tileRadius);
            drawHomeIconCutoutGlassTile(canvas, makeSquare(0.6144f * w, hsCy, half), tileRadius);
            drawHomeIconCutoutGlassTile(canvas, makeSquare(0.8431f * w, hsCy, half), tileRadius);
        }

        // 2. Subtle Crystal Aero Rim on Hotseat Search Capsule (no interior fog or inner circles)
        RectF searchBar = homeSearchRect != null
                ? homeSearchRect
                : new RectF(0.083f * w, 0.885f * h, 0.917f * w, 0.954f * h);
        drawCrystalRimOnly(canvas, searchBar, dp(28f));
    }

    private static RectF makeSquare(float cx, float cy, float half) {
        return new RectF(cx - half, cy - half, cx + half, cy + half);
    }

    private void drawHomeIconCutoutGlassTile(Canvas canvas, RectF rect, float radius) {
        float cx = rect.centerX();
        float cy = rect.centerY();
        float iconRadius = dp(29.0f);

        int startFill;
        int endFill;
        int outerRim;
        int innerBevel;
        int iconRingColor;
        int outerGlowColor;

        if (lightTheme) {
            startFill = Color.argb(135, 235, 248, 255);
            endFill = Color.argb(92, 162, 214, 250);
            outerRim = Color.argb(235, 255, 255, 255);
            innerBevel = Color.argb(190, 255, 255, 255);
            iconRingColor = Color.argb(195, 255, 255, 255);
            outerGlowColor = Color.argb(52, 120, 198, 255);
        } else if (customTheme) {
            int r = Color.red(customColor);
            int g = Color.green(customColor);
            int b = Color.blue(customColor);
            startFill = Color.argb(138, Math.min(255, r + 40), Math.min(255, g + 55), Math.min(255, b + 70));
            endFill = Color.argb(115, Math.max(0, r / 2), Math.max(0, g / 2), Math.max(0, b / 2));
            outerRim = Color.argb(215, 190, 238, 255);
            innerBevel = Color.argb(125, 255, 255, 255);
            iconRingColor = Color.argb(150, 195, 240, 255);
            outerGlowColor = Color.argb(46, 110, 205, 255);
        } else {
            startFill = Color.argb(135, 38, 108, 184);
            endFill = Color.argb(112, 10, 32, 66);
            outerRim = Color.argb(215, 156, 226, 255);
            innerBevel = Color.argb(120, 255, 255, 255);
            iconRingColor = Color.argb(145, 175, 234, 255);
            outerGlowColor = Color.argb(44, 86, 192, 255);
        }

        RectF glowRect = new RectF(rect.left - dp(1.5f), rect.top - dp(1.5f), rect.right + dp(1.5f), rect.bottom + dp(1.5f));
        outerGlowPaint.setStrokeWidth(dp(2.6f));
        outerGlowPaint.setColor(outerGlowColor);
        canvas.drawRoundRect(glowRect, radius + dp(1.5f), radius + dp(1.5f), outerGlowPaint);

        int saveCount = canvas.save();
        clipPath.reset();
        clipPath.addRoundRect(rect, radius, radius, Path.Direction.CW);
        cutoutPath.reset();
        cutoutPath.addCircle(cx, cy, iconRadius, Path.Direction.CW);
        clipPath.op(cutoutPath, Path.Op.DIFFERENCE);
        canvas.clipPath(clipPath);

        fillPaint.setShader(new LinearGradient(
                rect.left, rect.top, rect.right, rect.bottom,
                startFill, endFill, Shader.TileMode.CLAMP));
        canvas.drawRect(rect, fillPaint);

        float haloRadius = rect.width() * 0.62f;
        haloPaint.setShader(new RadialGradient(
                cx, rect.top + rect.height() * 0.25f, haloRadius,
                Color.argb(lightTheme ? 110 : 84, 205, 242, 255),
                Color.argb(0, 255, 255, 255),
                Shader.TileMode.CLAMP));
        canvas.drawCircle(cx, rect.top + rect.height() * 0.25f, haloRadius, haloPaint);

        float sheenBottom = rect.top + rect.height() * 0.50f;
        sheenPaint.setShader(new LinearGradient(
                rect.left, rect.top, rect.left + rect.width() * 0.18f, sheenBottom,
                Color.argb(lightTheme ? 165 : 118, 255, 255, 255),
                Color.argb(12, 255, 255, 255),
                Shader.TileMode.CLAMP));
        canvas.drawRect(rect.left, rect.top, rect.right, sheenBottom, sheenPaint);

        canvas.restoreToCount(saveCount);

        innerRimPaint.setStrokeWidth(dp(1.2f));
        innerRimPaint.setColor(iconRingColor);
        canvas.drawCircle(cx, cy, iconRadius, innerRimPaint);

        RectF innerRect = new RectF(rect.left + dp(1.4f), rect.top + dp(1.4f), rect.right - dp(1.4f), rect.bottom - dp(1.4f));
        innerRimPaint.setStrokeWidth(dp(1.0f));
        innerRimPaint.setColor(innerBevel);
        canvas.drawRoundRect(innerRect, Math.max(4f, radius - dp(1.4f)), Math.max(4f, radius - dp(1.4f)), innerRimPaint);

        strokePaint.setStrokeWidth(dp(1.5f));
        strokePaint.setColor(outerRim);
        canvas.drawRoundRect(rect, radius, radius, strokePaint);
    }

    private void drawCrystalRimOnly(Canvas canvas, RectF rect, float radius) {
        int outerRim = lightTheme
                ? Color.argb(210, 255, 255, 255)
                : Color.argb(175, 156, 224, 255);
        RectF innerRect = new RectF(rect.left + dp(1.4f), rect.top + dp(1.4f), rect.right - dp(1.4f), rect.bottom - dp(1.4f));
        innerRimPaint.setStrokeWidth(dp(0.9f));
        innerRimPaint.setColor(Color.argb(lightTheme ? 160 : 88, 255, 255, 255));
        canvas.drawRoundRect(innerRect, Math.max(4f, radius - dp(1.4f)), Math.max(4f, radius - dp(1.4f)), innerRimPaint);

        strokePaint.setStrokeWidth(dp(1.4f));
        strokePaint.setColor(outerRim);
        canvas.drawRoundRect(rect, radius, radius, strokePaint);
    }

    private void drawNotificationShadeMode(Canvas canvas, int w, int h) {
        // 1. Full-Screen Translucent Vista Aero Glass Shade Backdrop
        int bgTop;
        int bgBottom;
        if (lightTheme) {
            bgTop = Color.argb(44, 210, 238, 255);
            bgBottom = Color.argb(32, 175, 218, 250);
        } else if (customTheme) {
            int r = Color.red(customColor);
            int g = Color.green(customColor);
            int b = Color.blue(customColor);
            bgTop = Color.argb(36, r, g, b);
            bgBottom = Color.argb(48, Math.max(0, r / 3), Math.max(0, g / 3), Math.max(0, b / 3));
        } else {
            bgTop = Color.argb(32, 12, 48, 92);
            bgBottom = Color.argb(44, 4, 16, 34);
        }

        backdropPaint.setShader(new LinearGradient(
                0f, 0f, w * 0.35f, h,
                bgTop, bgBottom, Shader.TileMode.CLAMP));
        canvas.drawRect(0f, 0f, w, h, backdropPaint);

        // Diagonal top-left Aero specular reflection across shade
        sheenPaint.setShader(new LinearGradient(
                0f, 0f, w * 0.65f, h * 0.48f,
                Color.argb(lightTheme ? 72 : 44, 255, 255, 255),
                Color.argb(0, 255, 255, 255),
                Shader.TileMode.CLAMP));
        canvas.drawRect(0f, 0f, w, h * 0.55f, sheenPaint);

        // 2. Top Shade Header Glass Pill
        RectF header = shadeHeaderRect != null
                ? shadeHeaderRect
                : new RectF(0.035f * w, 0.008f * h, 0.965f * w, 0.050f * h);
        drawAeroGlassPanel(canvas, header, dp(18));

        // 3. Individual Quick Settings Tile Glass Pills & Brightness Slider
        if (!shadeTileRects.isEmpty()) {
            for (RectF tileRect : shadeTileRects) {
                drawAeroGlassIconTile(canvas, tileRect, dp(26));
            }
        } else {
            drawAeroGlassIconTile(canvas, new RectF(0.039f * w, 0.057f * h, 0.490f * w, 0.123f * h), dp(26));
            drawAeroGlassIconTile(canvas, new RectF(0.509f * w, 0.057f * h, 0.960f * w, 0.123f * h), dp(26));
            drawAeroGlassIconTile(canvas, new RectF(0.039f * w, 0.131f * h, 0.490f * w, 0.197f * h), dp(26));
            drawAeroGlassIconTile(canvas, new RectF(0.509f * w, 0.131f * h, 0.960f * w, 0.197f * h), dp(26));
        }

        // 4. Individual Notification Cards & Manage / Clear All Action Pills
        if (!shadeCardRects.isEmpty()) {
            for (RectF cardRect : shadeCardRects) {
                drawAeroGlassPanel(canvas, cardRect, dp(22));
            }
        } else if (!hasLiveShadeData) {
            drawAeroGlassPanel(canvas, new RectF(0.039f * w, 0.241f * h, 0.961f * w, 0.391f * h), dp(22));
            drawAeroGlassPanel(canvas, new RectF(0.039f * w, 0.465f * h, 0.961f * w, 0.556f * h), dp(22));
            drawAeroGlassPanel(canvas, new RectF(0.078f * w, 0.571f * h, 0.297f * w, 0.624f * h), dp(20));
            drawAeroGlassPanel(canvas, new RectF(0.703f * w, 0.571f * h, 0.922f * w, 0.624f * h), dp(20));
        }
    }

    private void drawAeroGlassIconTile(Canvas canvas, RectF rect, float radius) {
        int startFill;
        int endFill;
        int outerRim;
        int haloCenter;

        if (lightTheme) {
            startFill = Color.argb(54, 240, 250, 255);
            endFill = Color.argb(34, 182, 224, 252);
            outerRim = Color.argb(230, 255, 255, 255);
            haloCenter = Color.argb(46, 255, 255, 255);
        } else if (customTheme) {
            int r = Color.red(customColor);
            int g = Color.green(customColor);
            int b = Color.blue(customColor);
            startFill = Color.argb(42, r, g, b);
            endFill = Color.argb(52, Math.max(0, r / 3), Math.max(0, g / 3), Math.max(0, b / 3));
            outerRim = Color.argb(195, 198, 238, 255);
            haloCenter = Color.argb(38, 210, 244, 255);
        } else {
            startFill = Color.argb(34, 26, 78, 138);
            endFill = Color.argb(42, 8, 22, 44);
            outerRim = Color.argb(195, 168, 228, 255);
            haloCenter = Color.argb(36, 170, 234, 255);
        }

        // Diagonal frosted glass gradient fill
        fillPaint.setShader(new LinearGradient(
                rect.left, rect.top, rect.right, rect.bottom,
                startFill, endFill, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(rect, radius, radius, fillPaint);

        // Subtle upper-center specular halo behind the icon
        float cx = rect.centerX();
        float cy = rect.top + rect.height() * 0.36f;
        float haloRadius = Math.max(dp(12), Math.min(rect.width(), rect.height()) * 0.46f);
        haloPaint.setShader(new RadialGradient(
                cx, cy, haloRadius,
                haloCenter, Color.argb(0, 255, 255, 255),
                Shader.TileMode.CLAMP));
        int saveHalo = canvas.save();
        clipPath.reset();
        clipPath.addRoundRect(rect, radius, radius, Path.Direction.CW);
        canvas.clipPath(clipPath);
        canvas.drawCircle(cx, cy, haloRadius, haloPaint);

        // Upper-half diagonal white Aero glass reflection glaze
        float sheenBottom = rect.top + rect.height() * 0.46f;
        sheenPaint.setShader(new LinearGradient(
                rect.left, rect.top, rect.left + rect.width() * 0.16f, sheenBottom,
                Color.argb(lightTheme ? 128 : 82, 255, 255, 255),
                Color.argb(0, 255, 255, 255),
                Shader.TileMode.CLAMP));
        canvas.drawRect(rect.left, rect.top, rect.right, sheenBottom, sheenPaint);
        canvas.restoreToCount(saveHalo);

        // Crisp 1.1dp inner white bevel + 1.6dp outer luminous Aero Glass border
        RectF innerRect = new RectF(rect.left + dp(1.4f), rect.top + dp(1.4f), rect.right - dp(1.4f), rect.bottom - dp(1.4f));
        innerRimPaint.setStrokeWidth(dp(1.1f));
        innerRimPaint.setColor(Color.argb(lightTheme ? 200 : 112, 255, 255, 255));
        canvas.drawRoundRect(innerRect, Math.max(4f, radius - dp(1.4f)), Math.max(4f, radius - dp(1.4f)), innerRimPaint);

        strokePaint.setStrokeWidth(dp(1.6f));
        strokePaint.setColor(outerRim);
        canvas.drawRoundRect(rect, radius, radius, strokePaint);
    }

    private void drawAeroGlassPanel(Canvas canvas, RectF rect, float radius) {
        int startFill;
        int endFill;
        int outerRim;

        if (lightTheme) {
            startFill = Color.argb(48, 232, 246, 255);
            endFill = Color.argb(32, 190, 224, 248);
            outerRim = Color.argb(220, 255, 255, 255);
        } else if (customTheme) {
            int r = Color.red(customColor);
            int g = Color.green(customColor);
            int b = Color.blue(customColor);
            startFill = Color.argb(40, r, g, b);
            endFill = Color.argb(50, Math.max(0, r / 3), Math.max(0, g / 3), Math.max(0, b / 3));
            outerRim = Color.argb(185, 190, 232, 255);
        } else {
            startFill = Color.argb(32, 20, 62, 114);
            endFill = Color.argb(44, 7, 18, 36);
            outerRim = Color.argb(175, 158, 224, 255);
        }

        fillPaint.setShader(new LinearGradient(
                rect.left, rect.top, rect.right * 0.4f, rect.bottom,
                startFill, endFill, Shader.TileMode.CLAMP));
        canvas.drawRoundRect(rect, radius, radius, fillPaint);

        int saveCount = canvas.save();
        clipPath.reset();
        clipPath.addRoundRect(rect, radius, radius, Path.Direction.CW);
        canvas.clipPath(clipPath);

        float sheenBottom = rect.top + rect.height() * 0.44f;
        sheenPaint.setShader(new LinearGradient(
                rect.left, rect.top, rect.left + rect.width() * 0.14f, sheenBottom,
                Color.argb(lightTheme ? 112 : 74, 255, 255, 255),
                Color.argb(0, 255, 255, 255),
                Shader.TileMode.CLAMP));
        canvas.drawRect(rect.left, rect.top, rect.right, sheenBottom, sheenPaint);
        canvas.restoreToCount(saveCount);

        RectF innerRect = new RectF(rect.left + dp(1.3f), rect.top + dp(1.3f), rect.right - dp(1.3f), rect.bottom - dp(1.3f));
        innerRimPaint.setStrokeWidth(dp(1.0f));
        innerRimPaint.setColor(Color.argb(lightTheme ? 190 : 98, 255, 255, 255));
        canvas.drawRoundRect(innerRect, Math.max(4f, radius - dp(1.3f)), Math.max(4f, radius - dp(1.3f)), innerRimPaint);

        strokePaint.setStrokeWidth(dp(1.4f));
        strokePaint.setColor(outerRim);
        canvas.drawRoundRect(rect, radius, radius, strokePaint);
    }

    private float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }
}
