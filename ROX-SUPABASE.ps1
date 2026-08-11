param(
  [ValidateSet('Menu','Configure','Migrate','Bundle','Test')]
  [string]$Action = 'Menu'
)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Supabase tools'

function New-MigrationBundle {
  $out = Join-Path $script:RoxBackupsDir ('rox-supabase-migrations-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')
  $files = Get-ChildItem -LiteralPath $script:RoxBackend -Filter '*.sql' -File | Where-Object { $_.Name -match '^\d+_' } | Sort-Object { [int]($_.Name.Split('_')[0]) }
  $content = New-Object System.Collections.Generic.List[string]
  $content.Add('-- ROX AI combined Supabase migration bundle')
  $content.Add('-- Generated: ' + (Get-Date -Format o))
  foreach ($file in $files) {
    $content.Add('')
    $content.Add('-- ============================================================')
    $content.Add('-- ' + $file.Name)
    $content.Add('-- ============================================================')
    $content.Add((Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8))
  }
  [System.IO.File]::WriteAllLines($out, $content, (New-Object System.Text.UTF8Encoding($false)))
  Write-RoxOk "Migration bundle created: $out"
}

function Test-SupabaseConnection {
  $envMap = Get-RoxEnvMap
  if (-not $envMap.ContainsKey('SUPABASE_URL') -or -not $envMap.ContainsKey('SUPABASE_SERVICE_ROLE_KEY')) { throw 'Supabase URL/service-role key are not configured.' }
  Push-Location $script:RoxBackend
  try {
    & node -e "require('dotenv').config(); const {createClient}=require('@supabase/supabase-js'); const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}); s.from('profiles').select('id',{head:true,count:'exact'}).limit(1).then(({error})=>{if(error){console.error(error.message);process.exit(1)} console.log('Supabase reachable');}).catch(e=>{console.error(e.message);process.exit(1)});"
    if ($LASTEXITCODE -ne 0) { throw 'Supabase query failed.' }
  } finally { Pop-Location }
  Write-RoxOk 'Supabase connection passed.'
}

function Invoke-SupabaseAction([string]$Selected) {
  switch ($Selected) {
    'Configure' { & (Join-Path $script:RoxRoot 'ROX-CONFIGURE.ps1') -Mode Core }
    'Migrate' {
      if (-not (Test-RoxCommand 'psql')) {
        Write-RoxWarn 'psql is not installed. A combined SQL bundle will be created instead.'
        New-MigrationBundle
        return
      }
      Invoke-RoxProcess -FilePath 'node' -Arguments @((Join-Path $script:RoxBackend 'scripts\migrate.js')) -WorkingDirectory $script:RoxRoot | Out-Null
      Write-RoxOk 'Supabase migrations completed.'
    }
    'Bundle' { New-MigrationBundle }
    'Test' { Test-SupabaseConnection }
  }
}

if ($Action -ne 'Menu') { Invoke-SupabaseAction $Action; exit }
while ($true) {
  Write-Host ''
  Write-Host '1. Configure Supabase values'
  Write-Host '2. Apply pending migrations'
  Write-Host '3. Generate one SQL bundle'
  Write-Host '4. Test Supabase connection'
  Write-Host '0. Back'
  switch (Read-Host 'Choose') {
    '1' { Invoke-SupabaseAction 'Configure' }
    '2' { Invoke-SupabaseAction 'Migrate' }
    '3' { Invoke-SupabaseAction 'Bundle' }
    '4' { Invoke-SupabaseAction 'Test' }
    '0' { break }
  }
}
