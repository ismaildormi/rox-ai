param(
  [ValidateSet('Menu','Railway','VercelPreview','Production','ConfigureUrls')]
  [string]$Action = 'Menu'
)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Guarded deployment tools'

function Assert-StagingContext {
  if ((Get-RoxActiveProfile) -ne 'staging') { throw 'Staging profile must be active.' }
  $git = Get-RoxGitInfo
  if (-not $git.IsRepository) { throw 'Run inside the existing Git project.' }
  if ($git.Branch -eq 'main') { throw 'Refusing staging deployment from main. Use ROX-STAGING.ps1.' }
}
function Assert-ProductionContext {
  if ((Get-RoxActiveProfile) -ne 'production') { throw 'Production profile must be active.' }
  $git = Get-RoxGitInfo
  if (-not $git.IsRepository) { throw 'Run inside the existing Git project.' }
  if ($git.Branch -ne 'main') { throw "Production requires branch main; current: $($git.Branch)" }
  if (-not $git.Clean) { throw 'Production requires a clean Git working tree.' }
  & (Join-Path $script:RoxRoot 'ROX-TEST.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Full validation failed.' }
  $typed = Read-Host 'Type PRODUCTION to unlock the live deployment'
  if ($typed -cne 'PRODUCTION') { throw 'Production deployment was not confirmed.' }
}
function Ensure-Cli([string]$Name,[string]$Package) {
  if (-not (Test-RoxCommand $Name)) {
    if (Confirm-RoxAction "$Name CLI is missing. Install $Package globally with npm?") { Invoke-RoxProcess -FilePath 'npm' -Arguments @('install','-g',$Package) | Out-Null }
    else { throw "$Name CLI is required." }
  }
}
function Deploy-RailwayStaging {
  Assert-StagingContext; Ensure-Cli 'railway' '@railway/cli'
  Write-RoxWarn 'Link the Railway STAGING service/environment when prompted. Do not select the production service.'
  Invoke-RoxProcess -FilePath 'railway' -Arguments @('up') -WorkingDirectory $script:RoxBackend | Out-Null
}
function Deploy-VercelPreview {
  Assert-StagingContext; Ensure-Cli 'vercel' 'vercel'
  Invoke-RoxProcess -FilePath 'vercel' -Arguments @() -WorkingDirectory $script:RoxRoot | Out-Null
}
function Deploy-Production {
  Assert-ProductionContext; Ensure-Cli 'railway' '@railway/cli'; Ensure-Cli 'vercel' 'vercel'
  Write-RoxWarn 'Railway: verify the CLI is linked to the PRODUCTION backend before continuing.'
  if (-not (Confirm-RoxAction 'Deploy backend to the currently linked Railway production service?' -DefaultNo:$true)) { return }
  Invoke-RoxProcess -FilePath 'railway' -Arguments @('up') -WorkingDirectory $script:RoxBackend | Out-Null
  Invoke-RoxProcess -FilePath 'vercel' -Arguments @('--prod') -WorkingDirectory $script:RoxRoot | Out-Null
}
function Invoke-DeployAction([string]$Selected) {
  switch ($Selected) {
    'Railway' { Deploy-RailwayStaging }
    'VercelPreview' { Deploy-VercelPreview }
    'Production' { Deploy-Production }
    'ConfigureUrls' { & (Join-Path $script:RoxRoot 'ROX-PROFILE.ps1') }
  }
}
if ($Action -ne 'Menu') { Invoke-DeployAction $Action; return }
while ($true) {
  Write-Host ''
  Write-Host '1. Deploy backend to Railway STAGING'
  Write-Host '2. Deploy frontend to Vercel Preview'
  Write-Host '3. PRODUCTION deployment (guarded)'
  Write-Host '4. Configure/switch profiles'
  Write-Host '0. Back'
  switch (Read-Host 'Choose') {
    '1' { Invoke-DeployAction 'Railway' }
    '2' { Invoke-DeployAction 'VercelPreview' }
    '3' { Invoke-DeployAction 'Production' }
    '4' { Invoke-DeployAction 'ConfigureUrls' }
    '0' { break }
  }
}
