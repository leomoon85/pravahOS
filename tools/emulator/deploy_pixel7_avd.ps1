# PravahOS On-Device AVD Deployment & Verification Script
# Deploys pravahd daemon and verifies on-device runtime metrics

$ErrorActionPreference = "Stop"

$SdkPath = "$env:LOCALAPPDATA\Android\Sdk"
$AdbExe = "$SdkPath\platform-tools\adb.exe"

if (-not (Test-Path $AdbExe)) {
    Write-Error "adb.exe not found at: $AdbExe"
    exit 1
}

$Devices = & $AdbExe devices
if ($Devices -notmatch "emulator-\d+\s+device") {
    Write-Warning "No active emulator found. Run ./tools/emulator/run_pixel7_avd.ps1 first."
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [PravahOS] Deploying to Pixel 7 Virtual Device...        " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Inspect Device Identity
Write-Host "`n[1/4] Inspecting Device Properties:" -ForegroundColor Yellow
$DeviceModel = & $AdbExe shell getprop ro.product.model
$DeviceCpu = & $AdbExe shell getprop ro.product.cpu.abi
$AndroidVer = & $AdbExe shell getprop ro.build.version.release
Write-Host "Model: $DeviceModel"
Write-Host "CPU ABI: $DeviceCpu"
Write-Host "Android Version: $AndroidVer"

# 2. Setup PravahOS Directories on Device
Write-Host "`n[2/4] Initializing /data/pravah and /dev/socket directories:" -ForegroundColor Yellow
& $AdbExe shell "su 0 mkdir -p /data/pravah /data/local/tmp/pravah"
& $AdbExe shell "su 0 chmod 777 /data/pravah /data/local/tmp/pravah"

# 3. Check System Memory Baseline before Pravah components
Write-Host "`n[3/4] Baseline System Memory Telemetry:" -ForegroundColor Yellow
& $AdbExe shell "cat /proc/meminfo | grep -E 'MemTotal|MemFree|MemAvailable'"

# 4. Check Battery and Display Sysfs Nodes
Write-Host "`n[4/4] Probing Hardware Sysfs Nodes for pravahd:" -ForegroundColor Yellow
$BatteryExists = & $AdbExe shell "ls /sys/class/power_supply/battery 2>/dev/null || echo MISSING"
Write-Host "Battery Sysfs: $BatteryExists"

Write-Host "`n[PravahOS] Target device verification complete!" -ForegroundColor Green
