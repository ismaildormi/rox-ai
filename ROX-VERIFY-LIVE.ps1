param([switch]$JsonOnly)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
if (-not $JsonOnly) { Write-RoxHeader 'Live provider verifier (read-only)' }
$envMap = Get-RoxEnvMap
$profile = Get-RoxActiveProfile
$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Name,[string]$Status,[string]$Detail) {
  $results.Add([PSCustomObject]@{ Provider=$Name; Status=$Status; Detail=$Detail })
  if (-not $JsonOnly) {
    if ($Status -eq 'PASS') { Write-RoxOk "$Name - $Detail" }
    elseif ($Status -eq 'SKIP') { Write-RoxWarn "$Name - $Detail" }
    else { Write-RoxFail "$Name - $Detail" }
  }
}
function Value([string]$Key) { if ($envMap.ContainsKey($Key)) { return [string]$envMap[$Key] } return '' }
function Web([string]$Name,[string]$Uri,[hashtable]$Headers=@{},[string]$Method='Get',[int[]]$Allowed=@(200)) {
  if ([string]::IsNullOrWhiteSpace($Uri) -or (Test-RoxPlaceholder $Uri)) { Add-Result $Name 'SKIP' 'URL is not configured'; return }
  try {
    $response = Invoke-WebRequest -Uri $Uri -Method $Method -Headers $Headers -TimeoutSec 12 -UseBasicParsing
    if ($Allowed -contains [int]$response.StatusCode) { Add-Result $Name 'PASS' "HTTP $($response.StatusCode)" }
    else { Add-Result $Name 'FAIL' "HTTP $($response.StatusCode)" }
  } catch {
    $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
    if ($Allowed -contains $status) { Add-Result $Name 'PASS' "HTTP $status" }
    else { Add-Result $Name 'FAIL' $(if ($status) { "HTTP $status" } else { $_.Exception.Message }) }
  }
}

Add-Result 'Active profile' 'PASS' $profile
$api = (Value 'PUBLIC_API_BASE').TrimEnd('/')
$app = (Value 'APP_URL').TrimEnd('/')
Web 'ROX backend health' "$api/healthz" @{} 'Get' @(200)
Web 'ROX frontend' $app @{} 'Get' @(200)

$supa = (Value 'SUPABASE_URL').TrimEnd('/'); $anon = Value 'SUPABASE_ANON_KEY'
if ((Test-RoxPlaceholder $supa) -or [string]::IsNullOrWhiteSpace($anon)) { Add-Result 'Supabase public API' 'SKIP' 'URL/anon key is missing' }
else { Web 'Supabase public API' "$supa/rest/v1/" @{ apikey=$anon; Authorization="Bearer $anon" } 'Get' @(200,404) }

$open = Value 'OPENROUTER_API_KEY'
if ([string]::IsNullOrWhiteSpace($open)) { Add-Result 'OpenRouter' 'SKIP' 'API key is missing' }
else { Web 'OpenRouter' 'https://openrouter.ai/api/v1/models' @{ Authorization="Bearer $open"; 'HTTP-Referer'=$app; 'X-Title'='ROX AI verifier' } 'Get' @(200) }

$replicate = Value 'REPLICATE_API_TOKEN'
if ([string]::IsNullOrWhiteSpace($replicate)) { Add-Result 'Replicate' 'SKIP' 'API token is missing' }
else { Web 'Replicate' 'https://api.replicate.com/v1/account' @{ Authorization="Bearer $replicate" } 'Get' @(200) }

$stripe = Value 'STRIPE_SECRET_KEY'
if ([string]::IsNullOrWhiteSpace($stripe)) { Add-Result 'Stripe' 'SKIP' 'Secret key is missing' }
else { Web 'Stripe' 'https://api.stripe.com/v1/account' @{ Authorization="Bearer $stripe" } 'Get' @(200) }

$fal = Value 'FAL_KEY'
if ([string]::IsNullOrWhiteSpace($fal)) { Add-Result 'FAL' 'SKIP' 'API key is missing' }
else { Add-Result 'FAL' 'SKIP' 'Key is configured; no safe non-billable account endpoint is used by this verifier' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $script:RoxLogsDir "live-verifier-$stamp.json"
$summary = [ordered]@{ checkedAt=(Get-Date -Format o); profile=$profile; results=@($results); passed=@($results|Where-Object Status -eq 'PASS').Count; failed=@($results|Where-Object Status -eq 'FAIL').Count; skipped=@($results|Where-Object Status -eq 'SKIP').Count }
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $out -Encoding UTF8
if ($JsonOnly) { $summary | ConvertTo-Json -Depth 5 } else { Write-RoxInfo "Report: $out" }
if ($summary.failed -gt 0) { throw "$($summary.failed) live verification check(s) failed." }
