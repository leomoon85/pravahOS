# PravahOS Native Platform Daemon (pravahd) Builder
# Compiles pravahd ELF binary for Android x86_64 target using Android NDK r27c

$ErrorActionPreference = "Stop"

$SdkPath = "$env:LOCALAPPDATA\Android\Sdk"
$NdkBin = "$SdkPath\ndk\27.2.12479018\toolchains\llvm\prebuilt\windows-x86_64\bin"
$Clang = "$NdkBin\x86_64-linux-android35-clang.cmd"

if (-not (Test-Path $Clang)) {
    # If .cmd wrapper is not there, call clang.exe with explicit target
    $Clang = "$NdkBin\clang.exe"
    $TargetFlag = @("--target=x86_64-linux-android35")
} else {
    $TargetFlag = @()
}

$OutDir = "L:\projectz\OS\out\panther"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutBin = "$OutDir\pravahd"

Write-Host ">>> Compiling services/pravahd/pravahd.c -> $OutBin..." -ForegroundColor Cyan

$CompileArgs = $TargetFlag + @(
    "-Wall", "-Wextra", "-O2",
    "-D_GNU_SOURCE",
    "-Iservices/pravahd",
    "services/pravahd/pravahd.c",
    "services/pravahd/main.c",
    "-o", $OutBin
)

& $Clang $CompileArgs

if (Test-Path $OutBin) {
    Write-Host ">>> [SUCCESS] Compiled native pravahd ELF binary!" -ForegroundColor Green
    Get-Item $OutBin | Select-Object Name, Length, LastWriteTime
} else {
    Write-Error "Compilation failed, binary not created."
}
