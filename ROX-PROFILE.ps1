param(
  [ValidateSet('Menu','Initialize','Show','Switch','Configure')]
  [string]$Action = 'Menu',
  [ValidateSet('local','staging','production')]
  [string]$Profile = 'local',
  [switch]$ImportExistingProduction,
  [switch]$AllowIncomplete
)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Environment profiles'

function Merge-RoxTemplateIntoEnv([string]$TemplatePath, [string]$DestinationPath) {
  if (-not (Test-Path -LiteralPath $DestinationPath)) {
    if (Test-Path -LiteralPath $script:RoxEnvPath) { Copy-Item -LiteralPath $script:RoxEnvPath -Destination $DestinationPath -Force }
    elseif (Test-Path -LiteralPath $script:RoxEnvExamplePath) { Copy-Item -LiteralPath $script:RoxEnvExamplePath -Destination $DestinationPath -Force }
    else { New-Item -ItemType File -Path $DestinationPath -Force | Out-Null }
  }
  $template = Get-RoxEnvMap -Path $TemplatePath
  foreach ($key in $template.Keys) { Set-RoxEnvValue -Key $key -Value ([string]$template[$key]) -Path $DestinationPath }
}

function Initialize-RoxProfiles {
  Initialize-RoxDirectories
  $productionPath = Get-RoxProfileEnvPath 'production'
  if (-not (Test-Path -LiteralPath $productionPath)) {
    if (($ImportExistingProduction -or (Test-Path -LiteralPath $script:RoxEnvPath)) -and (Test-Path -LiteralPath $script:RoxEnvPath)) {
      Copy-Item -LiteralPath $script:RoxEnvPath -Destination $productionPath -Force
      Set-RoxEnvValue -Key 'ROX_ENVIRONMENT' -Value 'production' -Path $productionPath
      Write-RoxOk 'Preserved existing backend/.env as the production profile.'
      if ($ImportExistingProduction -and -not (Test-Path -LiteralPath $script:RoxActiveProfilePath)) { Set-RoxActiveProfile 'production' }
    } else {
      Copy-Item -LiteralPath (Join-Path $script:RoxProfileTemplatesDir 'production.env.template') -Destination $productionPath -Force
    }
  }
  if ($ImportExistingProduction -and -not (Test-Path -LiteralPath $script:RoxActiveProfilePath)) { Set-RoxActiveProfile 'production' }

  $localPath = Get-RoxProfileEnvPath 'local'
  if (-not (Test-Path -LiteralPath $localPath)) {
    if (Test-Path -LiteralPath $productionPath) { Copy-Item -LiteralPath $productionPath -Destination $localPath -Force }
    else { Copy-Item -LiteralPath $script:RoxEnvExamplePath -Destination $localPath -Force }
    $localTemplate = Get-RoxEnvMap -Path (Join-Path $script:RoxProfileTemplatesDir 'local.env.template')
    foreach ($key in $localTemplate.Keys) { Set-RoxEnvValue -Key $key -Value ([string]$localTemplate[$key]) -Path $localPath }
    Write-RoxWarn 'Local currently reuses any imported provider/Supabase secrets. Use only non-destructive tests until a separate staging project is configured.'
  }

  $stagingPath = Get-RoxProfileEnvPath 'staging'
  if (-not (Test-Path -LiteralPath $stagingPath)) {
    Copy-Item -LiteralPath $script:RoxEnvExamplePath -Destination $stagingPath -Force
    $stagingTemplate = Get-RoxEnvMap -Path (Join-Path $script:RoxProfileTemplatesDir 'staging.env.template')
    foreach ($key in $stagingTemplate.Keys) { Set-RoxEnvValue -Key $key -Value ([string]$stagingTemplate[$key]) -Path $stagingPath }
  }
  Write-RoxOk 'Local, staging, and production profile files are ready under .rox/profiles.'
}

function Save-CurrentProfile {
  if (-not (Test-Path -LiteralPath $script:RoxEnvPath)) { return }
  $current = Get-RoxActiveProfile
  Copy-Item -LiteralPath $script:RoxEnvPath -Destination (Get-RoxProfileEnvPath $current) -Force
}

function Assert-ProfileReady([string]$Name, [hashtable]$Map) {
  $required = @('SUPABASE_URL','SUPABASE_ANON_KEY','PUBLIC_API_BASE','APP_URL')
  $missing = @($required | Where-Object { -not $Map.ContainsKey($_) -or (Test-RoxPlaceholder $Map[$_]) })
  if ($missing.Count -gt 0) { throw "Profile '$Name' is not configured: $($missing -join ', '). Run Configure first." }
  if ($Name -eq 'production' -and $Map.ContainsKey('STRIPE_SECRET_KEY') -and ([string]$Map['STRIPE_SECRET_KEY']).StartsWith('sk_test_')) {
    Write-RoxWarn 'Production profile currently contains a Stripe test key.'
  }
}

function Switch-RoxProfile([string]$Name) {
  Initialize-RoxProfiles
  Save-CurrentProfile
  $path = Get-RoxProfileEnvPath $Name
  $map = Get-RoxEnvMap -Path $path
  if (-not $AllowIncomplete) { Assert-ProfileReady $Name $map }
  elseif (@('SUPABASE_URL','SUPABASE_ANON_KEY') | Where-Object { -not $map.ContainsKey($_) -or (Test-RoxPlaceholder $map[$_]) }) { Write-RoxWarn "Profile '$Name' is active but incomplete; configure it before live use." }
  Copy-Item -LiteralPath $path -Destination $script:RoxEnvPath -Force
  Set-RoxActiveProfile $Name
  Sync-RoxFrontendConfigFromEnv -EnvMap $map -Profile $Name
  Write-RoxOk "Active profile: $Name"
  Write-RoxInfo "Frontend: $($map['APP_URL'])"
  Write-RoxInfo "Backend: $($map['PUBLIC_API_BASE'])"
}

function Show-RoxProfiles {
  Initialize-RoxProfiles
  $active = Get-RoxActiveProfile
  foreach ($name in @('local','staging','production')) {
    $path = Get-RoxProfileEnvPath $name
    $map = Get-RoxEnvMap -Path $path
    $marker = if ($name -eq $active) { '*' } else { ' ' }
    $app = if ($map.ContainsKey('APP_URL')) { [string]$map['APP_URL'] } else { '' }
    $api = if ($map.ContainsKey('PUBLIC_API_BASE')) { [string]$map['PUBLIC_API_BASE'] } else { '' }
    Write-Host "$marker $name | APP=$app | API=$api"
  }
}

function Configure-RoxProfile([string]$Name) {
  Initialize-RoxProfiles
  & (Join-Path $script:RoxRoot 'ROX-CONFIGURE.ps1') -Mode All -Profile $Name
}

function Invoke-ProfileAction([string]$Selected) {
  switch ($Selected) {
    'Initialize' { Initialize-RoxProfiles }
    'Show' { Show-RoxProfiles }
    'Switch' { Switch-RoxProfile $Profile }
    'Configure' { Configure-RoxProfile $Profile }
  }
}

if ($Action -ne 'Menu') { Invoke-ProfileAction $Action; return }
Initialize-RoxProfiles
while ($true) {
  Write-Host ''
  Show-RoxProfiles
  Write-Host ''
  Write-Host '1. Activate Local'
  Write-Host '2. Configure / activate Staging'
  Write-Host '3. Configure / activate Production'
  Write-Host '4. Configure Local'
  Write-Host '0. Back'
  switch (Read-Host 'Choose') {
    '1' { Switch-RoxProfile 'local' }
    '2' { Configure-RoxProfile 'staging'; Switch-RoxProfile 'staging' }
    '3' { Configure-RoxProfile 'production'; Switch-RoxProfile 'production' }
    '4' { Configure-RoxProfile 'local'; if ((Get-RoxActiveProfile) -eq 'local') { Switch-RoxProfile 'local' } }
    '0' { break }
  }
}
