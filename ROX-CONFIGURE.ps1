param(
  [ValidateSet('Core','Media','Billing','Frontend','All')]
  [string]$Mode = 'All',
  [ValidateSet('local','staging','production')]
  [string]$Profile
)

. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
if (-not [string]::IsNullOrWhiteSpace($Profile)) {
  $script:RoxEnvPath = Get-RoxProfileEnvPath $Profile
}
Write-RoxHeader "Configuration ($Mode$(if ($Profile) { ' / ' + $Profile } else { '' }))"

if (-not (Test-Path -LiteralPath $script:RoxEnvPath)) {
  Copy-Item -LiteralPath $script:RoxEnvExamplePath -Destination $script:RoxEnvPath -Force
  Write-RoxOk 'Created backend/.env from .env.example.'
}

$envMap = Get-RoxEnvMap
function Current([string]$Key) { if ($envMap.ContainsKey($Key)) { return [string]$envMap[$Key] } return '' }
function Save([string]$Key, [string]$Value) { Set-RoxEnvValue -Key $Key -Value $Value; $envMap[$Key] = $Value }

$configureCore = $Mode -in @('Core','All')
$configureMedia = $Mode -in @('Media','All')
$configureBilling = $Mode -in @('Billing','All')
$configureFrontend = $Mode -in @('Frontend','Core','All')

if ($configureCore) {
  Write-RoxInfo 'Core services. Press Enter to keep an existing value.'
  Save 'SUPABASE_URL' (Read-RoxValue 'Supabase project URL' (Current 'SUPABASE_URL'))
  Save 'SUPABASE_SERVICE_ROLE_KEY' (Read-RoxValue 'Supabase service-role key' (Current 'SUPABASE_SERVICE_ROLE_KEY') -Secret)
  Save 'SUPABASE_DB_URL' (Read-RoxValue 'Supabase database connection URL' (Current 'SUPABASE_DB_URL') -Secret -Optional)
  Save 'OPENROUTER_API_KEY' (Read-RoxValue 'OpenRouter API key' (Current 'OPENROUTER_API_KEY') -Secret)
  $redisCurrent = Current 'REDIS_URL'
  if ([string]::IsNullOrWhiteSpace($redisCurrent)) { $redisCurrent = 'redis://localhost:6379' }
  Save 'REDIS_URL' (Read-RoxValue 'Redis URL' $redisCurrent)

  $cron = Current 'CRON_SECRET'
  if ([string]::IsNullOrWhiteSpace($cron)) { $cron = New-RoxSecret }
  Save 'CRON_SECRET' $cron
  $metrics = Current 'METRICS_TOKEN'
  if ([string]::IsNullOrWhiteSpace($metrics)) { $metrics = New-RoxSecret }
  Save 'METRICS_TOKEN' $metrics
}

if ($configureMedia) {
  Write-RoxInfo 'Media providers are optional. Empty values disable that provider.'
  Save 'FAL_KEY' (Read-RoxValue 'FAL API key' (Current 'FAL_KEY') -Secret -Optional)
  Save 'REPLICATE_API_TOKEN' (Read-RoxValue 'Replicate API token' (Current 'REPLICATE_API_TOKEN') -Secret -Optional)
}

if ($configureBilling) {
  Write-RoxInfo 'Stripe values can stay empty until billing is enabled.'
  Save 'STRIPE_SECRET_KEY' (Read-RoxValue 'Stripe secret key' (Current 'STRIPE_SECRET_KEY') -Secret -Optional)
  Save 'STRIPE_WEBHOOK_SECRET' (Read-RoxValue 'Stripe webhook secret' (Current 'STRIPE_WEBHOOK_SECRET') -Secret -Optional)
  Save 'STRIPE_PRO_PRICE_ID' (Read-RoxValue 'Stripe Pro price ID' (Current 'STRIPE_PRO_PRICE_ID') -Optional)
}

if ($configureFrontend) {
  Write-RoxInfo 'Public frontend configuration. These values are safe to send to the browser.'
  $supabaseCurrent = Current 'SUPABASE_URL'
  if ([string]::IsNullOrWhiteSpace($supabaseCurrent)) { $supabaseCurrent = 'https://YOUR_PROJECT.supabase.co' }
  $supabaseUrl = Read-RoxValue 'Public Supabase URL' $supabaseCurrent
  $anonKey = Read-RoxValue 'Supabase anon/publishable key' (Current 'SUPABASE_ANON_KEY') -Secret
  $apiCurrent = Current 'PUBLIC_API_BASE'
  if ([string]::IsNullOrWhiteSpace($apiCurrent)) { $apiCurrent = 'http://127.0.0.1:3001' }
  $apiBase = Read-RoxValue 'Browser API base URL' $apiCurrent
  $appCurrent = Current 'APP_URL'
  if ([string]::IsNullOrWhiteSpace($appCurrent)) { $appCurrent = 'http://127.0.0.1:5500' }
  $appUrl = Read-RoxValue 'Frontend app URL' $appCurrent

  Save 'SUPABASE_URL' $supabaseUrl
  Save 'SUPABASE_ANON_KEY' $anonKey
  Save 'PUBLIC_API_BASE' $apiBase.TrimEnd('/')
  Save 'APP_URL' $appUrl.TrimEnd('/')
  Save 'ALLOWED_ORIGINS' $appUrl.TrimEnd('/')
  $selectedProfile = if ($Profile) { $Profile } else { Get-RoxActiveProfile }
  if (-not $Profile -or $selectedProfile -eq (Get-RoxActiveProfile)) {
    Write-RoxFrontendConfig -SupabaseUrl $supabaseUrl -SupabaseAnonKey $anonKey -ApiBase $apiBase -Profile $selectedProfile -Features (Get-RoxFeatureFlags -EnvMap $envMap)
    Write-RoxOk 'Updated frontend/rox-config.js without touching frontend/index.html.'
  } else {
    Write-RoxOk "Saved inactive profile '$selectedProfile'; the currently active runtime config was not changed."
  }
}

Write-Host ''
$required = @('SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','OPENROUTER_API_KEY')
$missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace((Current $_)) })
if ($missing.Count -eq 0) {
  Write-RoxOk 'Core configuration is complete.'
} else {
  Write-RoxWarn ('Still missing core values: ' + ($missing -join ', '))
}
if ($Profile -and $Profile -eq (Get-RoxActiveProfile)) {
  Copy-Item -LiteralPath $script:RoxEnvPath -Destination (Join-Path $script:RoxBackend '.env') -Force
  Sync-RoxFrontendConfigFromEnv -EnvMap $envMap -Profile $Profile
}
Write-RoxInfo 'Secret values were saved only in the selected private profile/backend env and were not printed.'
