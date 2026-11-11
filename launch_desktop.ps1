<#
.SYNOPSIS
    PravahOS Desktop Launcher and Process Supervisor.
.DESCRIPTION
    Launches the PravahOS local microkernel web server, detects available
    Chromium browsers (Edge, Chrome, Brave), and launches the mobile phone
    emulator in standalone desktop app window mode without browser URL chrome.
.PARAMETER Port
    Target local port (default: 8080).
.PARAMETER UrlPath
    Entrypoint path to open (default: /emulator/).
.PARAMETER Browser
    Preferred browser: "auto", "edge", "chrome", "brave", "default".
.PARAMETER Width
    Initial desktop window width in pixels (default: 1280).
.PARAMETER Height
    Initial desktop window height in pixels (default: 920).
.PARAMETER StopServerOnExit
    If specified, keeps running until desktop window closes and terminates the server.
.PARAMETER Headless
    If specified, verifies server and browser resolution without opening GUI window.
.PARAMETER DryRun
    Tests resolution logic and prints plan without launching processes.
#>

[CmdletBinding()]
param (
    [int]$Port = 8080,
    [string]$UrlPath = "/emulator/",
    [ValidateSet("auto", "edge", "chrome", "brave", "default")]
    [string]$Browser = "auto",
    [int]$Width = 1280,
    [int]$Height = 920,
    [switch]$StopServerOnExit,
    [switch]$Headless,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

function Write-PravahBanner {
    Write-Host @"

  ==============================================================
    ✧ PRAVAH-OS STANDALONE DESKTOP EXPERIENCE LAUNCHER ✧
  ==============================================================
"@ -ForegroundColor Cyan
}

function Test-PortListening {
    param ([int]$CheckPort)
    try {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        $iar = $tcpClient.BeginConnect("127.0.0.1", $CheckPort, $null, $null)
        $waitSuccess = $iar.AsyncWaitHandle.WaitOne(300, $false)
        if ($waitSuccess -and $tcpClient.Connected) {
            $tcpClient.EndConnect($iar)
            $tcpClient.Close()
            return $true
        }
        $tcpClient.Close()
    } catch {
        # Connection failed or refused
    }
    return $false
}

function Find-ChromiumBrowser {
    param ([string]$Preference = "auto")

    $candidates = @()

    $chromePaths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )

    $edgePaths = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe"
    )

    $bravePaths = @(
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LocalAppData\BraveSoftware\Brave-Browser\Application\brave.exe"
    )

    switch ($Preference) {
        "edge" {
            foreach ($p in $edgePaths) { if (Test-Path $p) { return [PSCustomObject]@{ Name = "Microsoft Edge"; Path = $p; Type = "edge" } } }
        }
        "chrome" {
            foreach ($p in $chromePaths) { if (Test-Path $p) { return [PSCustomObject]@{ Name = "Google Chrome"; Path = $p; Type = "chrome" } } }
        }
        "brave" {
            foreach ($p in $bravePaths) { if (Test-Path $p) { return [PSCustomObject]@{ Name = "Brave Browser"; Path = $p; Type = "brave" } } }
        }
        "default" {
            return $null
        }
        default { # "auto" priority: Edge -> Chrome -> Brave
            foreach ($p in $edgePaths) { if (Test-Path $p) { return [PSCustomObject]@{ Name = "Microsoft Edge"; Path = $p; Type = "edge" } } }
            foreach ($p in $chromePaths) { if (Test-Path $p) { return [PSCustomObject]@{ Name = "Google Chrome"; Path = $p; Type = "chrome" } } }
            foreach ($p in $bravePaths) { if (Test-Path $p) { return [PSCustomObject]@{ Name = "Brave Browser"; Path = $p; Type = "brave" } } }
        }
    }

    return $null
}

function Start-PravahServer {
    param ([int]$TargetPort)

    $isListening = Test-PortListening -CheckPort $TargetPort
    if ($isListening) {
        Write-Host " [*] PravahOS server is already running on port $TargetPort." -ForegroundColor Green
        return $null
    }

    Write-Host " [*] Starting PravahOS server (serve.js) on port $TargetPort..." -ForegroundColor Yellow
    
    $serveScript = Join-Path $ScriptDir "serve.js"
    if (-not (Test-Path $serveScript)) {
        throw "Could not find server script at: $serveScript"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = "serve.js"
    $psi.WorkingDirectory = $ScriptDir
    $psi.EnvironmentVariables["PORT"] = "$TargetPort"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

    $serverProcess = [System.Diagnostics.Process]::Start($psi)

    # Poll until server is responding (up to 5 seconds)
    $attempts = 0
    $maxAttempts = 25
    $started = $false

    while ($attempts -lt $maxAttempts) {
        Start-Sleep -Milliseconds 200
        if (Test-PortListening -CheckPort $TargetPort) {
            $started = $true
            break
        }
        $attempts++
    }

    if (-not $started) {
        Write-Warning "Server process started (PID $($serverProcess.Id)), but port $TargetPort did not respond within 5s."
    } else {
        Write-Host " [✓] Server verified active on port $TargetPort (PID: $($serverProcess.Id))." -ForegroundColor Green
    }

    return $serverProcess
}

# --- Execution Entrypoint ---
Write-PravahBanner

$appUrl = "http://localhost:${Port}${UrlPath}"
Write-Host " Target URL:       $appUrl" -ForegroundColor Cyan
Write-Host " Window Geometry:  ${Width}x${Height}" -ForegroundColor Cyan

$browserInfo = Find-ChromiumBrowser -Preference $Browser
if ($browserInfo) {
    Write-Host " Detected Browser: $($browserInfo.Name) ($($browserInfo.Path))" -ForegroundColor Green
} else {
    Write-Host " Detected Browser: System Default (Fallback)" -ForegroundColor Yellow
}

if ($DryRun) {
    Write-Host "`n [DRY-RUN] Verification complete. Exiting without launching." -ForegroundColor Magenta
    return
}

$serverProc = $null
try {
    $serverProc = Start-PravahServer -TargetPort $Port

    if ($Headless) {
        Write-Host " [HEADLESS] Verification complete. Server running." -ForegroundColor Green
        return
    }

    $browserProc = $null
    $userDataDir = Join-Path $env:TEMP "pravah_os_desktop_data"

    if ($browserInfo) {
        $browserArgs = @(
            "--app=$appUrl",
            "--window-size=$Width,$Height",
            "--user-data-dir=$userDataDir",
            "--app-id=pravah-os-desktop"
        )
        Write-Host " [*] Launching standalone app window..." -ForegroundColor Cyan
        $browserProc = Start-Process -FilePath $browserInfo.Path -ArgumentList $browserArgs -PassThru
    } else {
        Write-Host " [*] Launching in default web browser..." -ForegroundColor Yellow
        Start-Process $appUrl
    }

    Write-Host @"
 ==============================================================
   [✓] PravahOS Desktop launched successfully.
   Emulation environment is running offline-capable in app mode.
 ==============================================================
"@ -ForegroundColor Green

    if ($StopServerOnExit -and $browserProc -and $serverProc) {
        Write-Host " [*] Monitoring browser process (PID $($browserProc.Id)). Waiting for window close..." -ForegroundColor Gray
        $browserProc.WaitForExit()
        Write-Host " [*] Browser window closed. Shutting down PravahOS server (PID $($serverProc.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
        Write-Host " [✓] PravahOS server terminated cleanly." -ForegroundColor Green
    }

} catch {
    Write-Error "Launcher failed: $_"
    if ($serverProc -and -not $serverProc.HasExited) {
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    }
    exit 1
}
