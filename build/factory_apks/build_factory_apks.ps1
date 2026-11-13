# PravahOS Native Factory APKs Unified Builder
$ErrorActionPreference = "Stop"

$SdkPath = "$env:LOCALAPPDATA\Android\Sdk"
$BuildTools = "$SdkPath\build-tools\35.0.0"
$PlatformAndroidJar = "$SdkPath\platforms\android-35\android.jar"
$Aapt2 = "$BuildTools\aapt2.exe"
$D8 = "$BuildTools\d8.bat"
$Zipalign = "$BuildTools\zipalign.exe"
$Apksigner = "$BuildTools\apksigner.bat"
$Keystore = "L:\projectz\OS\build\apk_launcher\debug.keystore"
$OutDir = "L:\projectz\OS\out\panther"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Apps = @(
    @{ Name = "PravahBazaar"; Dir = "L:\projectz\OS\build\factory_apks\bazaar" },
    @{ Name = "PravahVault";  Dir = "L:\projectz\OS\build\factory_apks\vault" },
    @{ Name = "PravahShield"; Dir = "L:\projectz\OS\build\factory_apks\shield" }
)

foreach ($App in $Apps) {
    $AppName = $App.Name
    $BuildDir = $App.Dir
    $OutApk = "$OutDir\$AppName.apk"
    $AlignedApk = "$OutDir\$AppName-aligned.apk"

    Write-Host "`n=====================================================" -ForegroundColor Cyan
    Write-Host " Building Native Factory App: $AppName" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Cyan

    New-Item -ItemType Directory -Force -Path "$BuildDir\gen", "$BuildDir\obj" | Out-Null

    & $Aapt2 compile --dir "$BuildDir\res" -o "$BuildDir\compiled_res.zip"
    & $Aapt2 link -I $PlatformAndroidJar -R "$BuildDir\compiled_res.zip" --manifest "$BuildDir\AndroidManifest.xml" -o "$BuildDir\base.apk" --java "$BuildDir\gen" --auto-add-overlay

    $JavaFiles = Get-ChildItem -Path "$BuildDir\src", "$BuildDir\gen" -Filter *.java -Recurse | ForEach-Object { $_.FullName }
    & javac -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath $PlatformAndroidJar -d "$BuildDir\obj" $JavaFiles

    $ClassFiles = Get-ChildItem -Path "$BuildDir\obj" -Filter *.class -Recurse | ForEach-Object { $_.FullName }
    & cmd /c $D8 --output "$BuildDir" --lib $PlatformAndroidJar $ClassFiles

    Set-Location "$BuildDir"
    & jar -uf "base.apk" "classes.dex"
    Set-Location "L:\projectz\OS"

    Remove-Item -Force -ErrorAction SilentlyContinue $OutApk, $AlignedApk
    & $Zipalign -f -p 4 "$BuildDir\base.apk" $AlignedApk
    & cmd /c $Apksigner sign --ks $Keystore --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out $OutApk $AlignedApk

    Get-Item $OutApk | Select-Object Name, Length, LastWriteTime
}

Write-Host "`n>>> [SUCCESS] All 3 Standalone PravahOS Factory APKs built!" -ForegroundColor Green
