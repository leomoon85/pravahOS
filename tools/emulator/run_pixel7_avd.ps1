# PravahOS Pixel 7 Industry Standard Emulator Runner
# Target: Google Pixel 7 (panther) via Android SDK AVD

$ErrorActionPreference = "Stop"

$SdkPath = "$env:LOCALAPPDATA\Android\Sdk"
$EmulatorExe = "$SdkPath\emulator\emulator.exe"
$AdbExe = "$SdkPath\platform-tools\adb.exe"
$AvdName = "PravahOS_Pixel7"

if (-not (Test-Path $EmulatorExe)) {
    Write-Error "Android Emulator executable not found at: $EmulatorExe"
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [PravahOS] Starting Google Pixel 7 Emulator (AVD)...     " -ForegroundColor Green
Write-Host " Target Device Profile: Google Pixel 7 (412x915 @ 420dpi) " -ForegroundColor Yellow
Write-Host " System Image: Android 15 (API 35, x86_64)                " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# Start emulator in background or with UI
$ArgsList = @(
    "-avd", $AvdName,
    "-no-snapshot-load",
    "-netdelay", "none",
    "-netspeed", "full"
)

if ($args -contains "-headless") {
    $ArgsList += "-no-window"
    Write-Host "[PravahOS] Launching in headless background mode..." -ForegroundColor Gray
}

Start-Process -FilePath $EmulatorExe -ArgumentList $ArgsList

Write-Host "[PravahOS] Waiting for ADB device connection..." -ForegroundColor Cyan
$MaxRetries = 60
$Retries = 0
$Connected = $false

while ($Retries -lt $MaxRetries) {
    Start-Sleep -Seconds 2
    $Devices = & $AdbExe devices
    if ($Devices -match "emulator-\d+\s+device") {
        $Connected = $true
        break
    }
    $Retries++
    Write-Host -NoNewline "."
}
Write-Host ""

if ($Connected) {
    Write-Host "`n[PravahOS] Pixel 7 AVD is online and ready for ADB deployment!" -ForegroundColor Green
    & $AdbExe devices -l
} else {
    Write-Host "`n[PravahOS] Emulator started. Note: First boot may take 1-2 minutes to initialize userland." -ForegroundColor Yellow
}
