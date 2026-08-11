param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$failures = New-Object System.Collections.Generic.List[string]
Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.ps1' | ForEach-Object {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $_.FullName,
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null
  foreach ($error in @($errors)) {
    $relative = $_.FullName.Substring($root.Length).TrimStart('\')
    $failures.Add("${relative}:$($error.Extent.StartLineNumber):$($error.Extent.StartColumnNumber) $($error.Message)")
  }
}
if ($failures.Count -gt 0) {
  Write-Host '[FAIL] PowerShell syntax validation failed:' -ForegroundColor Red
  $failures | ForEach-Object { Write-Host ('  ' + $_) -ForegroundColor Red }
  exit 1
}
if (-not $Quiet) { Write-Host '[OK] All PowerShell scripts passed the native Windows parser.' -ForegroundColor Green }
exit 0
