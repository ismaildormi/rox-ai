param([switch]$Commit,[switch]$Push)
. (Join-Path $PSScriptRoot 'scripts\windows\ROX.Common.ps1')
Write-RoxHeader 'Prepare staging branch'
if ((Get-RoxActiveProfile) -ne 'staging') { throw 'Activate and configure the staging profile first.' }
$git = Get-RoxGitInfo
if (-not $git.IsRepository) { throw 'This folder is not the existing Git repository. Use ROX-BRIDGE first.' }
& (Join-Path $script:RoxRoot 'ROX-TEST.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Full validation failed; staging branch was not prepared.' }
$branch = 'staging/rox-v0.64'
Push-Location $script:RoxRoot
try {
  & git show-ref --verify --quiet "refs/heads/$branch"
  if ($LASTEXITCODE -eq 0) { & git switch $branch } else { & git switch -c $branch }
  if ($LASTEXITCODE -ne 0) { throw 'Could not create/switch staging branch.' }
  Write-RoxOk "Active branch: $branch"
  & git status --short
  if ($Commit -or (Confirm-RoxAction 'Stage and commit the validated v0.64 changes on this staging branch?' -DefaultNo:$true)) {
    & git add --all
    & git commit -m 'Add ROX v0.64 Safe Bridge and staging gates'
    if ($LASTEXITCODE -ne 0) { throw 'Git commit failed.' }
    if ($Push -or (Confirm-RoxAction 'Push this staging branch to origin? This does not touch main.' -DefaultNo:$true)) {
      & git push -u origin $branch
      if ($LASTEXITCODE -ne 0) { throw 'Git push failed.' }
      Write-RoxOk 'Staging branch pushed. Production/main was not changed.'
    }
  }
} finally { Pop-Location }
