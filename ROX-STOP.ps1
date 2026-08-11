. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Stop all services'
Stop-RoxFrontend
if (Test-RoxCommand 'node') { Invoke-RoxCli -Arguments @('stop') -AllowFailure | Out-Null }
Write-RoxOk 'ROX AI services stopped.'
