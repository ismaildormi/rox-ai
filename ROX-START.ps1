param([switch]$NoBrowser)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader "Start all services | profile: $(Get-RoxActiveProfile)"

if (-not (Test-RoxCommand 'node')) { throw 'Node.js is not installed or not on PATH.' }
if (-not (Test-Path -LiteralPath $script:RoxEnvPath)) { throw 'backend/.env is missing. Run ROX-SETUP.cmd first.' }

$envMap = Get-RoxEnvMap
Sync-RoxFrontendConfigFromEnv -EnvMap $envMap -Profile (Get-RoxActiveProfile)
$redisUrl = if ($envMap.ContainsKey('REDIS_URL')) { [string]$envMap['REDIS_URL'] } else { 'redis://localhost:6379' }
if (($redisUrl -match 'localhost|127\.0\.0\.1') -and (-not (Test-RoxPort 6379))) {
  if (Test-RoxCommand 'docker') {
    Write-RoxInfo 'Starting local Redis through Docker Compose...'
    Invoke-RoxProcess -FilePath 'docker' -Arguments @('compose','up','-d','redis') -WorkingDirectory $script:RoxRoot -AllowFailure | Out-Null
    Start-Sleep -Seconds 2
  } else {
    Write-RoxWarn 'Local Redis is not running and Docker is unavailable.'
  }
}

Invoke-RoxCli -Arguments @('start') | Out-Null
$port = 5500
if ($envMap.ContainsKey('ROX_FRONTEND_PORT')) { [int]::TryParse([string]$envMap['ROX_FRONTEND_PORT'], [ref]$port) | Out-Null }
Start-RoxFrontend -Port $port -OpenBrowser:(-not $NoBrowser) | Out-Null
Write-RoxOk 'ROX AI start sequence completed.'
