Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:RoxRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:RoxBackend = Join-Path $script:RoxRoot 'backend'
$script:RoxFrontend = Join-Path $script:RoxRoot 'frontend'
$script:RoxStateDir = Join-Path $script:RoxRoot '.rox\state'
$script:RoxLogsDir = Join-Path $script:RoxRoot 'logs'
$script:RoxBackupsDir = Join-Path $script:RoxRoot 'backups'
$script:RoxEnvPath = Join-Path $script:RoxBackend '.env'
$script:RoxEnvExamplePath = Join-Path $script:RoxBackend '.env.example'
$script:RoxFrontendConfig = Join-Path $script:RoxFrontend 'rox-config.js'
$script:RoxProfilesDir = Join-Path $script:RoxRoot '.rox\profiles'
$script:RoxActiveProfilePath = Join-Path $script:RoxStateDir 'active-profile.txt'
$script:RoxProfileTemplatesDir = Join-Path $script:RoxRoot 'config\profiles'
$script:RoxBridgeReportsDir = Join-Path $script:RoxRoot '.rox\bridge-reports'

function Initialize-RoxDirectories {
  foreach ($dir in @($script:RoxStateDir, $script:RoxLogsDir, $script:RoxBackupsDir, $script:RoxProfilesDir, $script:RoxBridgeReportsDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
  }
}

function Write-RoxHeader([string]$Title) {
  Write-Host ''
  Write-Host ('=' * 68) -ForegroundColor DarkGray
  Write-Host (' ROX AI - ' + $Title) -ForegroundColor Cyan
  Write-Host ('=' * 68) -ForegroundColor DarkGray
}

function Write-RoxOk([string]$Message) { Write-Host ('[OK] ' + $Message) -ForegroundColor Green }
function Write-RoxInfo([string]$Message) { Write-Host ('[INFO] ' + $Message) -ForegroundColor Cyan }
function Write-RoxWarn([string]$Message) { Write-Host ('[WARN] ' + $Message) -ForegroundColor Yellow }
function Write-RoxFail([string]$Message) { Write-Host ('[FAIL] ' + $Message) -ForegroundColor Red }

function Test-RoxCommand([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-RoxProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = $script:RoxRoot,
    [switch]$AllowFailure,
    [switch]$Capture
  )

  $display = $FilePath
  if ($Arguments.Count -gt 0) { $display += ' ' + ($Arguments -join ' ') }
  Write-RoxInfo $display

  if ($Capture) {
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if (($exitCode -ne 0) -and (-not $AllowFailure)) {
      throw "Command failed with exit code ${exitCode}: $display`n$($output -join [Environment]::NewLine)"
    }
    return @($exitCode, $output)
  }

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }

  if (($exitCode -ne 0) -and (-not $AllowFailure)) {
    throw "Command failed with exit code ${exitCode}: $display"
  }
  return $exitCode
}

function Confirm-RoxAction([string]$Message, [bool]$DefaultNo = $true) {
  $suffix = if ($DefaultNo) { '[y/N]' } else { '[Y/n]' }
  $answer = Read-Host "$Message $suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) { return (-not $DefaultNo) }
  return $answer -match '^(y|yes|o|oui)$'
}

function Get-RoxEnvMap {
  param([string]$Path = $script:RoxEnvPath)
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $eq = $trimmed.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $trimmed.Substring(0, $eq).Trim()
    $value = $trimmed.Substring($eq + 1).Trim()
    $map[$key] = $value
  }
  return $map
}

function Set-RoxEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [AllowEmptyString()][string]$Value,
    [string]$Path = $script:RoxEnvPath
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    if (Test-Path -LiteralPath $script:RoxEnvExamplePath) {
      Copy-Item -LiteralPath $script:RoxEnvExamplePath -Destination $Path -Force
    } else {
      New-Item -ItemType File -Path $Path -Force | Out-Null
    }
  }

  $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
  $escapedKey = [Regex]::Escape($Key)
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$escapedKey\s*=") {
      $lines[$i] = "$Key=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) {
    $lines += "$Key=$Value"
  }
  [System.IO.File]::WriteAllLines($Path, $lines, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-RoxValue {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [AllowEmptyString()][string]$Current = '',
    [switch]$Secret,
    [switch]$Optional
  )

  $currentHint = ''
  if (-not [string]::IsNullOrWhiteSpace($Current)) {
    $currentHint = if ($Secret) { ' [configured - Enter keeps it]' } else { " [$Current]" }
  } elseif ($Optional) {
    $currentHint = ' [optional]'
  }

  if ($Secret) {
    $secure = Read-Host ($Label + $currentHint) -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  } else {
    $value = Read-Host ($Label + $currentHint)
  }

  if ([string]::IsNullOrWhiteSpace($value) -and -not [string]::IsNullOrWhiteSpace($Current)) {
    return $Current
  }
  return $value.Trim()
}

function New-RoxSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return ([Convert]::ToBase64String($buffer)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-RoxActiveProfile {
  if (Test-Path -LiteralPath $script:RoxActiveProfilePath) {
    $profile = (Get-Content -LiteralPath $script:RoxActiveProfilePath -Raw -Encoding UTF8).Trim().ToLowerInvariant()
    if ($profile -in @('local','staging','production')) { return $profile }
  }
  return 'local'
}

function Set-RoxActiveProfile([ValidateSet('local','staging','production')][string]$Profile) {
  Initialize-RoxDirectories
  Set-Content -LiteralPath $script:RoxActiveProfilePath -Value $Profile.ToLowerInvariant() -Encoding ASCII
}

function Get-RoxProfileEnvPath([ValidateSet('local','staging','production')][string]$Profile) {
  Initialize-RoxDirectories
  return (Join-Path $script:RoxProfilesDir ($Profile.ToLowerInvariant() + '.env'))
}

function Test-RoxTruthy([AllowNull()][object]$Value) {
  if ($null -eq $Value) { return $false }
  return ([string]$Value).Trim() -match '^(1|true|yes|on)$'
}

function Get-RoxFeatureFlags {
  param([hashtable]$EnvMap = (Get-RoxEnvMap))
  return [ordered]@{
    projects = if ($EnvMap.ContainsKey('ROX_FEATURE_PROJECTS')) { Test-RoxTruthy $EnvMap['ROX_FEATURE_PROJECTS'] } else { $false }
    history = if ($EnvMap.ContainsKey('ROX_FEATURE_HISTORY')) { Test-RoxTruthy $EnvMap['ROX_FEATURE_HISTORY'] } else { $false }
    automations = if ($EnvMap.ContainsKey('ROX_FEATURE_AUTOMATIONS')) { Test-RoxTruthy $EnvMap['ROX_FEATURE_AUTOMATIONS'] } else { $false }
    roxip = if ($EnvMap.ContainsKey('ROX_FEATURE_ROXIP')) { Test-RoxTruthy $EnvMap['ROX_FEATURE_ROXIP'] } else { $false }
  }
}

function Write-RoxFrontendConfig {
  param(
    [Parameter(Mandatory = $true)][string]$SupabaseUrl,
    [Parameter(Mandatory = $true)][string]$SupabaseAnonKey,
    [Parameter(Mandatory = $true)][string]$ApiBase,
    [ValidateSet('local','staging','production')][string]$Profile = (Get-RoxActiveProfile),
    [System.Collections.IDictionary]$Features
  )

  if ($null -eq $Features) { $Features = Get-RoxFeatureFlags }
  $safeUrl = $SupabaseUrl.Replace("'", "\\'")
  $safeAnon = $SupabaseAnonKey.Replace("'", "\\'")
  $safeApi = $ApiBase.TrimEnd('/').Replace("'", "\\'")
  $featureRows = @()
  foreach ($key in @('projects','history','automations','roxip')) {
    $value = if ($Features.Contains($key) -and [bool]$Features[$key]) { 'true' } else { 'false' }
    $featureRows += "    ${key}: ${value}"
  }
  $featureText = $featureRows -join ",`n"
  $content = @"
/* Generated by ROX profile/configuration tools. Public browser configuration only. */
window.ROX_RUNTIME_CONFIG = Object.freeze({
  PROFILE: '$Profile',
  SUPABASE_URL: '$safeUrl',
  SUPABASE_ANON_KEY: '$safeAnon',
  API_BASE: '$safeApi',
  FEATURES: Object.freeze({
$featureText
  })
});
"@
  [System.IO.File]::WriteAllText($script:RoxFrontendConfig, $content, (New-Object System.Text.UTF8Encoding($false)))
}

function Sync-RoxFrontendConfigFromEnv {
  param([hashtable]$EnvMap = (Get-RoxEnvMap), [string]$Profile = (Get-RoxActiveProfile))
  $supabaseUrl = if ($EnvMap.ContainsKey('SUPABASE_URL')) { [string]$EnvMap['SUPABASE_URL'] } else { '' }
  $anon = if ($EnvMap.ContainsKey('SUPABASE_ANON_KEY')) { [string]$EnvMap['SUPABASE_ANON_KEY'] } else { '' }
  $api = if ($EnvMap.ContainsKey('PUBLIC_API_BASE')) { [string]$EnvMap['PUBLIC_API_BASE'] } else { 'http://127.0.0.1:3001' }
  Write-RoxFrontendConfig -SupabaseUrl $supabaseUrl -SupabaseAnonKey $anon -ApiBase $api -Profile $Profile -Features (Get-RoxFeatureFlags -EnvMap $EnvMap)
}

function Test-RoxPlaceholder([AllowNull()][object]$Value) {
  if ($null -eq $Value) { return $true }
  $text = ([string]$Value).Trim()
  return [string]::IsNullOrWhiteSpace($text) -or $text -match '(YOUR_|CHANGE_ME|example\\.com|staging\\.example)'
}

function Get-RoxGitInfo([string]$Path = $script:RoxRoot) {
  $result = [ordered]@{ IsRepository = $false; Branch = ''; Remote = ''; Clean = $false; Commit = '' }
  if (-not (Test-RoxCommand 'git')) { return $result }
  Push-Location $Path
  try {
    & git rev-parse --is-inside-work-tree *> $null
    if ($LASTEXITCODE -ne 0) { return $result }
    $result.IsRepository = $true
    $result.Branch = ([string](& git branch --show-current 2>$null | Select-Object -First 1)).Trim()
    $result.Remote = ([string](& git remote get-url origin 2>$null | Select-Object -First 1)).Trim()
    $result.Commit = ([string](& git rev-parse --short HEAD 2>$null | Select-Object -First 1)).Trim()
    $status = @(& git status --porcelain 2>$null)
    $result.Clean = $status.Count -eq 0
  } finally { Pop-Location }
  return $result
}

function Get-RoxVersion {
  $versionPath = Join-Path $script:RoxRoot 'VERSION.json'
  if (Test-Path -LiteralPath $versionPath) {
    try { return (Get-Content -LiteralPath $versionPath -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
  }
  try { return (Get-Content -LiteralPath (Join-Path $script:RoxRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { return 'unknown' }
}

function Get-RoxFrontendPidPath { return (Join-Path $script:RoxStateDir 'frontend.pid') }

function Test-RoxProcessId([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Start-RoxFrontend {
  param([int]$Port = 5500, [switch]$OpenBrowser)
  Initialize-RoxDirectories
  $pidPath = Get-RoxFrontendPidPath
  if (Test-Path -LiteralPath $pidPath) {
    $oldPid = 0
    [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$oldPid) | Out-Null
    if (Test-RoxProcessId $oldPid) {
      Write-RoxOk "Frontend already running (PID $oldPid)."
      if ($OpenBrowser) { Start-Process "http://127.0.0.1:$Port" }
      return $oldPid
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-RoxCommand 'node')) { throw 'Node.js is required to start the frontend.' }
  $stdout = Join-Path $script:RoxLogsDir 'rox-frontend.out.log'
  $stderr = Join-Path $script:RoxLogsDir 'rox-frontend.err.log'
  $server = Join-Path $script:RoxRoot 'tools\serve-frontend.js'
  $process = Start-Process -FilePath 'node' -ArgumentList @("`"$server`"", "$Port") -WorkingDirectory $script:RoxRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ASCII
  Start-Sleep -Milliseconds 800
  if (-not (Test-RoxProcessId $process.Id)) {
    throw "Frontend failed to start. Check $stderr"
  }
  Write-RoxOk "Frontend started at http://127.0.0.1:$Port (PID $($process.Id))."
  if ($OpenBrowser) { Start-Process "http://127.0.0.1:$Port" }
  return $process.Id
}

function Stop-RoxFrontend {
  $pidPath = Get-RoxFrontendPidPath
  if (-not (Test-Path -LiteralPath $pidPath)) {
    Write-RoxInfo 'Frontend PID file not found; nothing to stop.'
    return
  }
  $frontPid = 0
  [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$frontPid) | Out-Null
  if (Test-RoxProcessId $frontPid) {
    Stop-Process -Id $frontPid -Force -ErrorAction SilentlyContinue
    Write-RoxOk "Frontend stopped (PID $frontPid)."
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

function Invoke-RoxCli {
  param([Parameter(Mandatory = $true)][string[]]$Arguments, [switch]$AllowFailure)
  return Invoke-RoxProcess -FilePath 'node' -Arguments (@((Join-Path $script:RoxRoot 'cli\rox.js')) + $Arguments) -WorkingDirectory $script:RoxRoot -AllowFailure:$AllowFailure
}

function Test-RoxPort([int]$Port) {
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(500, $false)
    if ($ok) { $client.EndConnect($async) }
    $client.Close()
    return $ok
  } catch { return $false }
}

function Get-RoxSafeEnvironmentSummary {
  $env = Get-RoxEnvMap
  $secretPattern = '(KEY|TOKEN|SECRET|PASSWORD|DB_URL)'
  $rows = @()
  foreach ($key in ($env.Keys | Sort-Object)) {
    $configured = -not [string]::IsNullOrWhiteSpace([string]$env[$key])
    $value = if ($key -match $secretPattern) { if ($configured) { '<configured>' } else { '<missing>' } } else { [string]$env[$key] }
    $rows += [PSCustomObject]@{ Key = $key; Value = $value; Configured = $configured }
  }
  return $rows
}

function Copy-RoxDirectorySafe {
  param([string]$Source, [string]$Destination, [string[]]$ExcludeNames = @())
  if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($ExcludeNames -contains $_.Name) { return }
    $dest = Join-Path $Destination $_.Name
    if ($_.PSIsContainer) {
      Copy-RoxDirectorySafe -Source $_.FullName -Destination $dest -ExcludeNames $ExcludeNames
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    }
  }
}

Initialize-RoxDirectories
