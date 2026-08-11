param([switch]$NoEnv)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Backup data and configuration'
$args = @('backup')
if ($NoEnv) { $args += '--no-env' }
Invoke-RoxCli -Arguments $args | Out-Null
