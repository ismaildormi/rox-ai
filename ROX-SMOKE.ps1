param([switch]$Authenticated)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Launch smoke tests'
if (-not (Test-RoxCommand 'node')) { throw 'Node.js is required.' }
if ($Authenticated) {
  Write-RoxWarn 'Authenticated mode sends one real chat request and consumes quota/credits according to the active account.'
  if (-not (Confirm-RoxAction 'Continue with the authenticated smoke request?' -DefaultNo:$true)) { exit 0 }
}
$args = @((Join-Path $script:RoxRoot 'tools\live-smoke.js'))
if ($Authenticated) { $args += '--authenticated' }
Invoke-RoxProcess -FilePath 'node' -Arguments $args -WorkingDirectory $script:RoxRoot
