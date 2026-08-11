param(
  [ValidateSet('Menu','Setup','Configure','Start','Stop','Restart','Health','Test','Logs','Backup','Restore','Update','Rollback','Supabase','Stripe','Deploy','Support','Shortcut','Open','Profiles','Bridge','VerifyLive','Smoke','Staging')]
  [string]$Action = 'Menu'
)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
function Invoke-ManagerAction([string]$Selected) {
  switch ($Selected) {
    'Setup' { & (Join-Path $script:RoxRoot 'ROX-SETUP.ps1') }
    'Configure' { & (Join-Path $script:RoxRoot 'ROX-CONFIGURE.ps1') -Mode All }
    'Start' { & (Join-Path $script:RoxRoot 'ROX-START.ps1') }
    'Stop' { & (Join-Path $script:RoxRoot 'ROX-STOP.ps1') }
    'Restart' { & (Join-Path $script:RoxRoot 'ROX-RESTART.ps1') }
    'Health' { & (Join-Path $script:RoxRoot 'ROX-HEALTH.ps1') -Fix }
    'Test' { & (Join-Path $script:RoxRoot 'ROX-TEST.ps1') }
    'Logs' { if (Test-RoxCommand 'node') { Invoke-RoxCli -Arguments @('logs') -AllowFailure | Out-Null } else { Start-Process explorer.exe $script:RoxLogsDir } }
    'Backup' { & (Join-Path $script:RoxRoot 'ROX-BACKUP.ps1') }
    'Restore' { & (Join-Path $script:RoxRoot 'ROX-RESTORE.ps1') }
    'Update' { & (Join-Path $script:RoxRoot 'ROX-UPDATE.ps1') }
    'Rollback' { & (Join-Path $script:RoxRoot 'ROX-ROLLBACK.ps1') }
    'Supabase' { & (Join-Path $script:RoxRoot 'ROX-SUPABASE.ps1') }
    'Stripe' { & (Join-Path $script:RoxRoot 'ROX-STRIPE.ps1') }
    'Deploy' { & (Join-Path $script:RoxRoot 'ROX-DEPLOY.ps1') }
    'Support' { & (Join-Path $script:RoxRoot 'ROX-SUPPORT.ps1') }
    'Shortcut' { & (Join-Path $script:RoxRoot 'ROX-SHORTCUT.ps1') }
    'Profiles' { & (Join-Path $script:RoxRoot 'ROX-PROFILE.ps1') }
    'Bridge' { & (Join-Path $script:RoxRoot 'ROX-BRIDGE.ps1') }
    'VerifyLive' { & (Join-Path $script:RoxRoot 'ROX-VERIFY-LIVE.ps1') }
    'Smoke' { & (Join-Path $script:RoxRoot 'ROX-SMOKE.ps1') }
    'Staging' { & (Join-Path $script:RoxRoot 'ROX-STAGING.ps1') }
    'Open' { $envMap=Get-RoxEnvMap; $url=if($envMap.ContainsKey('APP_URL')){[string]$envMap['APP_URL']}else{'http://127.0.0.1:5500'}; Start-Process $url }
  }
}
if ($Action -ne 'Menu') { Invoke-ManagerAction $Action; exit $LASTEXITCODE }
while ($true) {
  Clear-Host
  Write-RoxHeader "Windows Manager v$(Get-RoxVersion) | profile: $(Get-RoxActiveProfile)"
  Write-Host ' 1. First-time setup / repair install'
  Write-Host ' 2. Configure current profile keys and URLs'
  Write-Host ' 3. Start everything and open ROX AI'
  Write-Host ' 4. Stop everything'
  Write-Host ' 5. Restart everything'
  Write-Host ' 6. Health check + automatic fixes'
  Write-Host ' 7. Run full validation tests'
  Write-Host ' 8. View live logs'
  Write-Host ' 9. Backup database/configuration'
  Write-Host '10. Restore a backup'
  Write-Host '11. Safe update from a new ZIP'
  Write-Host '12. Roll back to previous code'
  Write-Host '13. Supabase tools and migrations'
  Write-Host '14. Stripe tools and webhook testing'
  Write-Host '15. Guarded Railway / Vercel deployment'
  Write-Host '16. Create safe support ZIP'
  Write-Host '17. Open ROX AI in browser'
  Write-Host '18. Create desktop shortcut'
  Write-Host '19. Local / Staging / Production profiles'
  Write-Host '20. Safe Bridge into existing Git project'
  Write-Host '21. Live provider verifier (read-only)'
  Write-Host '22. Launch smoke tests'
  Write-Host '23. Prepare and optionally push staging branch'
  Write-Host ' 0. Exit'
  $choice=Read-Host 'Choose an action'
  try {
    $map=@{'1'='Setup';'2'='Configure';'3'='Start';'4'='Stop';'5'='Restart';'6'='Health';'7'='Test';'8'='Logs';'9'='Backup';'10'='Restore';'11'='Update';'12'='Rollback';'13'='Supabase';'14'='Stripe';'15'='Deploy';'16'='Support';'17'='Open';'18'='Shortcut';'19'='Profiles';'20'='Bridge';'21'='VerifyLive';'22'='Smoke';'23'='Staging'}
    if($choice -eq '0'){break}elseif($map.ContainsKey($choice)){Invoke-ManagerAction $map[$choice]}else{Write-RoxWarn 'Unknown option.'}
  } catch { Write-RoxFail $_.Exception.Message }
  if($choice -ne '0'){Write-Host '';Read-Host 'Press Enter to return to the manager'|Out-Null}
}
