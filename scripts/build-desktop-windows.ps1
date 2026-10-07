# Local Windows build of the desktop app (NSIS installer), mirroring .github/workflows/desktop-windows.yml.
#   powershell -ExecutionPolicy Bypass -File scripts\build-desktop-windows.ps1
# Writes dist\<version>\Gonggong_<version>_x64-setup.exe. With TAURI_SIGNING_PRIVATE_KEY (path or content) and
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD set, the updater signature (.sig) is produced too; without them the build skips
# the updater artifacts, which installed apps cannot auto-update from.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Assert-Ok([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}

# rustup adds this to PATH only for shells started after it installs.
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH" }

$version = (Get-Content -Raw apps\desktop\src-tauri\tauri.conf.json | ConvertFrom-Json).version
Write-Host "Building Gonggong desktop $version"

# The desktop frontend imports the web app's design system.
pnpm install --frozen-lockfile --filter '@gonggong/desktop...' --filter '@gonggong/web...'
Assert-Ok 'pnpm install'

$build = @('--filter', '@gonggong/desktop', 'tauri', 'build', '--bundles', 'nsis')
$signed = [bool]$env:TAURI_SIGNING_PRIVATE_KEY
if (-not $signed) {
  Write-Warning 'TAURI_SIGNING_PRIVATE_KEY is not set: building without updater artifacts'
  $noUpdater = Join-Path $env:TEMP 'gonggong-no-updater.json'
  '{"bundle":{"createUpdaterArtifacts":false}}' | Out-File -Encoding ascii $noUpdater
  $build += @('--config', $noUpdater)
}
pnpm @build
Assert-Ok 'tauri build'

# ASCII names: the bundle uses the Chinese product name.
$out = Join-Path $root "dist\$version"
New-Item -ItemType Directory -Force $out | Out-Null
$exe = Get-ChildItem target\release\bundle\nsis\*-setup.exe | Sort-Object LastWriteTime | Select-Object -Last 1
$dest = Join-Path $out "Gonggong_${version}_x64-setup.exe"
Copy-Item $exe.FullName $dest -Force
if ($signed) { Copy-Item "$($exe.FullName).sig" "$dest.sig" -Force }
Write-Host "Installer: $dest"
