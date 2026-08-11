param([switch]$Quick)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader $(if ($Quick) { 'Quick validation' } else { 'Full validation' })
Initialize-RoxDirectories

$passed = 0
$failed = 0
$skipped = 0
$results = New-Object System.Collections.Generic.List[string]

function Run-Check([string]$Name, [scriptblock]$Action, [switch]$Optional) {
  Write-Host ''
  Write-RoxInfo $Name
  try {
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "Exit code $LASTEXITCODE" }
    $script:passed++
    $results.Add("PASS | $Name")
    Write-RoxOk $Name
  } catch {
    if ($Optional) {
      $script:skipped++
      $results.Add("SKIP | $Name | $($_.Exception.Message)")
      Write-RoxWarn "$Name skipped: $($_.Exception.Message)"
    } else {
      $script:failed++
      $results.Add("FAIL | $Name | $($_.Exception.Message)")
      Write-RoxFail "${Name}: $($_.Exception.Message)"
    }
  }
}

Run-Check 'Required project files' {
  $required = @('frontend\index.html','frontend\rox-config.js','frontend\rox-release-guard.js','backend\server.js','backend\worker.js','cli\rox.js','ROX-MANAGER.ps1','ROX-BRIDGE.ps1','ROX-PROFILE.ps1','ROX-VERIFY-LIVE.ps1','ROX-SMOKE.ps1')
  foreach ($item in $required) { if (-not (Test-Path -LiteralPath (Join-Path $script:RoxRoot $item))) { throw "Missing $item" } }
}

Run-Check 'Node.js version' {
  if (-not (Test-RoxCommand 'node')) { throw 'node not found' }
  $major = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
  if ($major -lt 22) { throw "Node.js 22+ required; found $major" }
}

Run-Check 'Frontend and backend JavaScript syntax' {
  & node (Join-Path $script:RoxRoot 'tools\validate-release.js')
}

Run-Check 'Windows automation static tests' {
  & node (Join-Path $script:RoxRoot 'tools\test-windows-automation.js')
}

Run-Check 'Safe Bridge and deployment gates' {
  & node (Join-Path $script:RoxRoot 'tools\test-safe-bridge.js')
}

Run-Check 'Backend launch blockers' {
  Push-Location $script:RoxBackend
  try { & node 'test-launch-blockers.js'; if ($LASTEXITCODE -ne 0) { throw 'test-launch-blockers.js failed' }; & node 'test-runtime-safety.js'; if ($LASTEXITCODE -ne 0) { throw 'test-runtime-safety.js failed' } } finally { Pop-Location }
}

if (-not $Quick) {
  Run-Check 'Backend unit tests' {
    Push-Location $script:RoxBackend
    try { & npm run test:unit } finally { Pop-Location }
  }
  Run-Check 'CLI test suite' {
    Push-Location $script:RoxRoot
    try { & npm run test:cli } finally { Pop-Location }
  }
  Run-Check 'Production deployment config tests' {
    Push-Location $script:RoxRoot
    try { & npm run test:deploy } finally { Pop-Location }
  }
}

$coreKeys = @('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','OPENROUTER_API_KEY')
$envMap = Get-RoxEnvMap
$configured = @($coreKeys | Where-Object { $envMap.ContainsKey($_) -and -not [string]::IsNullOrWhiteSpace([string]$envMap[$_]) }).Count
$configScore = [math]::Round(($configured / $coreKeys.Count) * 20)
$testTotal = [math]::Max(1, $passed + $failed)
$testScore = [math]::Round(($passed / $testTotal) * 80)
$ready = [math]::Min(100, $testScore + $configScore)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$report = Join-Path $script:RoxLogsDir "rox-test-$stamp.txt"
@(
  "ROX AI validation - $(Get-Date -Format o)",
  "Version: $(Get-RoxVersion)",
  "Active profile: $(Get-RoxActiveProfile)",
  "Passed: $passed",
  "Failed: $failed",
  "Skipped: $skipped",
  "Core configured: $configured/$($coreKeys.Count)",
  "READY SCORE: $ready%",
  '',
  $results
) | Set-Content -LiteralPath $report -Encoding UTF8

Write-Host ''
Write-Host "READY SCORE: $ready%" -ForegroundColor $(if ($ready -ge 85) { 'Green' } elseif ($ready -ge 60) { 'Yellow' } else { 'Red' })
Write-Host "Passed: $passed | Failed: $failed | Skipped: $skipped"
Write-RoxInfo "Report: $report"
if ($failed -gt 0) { exit 1 }
