. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Create safe support report'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$temp = Join-Path ([IO.Path]::GetTempPath()) "rox-support-$stamp"
$out = Join-Path $script:RoxBackupsDir "rox-support-$stamp.zip"
New-Item -ItemType Directory -Path $temp -Force | Out-Null

try {
  $system = New-Object System.Collections.Generic.List[string]
  $system.Add("ROX AI support report - $(Get-Date -Format o)")
  $system.Add("Version: $(Get-RoxVersion)")
  $system.Add("Active profile: $(Get-RoxActiveProfile)")
  $system.Add("OS: $([Environment]::OSVersion.VersionString)")
  $system.Add("PowerShell: $($PSVersionTable.PSVersion)")
  foreach ($tool in @('node','npm','git','docker','psql','railway','vercel','stripe')) {
    if (Test-RoxCommand $tool) {
      try {
        $versionArgs = if ($tool -eq 'docker') { @('--version') } else { @('--version') }
        $value = (& $tool @versionArgs 2>&1 | Select-Object -First 1)
        $system.Add("${tool}: $value")
      } catch { $system.Add("${tool}: installed (version unavailable)") }
    } else { $system.Add("${tool}: missing") }
  }
  $system | Set-Content -LiteralPath (Join-Path $temp 'system.txt') -Encoding UTF8

  Get-RoxSafeEnvironmentSummary | Format-Table -AutoSize | Out-String | Set-Content -LiteralPath (Join-Path $temp 'environment-redacted.txt') -Encoding UTF8

  if (Test-RoxCommand 'git') {
    Push-Location $script:RoxRoot
    try { (& git status --short 2>&1) | Set-Content -LiteralPath (Join-Path $temp 'git-status.txt') -Encoding UTF8 } finally { Pop-Location }
  }

  if (Test-RoxCommand 'docker') {
    (& docker ps -a 2>&1) | Set-Content -LiteralPath (Join-Path $temp 'docker-ps.txt') -Encoding UTF8
  }

  Get-ChildItem -LiteralPath $script:RoxLogsDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    Get-Content -LiteralPath $_.FullName -Tail 400 -ErrorAction SilentlyContinue | Set-Content -LiteralPath (Join-Path $temp $_.Name) -Encoding UTF8
  }

  try { & (Join-Path $script:RoxRoot 'ROX-TEST.ps1') -Quick *> (Join-Path $temp 'quick-validation.txt') } catch { $_ | Out-String | Set-Content -LiteralPath (Join-Path $temp 'quick-validation-error.txt') }

  $secretRegex = '(?i)(sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|sbp_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)'
  Get-ChildItem -LiteralPath $temp -File | ForEach-Object {
    $text = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -ne $text) {
      $redacted = [Regex]::Replace($text, $secretRegex, '<redacted-secret>')
      Set-Content -LiteralPath $_.FullName -Value $redacted -Encoding UTF8
    }
  }

  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($temp, $out, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  Write-RoxOk "Support ZIP created: $out"
  Start-Process explorer.exe -ArgumentList ("/select,`"$out`"")
}
finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
