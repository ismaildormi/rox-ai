param(
  [string]$ReleaseZip,
  [switch]$SkipBackup,
  [switch]$NoStart
)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Safe update from ZIP'
Add-Type -AssemblyName System.IO.Compression.FileSystem

if ([string]::IsNullOrWhiteSpace($ReleaseZip)) { $ReleaseZip = Read-Host 'Full path to the new ROX release ZIP' }
if (-not (Test-Path -LiteralPath $ReleaseZip)) { throw "Release ZIP not found: $ReleaseZip" }
$ReleaseZip = (Resolve-Path $ReleaseZip).Path

$rollbackDir = Join-Path $script:RoxRoot '.rox\rollback'
New-Item -ItemType Directory -Path $rollbackDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$snapshotZip = Join-Path $rollbackDir "rox-code-$stamp.zip"
$manifestPath = Join-Path $rollbackDir "rox-code-$stamp.manifest.json"
$tempBase = Join-Path ([IO.Path]::GetTempPath()) "rox-update-$stamp"
$extractDir = Join-Path $tempBase 'release'
$snapshotDir = Join-Path $tempBase 'snapshot'
New-Item -ItemType Directory -Path $extractDir,$snapshotDir -Force | Out-Null

$protectedRoots = @('.git','node_modules','backups','logs','.rox')
$protectedFiles = @('backend\.env','frontend\rox-config.js')
$preservedEnv = if (Test-Path -LiteralPath $script:RoxEnvPath) { [System.IO.File]::ReadAllBytes($script:RoxEnvPath) } else { $null }
$preservedFrontendConfig = if (Test-Path -LiteralPath $script:RoxFrontendConfig) { [System.IO.File]::ReadAllBytes($script:RoxFrontendConfig) } else { $null }

function Is-Protected([string]$Relative) {
  $normalized = $Relative.Replace('/', '\').TrimStart('\')
  foreach ($rootName in $protectedRoots) {
    if ($normalized -eq $rootName -or $normalized.StartsWith($rootName + '\')) { return $true }
  }
  foreach ($fileName in $protectedFiles) { if ($normalized -eq $fileName) { return $true } }
  return $false
}

function Get-CodeManifest {
  $items = @()
  Get-ChildItem -LiteralPath $script:RoxRoot -Recurse -Force -File | ForEach-Object {
    $relative = $_.FullName.Substring($script:RoxRoot.Length).TrimStart('\')
    if (-not (Is-Protected $relative)) { $items += $relative }
  }
  return $items
}

function Copy-ReleaseOverlay([string]$SourceRoot) {
  Get-ChildItem -LiteralPath $SourceRoot -Force | ForEach-Object {
    if ($protectedRoots -contains $_.Name) { return }
    $dest = Join-Path $script:RoxRoot $_.Name
    if ($_.PSIsContainer) {
      Copy-RoxDirectorySafe -Source $_.FullName -Destination $dest -ExcludeNames @('node_modules','.git','backups','logs','.rox')
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    }
  }
}

try {
  $oldManifest = Get-CodeManifest
  $oldManifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

  if (-not $SkipBackup) {
    Write-RoxInfo 'Creating rollback snapshot...'
    Copy-RoxDirectorySafe -Source $script:RoxRoot -Destination $snapshotDir -ExcludeNames @('.git','node_modules','backups','logs','.rox')
    Remove-Item -LiteralPath (Join-Path $snapshotDir 'backend\.env') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $snapshotDir 'frontend\rox-config.js') -Force -ErrorAction SilentlyContinue
    [System.IO.Compression.ZipFile]::CreateFromDirectory($snapshotDir, $snapshotZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    Write-RoxOk "Rollback snapshot: $snapshotZip"
  }

  [System.IO.Compression.ZipFile]::ExtractToDirectory($ReleaseZip, $extractDir)
  $candidates = @(Get-ChildItem -LiteralPath $extractDir -Directory -Recurse | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_.FullName 'package.json')) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName 'backend')) -and
    (Test-Path -LiteralPath (Join-Path $_.FullName 'frontend'))
  })
  if ((Test-Path -LiteralPath (Join-Path $extractDir 'package.json')) -and (Test-Path (Join-Path $extractDir 'backend'))) {
    $releaseRoot = $extractDir
  } elseif ($candidates.Count -gt 0) {
    $releaseRoot = $candidates[0].FullName
  } else { throw 'The ZIP does not contain a recognizable ROX AI project root.' }

  Write-RoxInfo "Release root: $releaseRoot"
  & (Join-Path $script:RoxRoot 'ROX-STOP.ps1')
  Copy-ReleaseOverlay $releaseRoot
  if ($null -ne $preservedEnv) { [System.IO.File]::WriteAllBytes($script:RoxEnvPath, $preservedEnv) }
  if ($null -ne $preservedFrontendConfig) { [System.IO.File]::WriteAllBytes($script:RoxFrontendConfig, $preservedFrontendConfig) }

  Write-RoxInfo 'Installing updated dependencies...'
  Invoke-RoxProcess -FilePath 'npm' -Arguments @('install') -WorkingDirectory $script:RoxRoot | Out-Null
  Invoke-RoxProcess -FilePath 'npm' -Arguments @('install') -WorkingDirectory $script:RoxBackend | Out-Null

  $envMap = Get-RoxEnvMap
  if ($envMap.ContainsKey('SUPABASE_DB_URL') -and -not [string]::IsNullOrWhiteSpace([string]$envMap['SUPABASE_DB_URL'])) {
    if (Test-RoxCommand 'psql') {
      Invoke-RoxProcess -FilePath 'node' -Arguments @((Join-Path $script:RoxBackend 'scripts\migrate.js')) -WorkingDirectory $script:RoxRoot | Out-Null
    } else { Write-RoxWarn 'psql is unavailable; migrations were not applied automatically.' }
  }

  & (Join-Path $script:RoxRoot 'ROX-TEST.ps1') -Quick
  if ($LASTEXITCODE -ne 0) { throw 'Post-update validation failed.' }

  if (-not $NoStart) { & (Join-Path $script:RoxRoot 'ROX-START.ps1') -NoBrowser }
  Write-RoxOk 'Update completed and validated.'
}
catch {
  Write-RoxFail "Update failed: $($_.Exception.Message)"
  if ((-not $SkipBackup) -and (Test-Path -LiteralPath $snapshotZip)) {
    Write-RoxWarn 'Automatic rollback is starting...'
    $rollbackExtract = Join-Path $tempBase 'rollback'
    New-Item -ItemType Directory -Path $rollbackExtract -Force | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($snapshotZip, $rollbackExtract)

    $allowed = @{}
    foreach ($item in (Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json)) { $allowed[[string]$item] = $true }
    Get-ChildItem -LiteralPath $script:RoxRoot -Recurse -Force -File | ForEach-Object {
      $relative = $_.FullName.Substring($script:RoxRoot.Length).TrimStart('\')
      if ((-not (Is-Protected $relative)) -and (-not $allowed.ContainsKey($relative))) {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
      }
    }
    Copy-ReleaseOverlay $rollbackExtract
    if ($null -ne $preservedEnv) { [System.IO.File]::WriteAllBytes($script:RoxEnvPath, $preservedEnv) }
    if ($null -ne $preservedFrontendConfig) { [System.IO.File]::WriteAllBytes($script:RoxFrontendConfig, $preservedFrontendConfig) }
    Invoke-RoxProcess -FilePath 'npm' -Arguments @('install') -WorkingDirectory $script:RoxRoot -AllowFailure | Out-Null
    Invoke-RoxProcess -FilePath 'npm' -Arguments @('install') -WorkingDirectory $script:RoxBackend -AllowFailure | Out-Null
    if (-not $NoStart) { & (Join-Path $script:RoxRoot 'ROX-START.ps1') -NoBrowser }
    Write-RoxOk 'Rollback completed. The previous code was restored.'
  }
  throw
}
finally {
  Remove-Item -LiteralPath $tempBase -Recurse -Force -ErrorAction SilentlyContinue
}
