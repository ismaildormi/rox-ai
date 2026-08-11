param(
  [switch]$SkipConfiguration,
  [switch]$SkipTests,
  [switch]$StartAfterSetup
)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'One-click setup'
Initialize-RoxDirectories

if (-not (Test-RoxCommand 'node')) {
  Write-RoxFail 'Node.js is missing.'
  if ((Test-RoxCommand 'winget') -and (Confirm-RoxAction 'Install Node.js LTS with winget?')) {
    Invoke-RoxProcess -FilePath 'winget' -Arguments @('install','--id','OpenJS.NodeJS.LTS','-e','--accept-package-agreements','--accept-source-agreements') -WorkingDirectory $script:RoxRoot | Out-Null
    Write-RoxWarn 'Node was installed. Close this window, open ROX-SETUP.cmd again, and continue.'
    exit 0
  }
  throw 'Install Node.js 22 or newer, then run setup again.'
}

$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 22) { throw "Node.js 22+ is required. Found major version $nodeMajor." }
Write-RoxOk "Node.js $(& node --version)"
if (-not (Test-RoxCommand 'npm')) { throw 'npm is missing from PATH.' }

Write-RoxInfo 'Installing root dependencies...'
Invoke-RoxProcess -FilePath 'npm' -Arguments @('install') -WorkingDirectory $script:RoxRoot | Out-Null
Write-RoxInfo 'Installing backend dependencies...'
Invoke-RoxProcess -FilePath 'npm' -Arguments @('install') -WorkingDirectory $script:RoxBackend | Out-Null

if (-not (Test-Path -LiteralPath $script:RoxEnvPath)) {
  Copy-Item -LiteralPath $script:RoxEnvExamplePath -Destination $script:RoxEnvPath -Force
  Write-RoxOk 'Created backend/.env.'
}
if (-not (Test-Path -LiteralPath $script:RoxFrontendConfig)) {
  Copy-Item -LiteralPath (Join-Path $script:RoxFrontend 'rox-config.example.js') -Destination $script:RoxFrontendConfig -Force
}

& (Join-Path $script:RoxRoot 'ROX-PROFILE.ps1') -Action Initialize -ImportExistingProduction
& (Join-Path $script:RoxRoot 'ROX-PROFILE.ps1') -Action Switch -Profile local -AllowIncomplete

if (-not $SkipConfiguration) {
  if (Confirm-RoxAction 'Configure Supabase, OpenRouter, frontend URLs, media and Stripe now?' -DefaultNo:$false) {
    & (Join-Path $script:RoxRoot 'ROX-CONFIGURE.ps1') -Mode All
  }
}

$envMap = Get-RoxEnvMap
$redisUrl = if ($envMap.ContainsKey('REDIS_URL')) { [string]$envMap['REDIS_URL'] } else { 'redis://localhost:6379' }
if (($redisUrl -match 'localhost|127\.0\.0\.1') -and (-not (Test-RoxPort 6379))) {
  if (Test-RoxCommand 'docker') {
    Write-RoxInfo 'Starting Redis with Docker Compose...'
    Invoke-RoxProcess -FilePath 'docker' -Arguments @('compose','up','-d','redis') -WorkingDirectory $script:RoxRoot -AllowFailure | Out-Null
  } else {
    Write-RoxWarn 'Docker is not installed. Install Docker Desktop or configure a remote REDIS_URL.'
  }
}

if ($envMap.ContainsKey('SUPABASE_DB_URL') -and -not [string]::IsNullOrWhiteSpace([string]$envMap['SUPABASE_DB_URL'])) {
  if (Test-RoxCommand 'psql') {
    Invoke-RoxProcess -FilePath 'node' -Arguments @((Join-Path $script:RoxBackend 'scripts\migrate.js')) -WorkingDirectory $script:RoxRoot | Out-Null
  } else {
    Write-RoxWarn 'psql is missing. Generating one SQL migration bundle instead.'
    & (Join-Path $script:RoxRoot 'ROX-SUPABASE.ps1') -Action Bundle
  }
}

if (-not $SkipTests) { & (Join-Path $script:RoxRoot 'ROX-TEST.ps1') -Quick }
if ($StartAfterSetup -or (Confirm-RoxAction 'Start ROX AI now?' -DefaultNo:$false)) {
  & (Join-Path $script:RoxRoot 'ROX-START.ps1')
}
Write-RoxOk 'Setup completed. Use ROX-MANAGER.cmd from now on.'
