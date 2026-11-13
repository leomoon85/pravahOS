# PravahOS Complete Daily-Driver OS Deployment Script for Pixel 7 (emulator-5554)
$ErrorActionPreference = "Stop"

$SdkPath = "$env:LOCALAPPDATA\Android\Sdk"
$AdbExe = "$SdkPath\platform-tools\adb.exe"
$OutDir = "L:\projectz\OS\out\panther"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " [PravahOS] Deploying Complete Daily-Driver OS Stack" -ForegroundColor Green
Write-Host " Target: Google Pixel 7 (emulator-5554)" -ForegroundColor Yellow
Write-Host "=====================================================" -ForegroundColor Cyan

# Ensure ADB sees device
$Devices = & $AdbExe devices
if (-not ($Devices -match "emulator-\d+\s+device")) {
    Write-Error "Pixel 7 emulator not connected. Launch emulator first."
    exit 1
}

Write-Host "`n>>> [1/5] Switching adbd to root and stopping stale daemons..." -ForegroundColor Cyan
& $AdbExe root | Out-Null
Start-Sleep -Seconds 1
& $AdbExe wait-for-device
& $AdbExe shell "killall -9 pravahd 2>/dev/null || true"
& $AdbExe shell "pkill -f pravah_swipe_hook.sh 2>/dev/null || true"
& $AdbExe shell "killall -9 logcat 2>/dev/null || true"

Write-Host ">>> [2/5] Deploying & starting native C pravahd daemon..." -ForegroundColor Cyan
& $AdbExe push "$OutDir\pravahd" /data/local/tmp/pravahd
& $AdbExe shell "chmod 755 /data/local/tmp/pravahd"
& $AdbExe shell "mkdir -p /data/pravah"
& $AdbExe shell "nohup /data/local/tmp/pravahd >/data/local/tmp/pravahd.log 2>&1 </dev/null &"
Start-Sleep -Seconds 2

& $AdbExe forward tcp:9880 tcp:9880 | Out-Null
$TelemetryCheck = & curl.exe -s http://127.0.0.1:9880/telemetry
Write-Host "pravahd Live Telemetry Response:" -ForegroundColor Green
Write-Host $TelemetryCheck

Write-Host "`n>>> [3/5] Installing Pravah Metro + 4 Standalone Native Factory APKs..." -ForegroundColor Cyan
$Apks = @(
    "$OutDir\PravahLauncher.apk",
    "$OutDir\AuroraNotes-pravah.apk",
    "$OutDir\PravahBazaar.apk",
    "$OutDir\PravahVault.apk",
    "$OutDir\PravahShield.apk"
)

foreach ($Apk in $Apks) {
    if (-not (Test-Path $Apk)) {
        Write-Error "Missing APK: $Apk"
        exit 1
    }
    Write-Host "  Installing $(Split-Path -Leaf $Apk)..." -ForegroundColor Gray
    & $AdbExe install -r -g $Apk
}

Write-Host "`n>>> [4/5] Enabling native PravahMetroService Accessibility Swipe Bridge..." -ForegroundColor Cyan
& $AdbExe shell "settings put secure enabled_accessibility_services org.pravah.launcher/org.pravah.launcher.PravahMetroService"
& $AdbExe shell "settings put secure accessibility_enabled 1"

Write-Host ">>> [5/5] Locking authentic Google Pixel Launcher as primary home desktop..." -ForegroundColor Cyan
& $AdbExe shell "cmd package set-home-activity 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity'"
& $AdbExe shell "input keyevent 3"
Start-Sleep -Seconds 1

$SqlQuery = "SELECT count(*) FROM favorites WHERE appWidgetProvider LIKE '%PravahIntentWidgetProvider%';"
$HasIntentWidget = ($SqlQuery | & $AdbExe shell "sqlite3 /data/data/com.google.android.apps.nexuslauncher/databases/launcher_4_by_5.db") 2>$null
if (-not (($HasIntentWidget | Out-String) -match '^\s*[1-9]\d*\s*$')) {
    Write-Host ">>> Pinning Ask Pravah Intention Widget onto Pixel Home Screen..." -ForegroundColor Cyan
    & $AdbExe shell "am start -n org.pravah.launcher/.IntentWidgetActivity --ez request_pin_widget true" | Out-Null
    Start-Sleep -Seconds 2
    & $AdbExe shell "uiautomator dump /sdcard/pin_ui.xml" | Out-Null
    $PinXml = (& $AdbExe shell "cat /sdcard/pin_ui.xml") -join "`n"
    if ($PinXml -match 'text="Add to home screen"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"') {
        $TapX = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
        $TapY = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
        & $AdbExe shell "input tap $TapX $TapY"
        Start-Sleep -Seconds 1
    }
    & $AdbExe shell "rm -f /sdcard/pin_ui.xml" | Out-Null
}

Write-Host "`n>>> [SUCCESS] Complete PravahOS Daily-Driver Stack Live on Pixel 7!" -ForegroundColor Green
