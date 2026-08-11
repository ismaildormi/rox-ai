param(
  [string]$TargetPath,
  [switch]$AllowDirty,
  [switch]$SkipInstall,
  [switch]$CreateStagingBranch
)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Safe Bridge import into the existing Git project'
Add-Type -AssemblyName System.IO.Compression.FileSystem

if ([string]::IsNullOrWhiteSpace($TargetPath)) { $TargetPath = Read-Host 'Full path to the existing ROX AI project folder' }
if (-not (Test-Path -LiteralPath $TargetPath)) { throw "Target project not found: $TargetPath" }
$target = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $TargetPath).Path)
$source = [IO.Path]::GetFullPath($script:RoxRoot)
if ($target.TrimEnd('\\') -eq $source.TrimEnd('\\')) { throw 'Choose the existing Git project, not this extracted release folder.' }
foreach ($required in @('.git','frontend\index.html','backend\server.js','package.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $target $required))) { throw "Target is not the expected existing ROX project; missing $required" }
}

$git = Get-RoxGitInfo -Path $target
if (-not $git.IsRepository) { throw 'The target is not a Git repository.' }
if ((-not $git.Clean) -and (-not $AllowDirty)) { throw 'The target has uncommitted changes. Commit/stash them first, or rerun with -AllowDirty after making your own backup.' }
Write-RoxInfo "Git remote: $($git.Remote)"
Write-RoxInfo "Current branch: $($git.Branch) | commit $($git.Commit)"
if (-not (Confirm-RoxAction 'Import v0.64 into this exact project? Production will NOT be pushed or deployed.' -DefaultNo:$true)) { Write-RoxWarn 'Cancelled.'; return }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$targetRox = Join-Path $target '.rox'
$backupDir = Join-Path $targetRox 'bridge-backups'
$reportDir = Join-Path $targetRox 'bridge-reports'
New-Item -ItemType Directory -Path $backupDir,$reportDir -Force | Out-Null
$backupZip = Join-Path $backupDir "before-v0.64-$stamp.zip"
$temp = Join-Path ([IO.Path]::GetTempPath()) "rox-bridge-$stamp"
$snapshot = Join-Path $temp 'snapshot'
New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
$protectedRoots = @('.git','node_modules','backups','logs','.rox','.vercel','.railway')
$protectedRelative = @('backend\.env','frontend\rox-config.js','supabase\.temp')

function Is-Protected([string]$Relative) {
  $normalized = $Relative.Replace('/','\\').TrimStart('\\')
  foreach ($name in $protectedRoots) { if ($normalized -eq $name -or $normalized.StartsWith($name + '\\')) { return $true } }
  foreach ($name in $protectedRelative) { if ($normalized -eq $name -or $normalized.StartsWith($name + '\\')) { return $true } }
  return $false
}
function Get-Manifest([string]$Base) {
  $list = @()
  Get-ChildItem -LiteralPath $Base -Recurse -Force -File | ForEach-Object {
    $relative = $_.FullName.Substring($Base.Length).TrimStart('\\')
    if (-not (Is-Protected $relative)) { $list += $relative }
  }
  return $list
}
function Copy-Overlay([string]$From, [string]$To) {
  Get-ChildItem -LiteralPath $From -Recurse -Force -File | ForEach-Object {
    $relative = $_.FullName.Substring($From.Length).TrimStart('\\')
    if (Is-Protected $relative) { return }
    $destination = Join-Path $To $relative
    $parent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
  }
}

$manifest = Get-Manifest $target
$envBytes = if (Test-Path -LiteralPath (Join-Path $target 'backend\.env')) { [IO.File]::ReadAllBytes((Join-Path $target 'backend\.env')) } else { $null }
$configBytes = if (Test-Path -LiteralPath (Join-Path $target 'frontend\rox-config.js')) { [IO.File]::ReadAllBytes((Join-Path $target 'frontend\rox-config.js')) } else { $null }

try {
  Write-RoxInfo 'Creating a rollback snapshot before importing...'
  foreach ($relative in $manifest) {
    $src = Join-Path $target $relative; $dst = Join-Path $snapshot $relative
    $parent = Split-Path -Parent $dst; if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
  [IO.Compression.ZipFile]::CreateFromDirectory($snapshot, $backupZip, [IO.Compression.CompressionLevel]::Optimal, $false)
  Write-RoxOk "Rollback snapshot: $backupZip"

  $oldRoot = $script:RoxRoot
  $oldBackend = $script:RoxBackend
  if (Test-Path -LiteralPath (Join-Path $target 'ROX-STOP.ps1')) { & (Join-Path $target 'ROX-STOP.ps1') -ErrorAction SilentlyContinue }
  Copy-Overlay $source $target
  if ($null -ne $envBytes) { [IO.File]::WriteAllBytes((Join-Path $target 'backend\.env'), $envBytes) }
  if ($null -ne $configBytes) { [IO.File]::WriteAllBytes((Join-Path $target 'frontend\rox-config.js'), $configBytes) }

  Write-RoxInfo 'Initializing protected Local / Staging / Production profiles...'
  & (Join-Path $target 'ROX-PROFILE.ps1') -Action Initialize -ImportExistingProduction
  & (Join-Path $target 'ROX-PROFILE.ps1') -Action Switch -Profile local

  if (-not $SkipInstall) {
    Invoke-RoxProcess -FilePath 'npm' -Arguments @('install') -WorkingDirectory $target | Out-Null
    Invoke-RoxProcess -FilePath 'npm' -Arguments @('install') -WorkingDirectory (Join-Path $target 'backend') | Out-Null
  }
  & (Join-Path $target 'ROX-TEST.ps1') -Quick
  if ($LASTEXITCODE -ne 0) { throw 'Quick validation failed after the import.' }

  if ($CreateStagingBranch) {
    Push-Location $target
    try {
      $branch = 'staging/rox-v0.64'
      & git show-ref --verify --quiet "refs/heads/$branch"
      if ($LASTEXITCODE -eq 0) { & git switch $branch } else { & git switch -c $branch }
      if ($LASTEXITCODE -ne 0) { throw 'Could not create/switch the staging branch.' }
      Write-RoxOk "Staging branch ready locally: $branch"
    } finally { Pop-Location }
  }

  $after = Get-RoxGitInfo -Path $target
  $report = [ordered]@{ ImportedAt=(Get-Date -Format o); SourceVersion=(Get-RoxVersion); Target=$target; Remote=$after.Remote; OriginalCommit=$git.Commit; ActiveProfile='local'; Backup=$backupZip; Pushed=$false; Deployed=$false }
  $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $reportDir "bridge-$stamp.json") -Encoding UTF8
  Write-RoxOk 'Safe Bridge completed. The existing Git/hosting links were preserved.'
  Write-RoxWarn 'Nothing was committed, pushed, migrated, or deployed. Test Local next.'
}
catch {
  Write-RoxFail "Bridge failed: $($_.Exception.Message)"
  Write-RoxWarn 'Restoring the exact pre-import code snapshot...'
  $allowed = @{}; foreach ($item in $manifest) { $allowed[$item] = $true }
  Get-ChildItem -LiteralPath $target -Recurse -Force -File | ForEach-Object {
    $relative = $_.FullName.Substring($target.Length).TrimStart('\\')
    if ((-not (Is-Protected $relative)) -and (-not $allowed.ContainsKey($relative))) { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
  }
  Copy-Overlay $snapshot $target
  if ($null -ne $envBytes) { [IO.File]::WriteAllBytes((Join-Path $target 'backend\.env'), $envBytes) }
  if ($null -ne $configBytes) { [IO.File]::WriteAllBytes((Join-Path $target 'frontend\rox-config.js'), $configBytes) }
  Write-RoxOk 'Rollback restored the previous project code.'
  throw
}
finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
