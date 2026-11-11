<#
.SYNOPSIS
    PravahOS Graphical Mobile Phone Emulator Launcher.

.DESCRIPTION
    Launches the PravahOS Interactive Phone Emulator Studio in your default browser.
    Serves the workspace over a lightweight local HTTP server (using Node.js or .NET HttpListener)
    or directly via file protocol.

.PARAMETER Port
    Port number for the local HTTP server (default: 8085).

.PARAMETER Preset
    Device hardware profile: 'pixel8' (412x915), 'iphone15' (390x844), or 'hdplus' (720x1600).

.PARAMETER DirectFile
    Open the emulator file directly in the browser without spinning up an HTTP server.

.PARAMETER NoBrowser
    Start the server without automatically launching the browser.

.EXAMPLE
    .\scripts\launch_emulator.ps1
    .\scripts\launch_emulator.ps1 -Preset iphone15
    .\scripts\launch_emulator.ps1 -DirectFile
#>

param(
    [int]$Port = 8085,
    [ValidateSet("pixel8", "iphone15", "hdplus")]
    [string]$Preset = "pixel8",
    [switch]$DirectFile,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RootDir = Split-Path -Parent $ScriptDir
Set-Location $RootDir

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "         PravahOS Mobile Phone Emulator Studio             " -ForegroundColor White
Write-Host "   Interactive Flagship Smartphone Window & Device Shell   " -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$EmulatorPath = Join-Path $RootDir "emulator\index.html"
if (-not (Test-Path $EmulatorPath)) {
    Write-Error "Could not find emulator file at: $EmulatorPath"
    exit 1
}

if ($DirectFile) {
    Write-Host "[+] Launching Emulator via direct file protocol..." -ForegroundColor Yellow
    $FileUri = [System.Uri]::new((Resolve-Path $EmulatorPath).Path).AbsoluteUri
    if ($Preset -ne "pixel8") {
        $FileUri += "#preset=$Preset"
    }
    Write-Host "[+] Target: $FileUri" -ForegroundColor Green
    Start-Process $FileUri
    exit 0
}

# Determine if Node.js is available
$NodeAvailable = $false
try {
    $nodeVer = & node -v 2>$null
    if ($nodeVer) {
        $NodeAvailable = $true
    }
} catch {}

$Url = "http://localhost:$Port/emulator/index.html"
if ($Preset -ne "pixel8") {
    $Url += "#preset=$Preset"
}

Write-Host "[+] Target URL: $Url" -ForegroundColor Green
Write-Host "[+] Root Directory: $RootDir" -ForegroundColor Gray
Write-Host "[+] Device Profile: $Preset" -ForegroundColor Cyan

if (-not $NoBrowser) {
    Start-Process $Url
}

Write-Host ""
Write-Host "Server running at http://localhost:$Port/" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to terminate the emulator server." -ForegroundColor Gray
Write-Host ""

if ($NodeAvailable) {
    # Lightweight Node.js static file server
    $ServerCode = @"
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = $Port;
const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0].split('#')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/emulator/index.html';
  
  const filePath = path.join(ROOT, reqPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + reqPath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('HTTP Server listening on 127.0.0.1:' + PORT);
});
"@
    & node -e $ServerCode
} else {
    # Fallback to .NET HttpListener
    $listener = New-Object System.Net.HttpListener
    $prefix = "http://localhost:$Port/"
    $listener.Prefixes.Add($prefix)
    $listener.Start()

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $relPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($relPath)) {
            $relPath = "emulator/index.html"
        }
        $localFile = Join-Path $RootDir $relPath.Replace('/', '\')

        if (Test-Path $localFile -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($localFile)
            $response.ContentLength64 = $bytes.Length
            $ext = [System.IO.Path]::GetExtension($localFile).ToLower()
            switch ($ext) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".json" { $response.ContentType = "application/json" }
                ".svg"  { $response.ContentType = "image/svg+xml" }
                default { $response.ContentType = "application/octet-stream" }
            }
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.Close()
    }
}
