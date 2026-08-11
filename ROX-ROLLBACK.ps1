param([string]$SnapshotZip)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Rollback code'
$rollbackDir = Join-Path $script:RoxRoot '.rox\rollback'
if ([string]::IsNullOrWhiteSpace($SnapshotZip)) {
  $latest = Get-ChildItem -LiteralPath $rollbackDir -Filter 'rox-code-*.zip' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -eq $latest) { throw 'No rollback snapshots were found.' }
  $SnapshotZip = $latest.FullName
}
if (-not (Confirm-RoxAction "Restore code snapshot $SnapshotZip?")) { Write-RoxWarn 'Cancelled.'; exit 0 }
& (Join-Path $script:RoxRoot 'ROX-UPDATE.ps1') -ReleaseZip $SnapshotZip -SkipBackup
