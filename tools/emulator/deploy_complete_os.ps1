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

Write-Host "`n>>> [3/5] Installing Pravah Native Factory Apps..." -ForegroundColor Cyan
$Apks = @(
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

Write-Host "`n>>> [4/5] Enforcing Clean Pixel Launcher and Zero-Tax Native pravahd..." -ForegroundColor Cyan
& $AdbExe shell "pm uninstall org.pravah.launcher 2>/dev/null || true"
& $AdbExe shell "settings put secure enabled_accessibility_services ''"
& $AdbExe shell "settings put secure accessibility_enabled 0"

Write-Host ">>> [5/5] Locking authentic Google Pixel Launcher as sole home desktop..." -ForegroundColor Cyan
& $AdbExe shell "cmd package set-home-activity 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity'"
& $AdbExe shell "input keyevent 3"
Start-Sleep -Seconds 1

Write-Host "`n>>> [SUCCESS] Complete PravahOS Daily-Driver Stack Live on Pixel 7!" -ForegroundColor Green
