param([switch]$Fix)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Health and doctor'

$envMap = Get-RoxEnvMap
$activeProfile = Get-RoxActiveProfile
Write-RoxInfo "Active profile: $activeProfile"
if ($envMap.ContainsKey('ROX_ENVIRONMENT') -and ([string]$envMap['ROX_ENVIRONMENT']).ToLowerInvariant() -ne $activeProfile) {
  Write-RoxWarn "Profile state/env mismatch: state=$activeProfile env=$($envMap['ROX_ENVIRONMENT']). Switch the profile again to repair it."
}
$required = @('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENROUTER_API_KEY')
$missing = @($required | Where-Object { -not $envMap.ContainsKey($_) -or [string]::IsNullOrWhiteSpace([string]$envMap[$_]) })
if ($missing.Count) { Write-RoxWarn ('Missing configuration: ' + ($missing -join ', ')) } else { Write-RoxOk 'Core environment variables are configured.' }

if (Test-RoxCommand 'node') {
  Invoke-RoxCli -Arguments $(if ($Fix) { @('doctor','--fix') } else { @('doctor') }) -AllowFailure | Out-Null
} else { Write-RoxFail 'Node.js not found.' }

$frontPidPath = Get-RoxFrontendPidPath
if (Test-Path -LiteralPath $frontPidPath) {
  $frontPid = 0
  [int]::TryParse((Get-Content -LiteralPath $frontPidPath -Raw).Trim(), [ref]$frontPid) | Out-Null
  if (Test-RoxProcessId $frontPid) { Write-RoxOk "Frontend process online (PID $frontPid)." } else { Write-RoxWarn 'Frontend PID is stale.' }
} else { Write-RoxWarn 'Frontend is not started by ROX Manager.' }

& (Join-Path $script:RoxRoot 'ROX-TEST.ps1') -Quick
