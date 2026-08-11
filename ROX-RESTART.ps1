param([switch]$NoBrowser)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Restart all services'
& (Join-Path $script:RoxRoot 'ROX-STOP.ps1')
& (Join-Path $script:RoxRoot 'ROX-START.ps1') -NoBrowser:$NoBrowser
