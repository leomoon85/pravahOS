<#
.SYNOPSIS
    PravahOS QEMU ARM64 Boot Runner and Test Harness.
.DESCRIPTION
    Launches PravahOS kernel on an ARM64 QEMU virtual target.
    Simulates early UART boot console and accepts kernel images.
#>

param (
    [string]$KernelPath = "build/zircon-arm64/zircon.bin",
    [int]$MemoryMB = 4096,
    [string]$Cpu = "cortex-a76",
    [switch]$DryRun
)

$QemuCmd = "qemu-system-aarch64"
$cmdObj = Get-Command $QemuCmd -ErrorAction SilentlyContinue
$QemuPath = if ($cmdObj) { $cmdObj.Source } else { $null }

if (-not $QemuPath) {
    # Check default install path for QEMU on Windows
    $DefaultPaths = @(
        "C:\Program Files\qemu\qemu-system-aarch64.exe",
        "$env:LOCALAPPDATA\Programs\qemu\qemu-system-aarch64.exe"
    )
    foreach ($p in $DefaultPaths) {
        if (Test-Path $p) {
            $QemuPath = $p
            break
        }
    }
}

$Arguments = @(
    "-M", "virt,gic-version=3",
    "-cpu", $Cpu,
    "-m", "${MemoryMB}M",
    "-smp", "4",
    "-nographic",
    "-serial", "mon:stdio"
)

if (Test-Path $KernelPath) {
    $Arguments += @("-kernel", $KernelPath)
} else {
    Write-Warning "Kernel image not found at '$KernelPath'."
    Write-Host "Ready for boot when '$KernelPath' is compiled."
}

Write-Host "=== PravahOS ARM64 Virtual Platform Config ===" -ForegroundColor Cyan
Write-Host "Target Machine: QEMU ARM64 virt (GICv3)"
Write-Host "CPU Profile   : $Cpu (Quad Core)"
Write-Host "Memory        : ${MemoryMB} MB"
Write-Host "Kernel Image  : $KernelPath"
Write-Host "QEMU Path     : $(if ($QemuPath) { $QemuPath } else { 'Not installed / not in PATH' })"
Write-Host "=============================================" -ForegroundColor Cyan

if ($DryRun -or -not $QemuPath) {
    Write-Host "`nBoot Command Line Preview:" -ForegroundColor Yellow
    Write-Host "qemu-system-aarch64 $($Arguments -join ' ')"
    if (-not $QemuPath) {
        Write-Warning "`nTo run natively on Windows, install QEMU using:`n  winget install SoftwareFreedomConservancy.QEMU"
    }
    exit 0
}

Write-Host "`nStarting PravahOS on ARM64 virtual target..." -ForegroundColor Green
& $QemuPath $Arguments
