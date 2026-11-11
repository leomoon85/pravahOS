<#
.SYNOPSIS
    PravahOS QEMU ARM64 Boot Runner and Test Harness.
.DESCRIPTION
    Launches PravahOS microkernel on an ARM64 QEMU virtual target ('virt' machine).
    Configures PL011 UART early serial console, GICv3 interrupt controller,
    and accepts both flat binary and ELF kernel images.
#>

param (
    [string]$KernelPath = "",
    [int]$MemoryMB = 4096,
    [string]$Cpu = "cortex-a76",
    [switch]$DryRun,
    [switch]$Build
)

# 1. Resolve Kernel Image Candidate Paths
$CandidatePaths = @(
    $KernelPath,
    "build/zircon-arm64/zircon.bin",
    "build/zircon-arm64/zircon.elf",
    "kernel/build/pravah_kernel.elf",
    "kernel/build/pravah_kernel.bin",
    "build/kernel/pravah_kernel.elf",
    "build/kernel/pravah_kernel.bin"
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

$ResolvedKernel = $null
foreach ($cand in $CandidatePaths) {
    if (Test-Path $cand) {
        $ResolvedKernel = (Resolve-Path $cand).Path
        break
    }
}

# 2. Locate QEMU Binary
$QemuCmd = "qemu-system-aarch64"
$cmdObj = Get-Command $QemuCmd -ErrorAction SilentlyContinue
$QemuPath = if ($cmdObj) { $cmdObj.Source } else { $null }

if (-not $QemuPath) {
    # Check default install paths for QEMU on Windows
    $DefaultPaths = @(
        "C:\Program Files\qemu\qemu-system-aarch64.exe",
        "$env:LOCALAPPDATA\Programs\qemu\qemu-system-aarch64.exe",
        "$env:ProgramFiles\qemu\qemu-system-aarch64.exe"
    )
    foreach ($p in $DefaultPaths) {
        if (Test-Path $p) {
            $QemuPath = $p
            break
        }
    }
}

# 3. Optional Build Step
if ($Build) {
    Write-Host "Attempting to build PravahOS kernel..." -ForegroundColor Cyan
    $Clang = Get-Command clang -ErrorAction SilentlyContinue
    $Cmake = Get-Command cmake -ErrorAction SilentlyContinue
    $Make = Get-Command make -ErrorAction SilentlyContinue

    if ($Cmake) {
        Write-Host "Configuring and compiling via CMake..."
        cmake -B build -S .
        cmake --build build --config Release
    } elseif ($Make) {
        Write-Host "Compiling via Makefile..."
        Push-Location kernel
        make all
        Pop-Location
    } else {
        Write-Warning "Neither CMake nor Make were found in PATH. Skipping build."
    }

    # Re-check candidate paths
    foreach ($cand in $CandidatePaths) {
        if (Test-Path $cand) {
            $ResolvedKernel = (Resolve-Path $cand).Path
            break
        }
    }
}

# 4. Construct QEMU Launch Arguments
$Arguments = @(
    "-M", "virt,gic-version=3",
    "-cpu", $Cpu,
    "-m", "${MemoryMB}M",
    "-smp", "4",
    "-nographic",
    "-serial", "mon:stdio"
)

if ($ResolvedKernel) {
    $Arguments += @("-kernel", $ResolvedKernel)
} else {
    $FallbackDisplay = if ($KernelPath) { $KernelPath } else { "build/zircon-arm64/zircon.bin" }
    Write-Warning "Kernel image not found at '$FallbackDisplay' or build paths."
    Write-Host "Build the kernel first using CMake, Make, or install the toolchain (see BUILD.md)."
}

Write-Host "=== PravahOS ARM64 Virtual Platform Config ===" -ForegroundColor Cyan
Write-Host "Target Machine: QEMU ARM64 virt (GICv3)"
Write-Host "CPU Profile   : $Cpu (Quad Core)"
Write-Host "Memory        : ${MemoryMB} MB"
Write-Host "Kernel Image  : $(if ($ResolvedKernel) { $ResolvedKernel } else { 'NOT FOUND (Required for boot)' })"
Write-Host "QEMU Path     : $(if ($QemuPath) { $QemuPath } else { 'Not installed / not in PATH' })"
Write-Host "=============================================" -ForegroundColor Cyan

if ($DryRun -or -not $QemuPath -or -not $ResolvedKernel) {
    Write-Host "`nBoot Command Line Preview:" -ForegroundColor Yellow
    Write-Host "qemu-system-aarch64 $($Arguments -join ' ')"
    if (-not $QemuPath) {
        Write-Warning "`nTo run natively on Windows, install QEMU using:`n  winget install SoftwareFreedomConservancy.QEMU"
    }
    if (-not $ResolvedKernel) {
        Write-Host "`nTo compile the kernel:`n  cd kernel; make (or cmake -B build -S . && cmake --build build)" -ForegroundColor Yellow
    }
    exit 0
}

Write-Host "`nStarting PravahOS on ARM64 virtual target..." -ForegroundColor Green
Write-Host "Press Ctrl+A then X to exit QEMU.`n" -ForegroundColor DarkGray
& $QemuPath $Arguments
