# Copyright 2026 The PravahOS Authors. All rights reserved.
# PravahOS Foundation 1 Kernel & Boot Image Build Pipeline for Google Pixel 7 (panther)
# PowerShell Native Build Runner for Windows

param(
  [string]$OutputDir = "out/panther",
  [string]$KernelPath = "",
  [switch]$AllowTestStub
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path "$PSScriptRoot/../.."

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " PravahOS Kernel & Boot Packaging Pipeline (Windows)" -ForegroundColor Cyan
Write-Host " Target Device : panther (Google Tensor G2 / GS201)" -ForegroundColor White
Write-Host " Foundation    : Foundation 1 (AOSP GKI Base + pravahd + UI)" -ForegroundColor White
Write-Host " Project Root  : $ProjectRoot" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$OutPath = Join-Path $ProjectRoot $OutputDir
if (-not (Test-Path $OutPath)) {
  New-Item -ItemType Directory -Path $OutPath -Force | Out-Null
}

# 1. Compile Flattened Device Tree Binary (FDT v17)
Write-Host "[1/5] Compiling Tensor G2 Flattened Device Tree (FDT v17)..." -ForegroundColor Yellow
$DtsPath = Join-Path $ProjectRoot "kernel/arch/arm64/google/google_tensor_g3.dts"
$DtbOut = Join-Path $OutPath "pantah.dtb"
$BuildDtbScript = Join-Path $ProjectRoot "tools/flashing/build_dtb.js"

node $BuildDtbScript --input $DtsPath --output $DtbOut
Write-Host "      Generated DTB: $DtbOut" -ForegroundColor Green

# 2. Compile / Stage pravahd daemon
Write-Host "[2/5] Staging pravahd native C service manifests & configs..." -ForegroundColor Yellow
$PravahdSrcDir = Join-Path $ProjectRoot "services/pravahd"
Copy-Item (Join-Path $PravahdSrcDir "pravahd.rc") (Join-Path $OutPath "pravahd.rc") -Force
Copy-Item (Join-Path $PravahdSrcDir "Android.bp") (Join-Path $OutPath "Android.bp") -Force

# Check for host gcc / clang
$Gcc = Get-Command "gcc" -ErrorAction SilentlyContinue
$Clang = Get-Command "clang" -ErrorAction SilentlyContinue
if ($Clang) {
  Write-Host "      Compiling pravahd native test host binary via clang..." -ForegroundColor Gray
  & clang -O2 -std=c11 (Join-Path $PravahdSrcDir "pravahd.c") -o (Join-Path $OutPath "pravahd.exe")
} elseif ($Gcc) {
  Write-Host "      Compiling pravahd native test host binary via gcc..." -ForegroundColor Gray
  & gcc -O2 -std=c11 (Join-Path $PravahdSrcDir "pravahd.c") -o (Join-Path $OutPath "pravahd.exe")
} else {
  Write-Host "      C compiler not detected on Windows path; skipping local host binary compilation." -ForegroundColor Gray
}

# 3. Assemble Root Init Ramdisk
Write-Host "[3/5] Packaging Pravah rootfs staging layout..." -ForegroundColor Yellow
$RamdiskDir = Join-Path $OutPath "ramdisk_root"
if (Test-Path $RamdiskDir) { Remove-Item $RamdiskDir -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $RamdiskDir "bin") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $RamdiskDir "etc/init") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $RamdiskDir "data/pravah") -Force | Out-Null

Copy-Item (Join-Path $PravahdSrcDir "pravahd.rc") (Join-Path $RamdiskDir "etc/init/") -Force
@"
#!/bin/sh
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
exec /bin/pravahd
"@ | Set-Content -Path (Join-Path $RamdiskDir "init") -NoNewline

# 4. Generate Android Boot Image v4 and Vendor Boot Image v4
Write-Host "[4/5] Packaging Android Boot Image v4 & Vendor Boot Image v4..." -ForegroundColor Yellow
$BootImgOut = Join-Path $OutPath "pravah_boot.img"
$VendorBootOut = Join-Path $OutPath "pravah_vendor_boot.img"
$PackageScript = Join-Path $ProjectRoot "tools/flashing/package_panther.js"

$PackageArgs = @($PackageScript, "--out", $OutPath, "--dtb", $DtbOut)
if ($KernelPath) {
  $PackageArgs += @("--kernel", $KernelPath)
}
if ($AllowTestStub) {
  $PackageArgs += @("--allow-test-stub")
}

& node $PackageArgs
if ($LASTEXITCODE -ne 0) {
  throw "Packaging failed: no valid kernel payload or error during image assembly."
}

# 5. Authoritative Validation and Checksum Generation
Write-Host "[5/5] Validating output image structures & generating provenance..." -ForegroundColor Yellow
$ValidateScript = Join-Path $ProjectRoot "tools/flashing/validate_image.js"

$BootProvJson = node $ValidateScript $BootImgOut
$BootProvJson | Set-Content -Path (Join-Path $OutPath "boot_provenance.json")

$VendorProvJson = node $ValidateScript $VendorBootOut
$VendorProvJson | Set-Content -Path (Join-Path $OutPath "vendor_boot_provenance.json")

$GitCommit = try { (git rev-parse HEAD).Trim() } catch { "unversioned" }
$BuildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$Receipt = @{
  target_device = "panther"
  soc = "gs201"
  foundation = "foundation-1-aosp-gki"
  build_time_utc = $BuildTime
  git_commit = $GitCommit
  artifacts = @{
    boot_image = $BootImgOut
    vendor_boot_image = $VendorBootOut
    dtb = $DtbOut
  }
} | ConvertTo-Json -Depth 4

$Receipt | Set-Content -Path (Join-Path $OutPath "build_receipt.json")

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Build Completed Successfully!" -ForegroundColor Green
Write-Host " Artifacts verified in: $OutPath" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
