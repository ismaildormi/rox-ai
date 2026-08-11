param([string]$BackupFile)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Restore backup'
if ([string]::IsNullOrWhiteSpace($BackupFile)) {
  $BackupFile = Read-Host 'Full path to rox-backup-*.tar.gz'
}
if (-not (Test-Path -LiteralPath $BackupFile)) { throw "Backup not found: $BackupFile" }
if (-not (Confirm-RoxAction 'Restore can overwrite database/configuration. Continue?')) { Write-RoxWarn 'Cancelled.'; exit 0 }
Invoke-RoxCli -Arguments @('restore', (Resolve-Path $BackupFile).Path, '--yes') | Out-Null
