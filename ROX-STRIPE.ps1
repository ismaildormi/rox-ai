param(
  [ValidateSet('Menu','Configure','Check','Login','Listen','Trigger')]
  [string]$Action = 'Menu'
)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Stripe tools'

function Check-StripeConfig {
  $envMap = Get-RoxEnvMap
  $keys = @('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PRO_PRICE_ID')
  foreach ($key in $keys) {
    if ($envMap.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace([string]$envMap[$key])) { Write-RoxOk "$key configured" }
    else { Write-RoxWarn "$key missing" }
  }
}

function Invoke-StripeAction([string]$Selected) {
  switch ($Selected) {
    'Configure' { & (Join-Path $script:RoxRoot 'ROX-CONFIGURE.ps1') -Mode Billing }
    'Check' { Check-StripeConfig }
    'Login' {
      if (-not (Test-RoxCommand 'stripe')) { throw 'Stripe CLI is not installed. Install it from the official Stripe CLI installer, then run this again.' }
      Invoke-RoxProcess -FilePath 'stripe' -Arguments @('login') -WorkingDirectory $script:RoxRoot | Out-Null
    }
    'Listen' {
      if (-not (Test-RoxCommand 'stripe')) { throw 'Stripe CLI is not installed.' }
      Write-RoxInfo 'Stripe will forward sandbox events to http://127.0.0.1:3001/webhook. Keep this window open.'
      Invoke-RoxProcess -FilePath 'stripe' -Arguments @('listen','--forward-to','http://127.0.0.1:3001/webhook') -WorkingDirectory $script:RoxRoot | Out-Null
    }
    'Trigger' {
      if (-not (Test-RoxCommand 'stripe')) { throw 'Stripe CLI is not installed.' }
      Invoke-RoxProcess -FilePath 'stripe' -Arguments @('trigger','checkout.session.completed') -WorkingDirectory $script:RoxRoot | Out-Null
    }
  }
}

if ($Action -ne 'Menu') { Invoke-StripeAction $Action; exit }
while ($true) {
  Write-Host ''
  Write-Host '1. Configure Stripe keys'
  Write-Host '2. Check Stripe configuration'
  Write-Host '3. Stripe CLI login'
  Write-Host '4. Start local webhook forwarding'
  Write-Host '5. Trigger sandbox checkout event'
  Write-Host '0. Back'
  switch (Read-Host 'Choose') {
    '1' { Invoke-StripeAction 'Configure' }
    '2' { Invoke-StripeAction 'Check' }
    '3' { Invoke-StripeAction 'Login' }
    '4' { Invoke-StripeAction 'Listen' }
    '5' { Invoke-StripeAction 'Trigger' }
    '0' { break }
  }
}
