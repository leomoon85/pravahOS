# PravahOS Native System Launcher APK Builder
$ErrorActionPreference = "Stop"

$SdkPath = "$env:LOCALAPPDATA\Android\Sdk"
$BuildTools = "$SdkPath\build-tools\35.0.0"
$PlatformAndroidJar = "$SdkPath\platforms\android-35\android.jar"
$Aapt2 = "$BuildTools\aapt2.exe"
$D8 = "$BuildTools\d8.bat"
$Zipalign = "$BuildTools\zipalign.exe"
$Apksigner = "$BuildTools\apksigner.bat"

$BuildDir = "L:\projectz\OS\build\apk_launcher"
$OutApk = "L:\projectz\OS\out\panther\PravahLauncher.apk"
$AlignedApk = "L:\projectz\OS\out\panther\PravahLauncher-aligned.apk"

New-Item -ItemType Directory -Force -Path "L:\projectz\OS\out\panther", "$BuildDir\compiled_res", "$BuildDir\gen", "$BuildDir\obj" | Out-Null

Write-Host ">>> [1/5] Compiling Android Resources via AAPT2..." -ForegroundColor Cyan
& $Aapt2 compile --dir "$BuildDir\res" -o "$BuildDir\compiled_res.zip" 2>$null
# Link manifest without assets first:
& $Aapt2 link -I $PlatformAndroidJar --manifest "$BuildDir\AndroidManifest.xml" -o "$BuildDir\base.apk" --java "$BuildDir\gen" --auto-add-overlay

Write-Host ">>> [2/5] Compiling Java Sources (MainActivity.java)..." -ForegroundColor Cyan
$JavaFiles = Get-ChildItem -Path "$BuildDir\src", "$BuildDir\gen" -Filter *.java -Recurse | ForEach-Object { $_.FullName }
& javac -source 1.8 -target 1.8 -bootclasspath $PlatformAndroidJar -d "$BuildDir\obj" $JavaFiles

Write-Host ">>> [3/5] Converting Class Bytecode to DEX via D8..." -ForegroundColor Cyan
$ClassFiles = Get-ChildItem -Path "$BuildDir\obj" -Filter *.class -Recurse | ForEach-Object { $_.FullName }
& cmd /c $D8 --output "$BuildDir" --lib $PlatformAndroidJar $ClassFiles

Write-Host ">>> [4/5] Packaging DEX and Assets with UNIX forward slashes..." -ForegroundColor Cyan
Set-Location "$BuildDir"
& jar -uf "base.apk" "classes.dex"

# Add assets into base.apk using jar with forward slashes
& jar -uf "base.apk" -C "$BuildDir" "assets"
Set-Location "L:\projectz\OS"

Write-Host ">>> [5/5] Aligning and Signing PravahLauncher.apk..." -ForegroundColor Cyan
Remove-Item -Force -ErrorAction SilentlyContinue $OutApk, $AlignedApk

& $Zipalign -f -p 4 "$BuildDir\base.apk" $AlignedApk

# Generate debug keystore if not exists
$Keystore = "$BuildDir\debug.keystore"
if (-not (Test-Path $Keystore)) {
    & keytool -genkey -v -keystore $Keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=PravahOS, OU=Engineering, O=Pravah, L=Bangalore, S=KA, C=IN"
}

& cmd /c $Apksigner sign --ks $Keystore --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android --out $OutApk $AlignedApk

Write-Host "`n>>> [SUCCESS] PravahLauncher.apk built successfully!" -ForegroundColor Green
Get-Item $OutApk | Select-Object Name, Length, LastWriteTime
