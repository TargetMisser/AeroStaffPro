param(
  [string]$Repo = $(if ($env:AEROSTAFF_GITHUB_REPO) { $env:AEROSTAFF_GITHUB_REPO } else { 'TargetMisser/AeroStaffPro' }),
  [string]$RunnerRoot = 'C:\gha',
  [string]$RunnerName = "aerostaff-$env:COMPUTERNAME",
  [string]$Labels = 'aerostaff',
  [string]$WorkFolder = '_w',
  [switch]$Start,
  [switch]$InstallService,
  [switch]$InstallStartupTask
)

$ErrorActionPreference = 'Stop'

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command in PATH: $Name"
  }
}

function Install-StartupTask {
  param([string]$RunnerRoot)

  $taskName = 'AeroStaffPro GitHub Runner'
  $launcher = Join-Path $PSScriptRoot 'start-local-runner.ps1'
  if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Missing startup launcher: $launcher"
  }

  $powershell = (Get-Command powershell.exe).Source
  $argument = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -RunnerRoot `"$RunnerRoot`""
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

  $action = New-ScheduledTaskAction -Execute $powershell -Argument $argument -WorkingDirectory $PSScriptRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "Installed startup task '$taskName' for $currentUser."
}

Require-Command gh
Require-Command git

if ($InstallService -and $InstallStartupTask) {
  throw 'Use either -InstallService or -InstallStartupTask, not both.'
}

Write-Host "Configuring AeroStaff Pro self-hosted runner for $Repo"

$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI is not authenticated. Run: gh auth login"
}

New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null

$configCmd = Join-Path $RunnerRoot 'config.cmd'
if (-not (Test-Path -LiteralPath $configCmd)) {
  Write-Host "Downloading latest GitHub Actions runner..."
  $release = gh api repos/actions/runner/releases/latest | ConvertFrom-Json
  $asset = $release.assets |
    Where-Object { $_.name -match '^actions-runner-win-x64-.*\.zip$' } |
    Select-Object -First 1

  if (-not $asset) {
    throw 'Could not find latest Windows x64 GitHub Actions runner asset.'
  }

  $zipPath = Join-Path $RunnerRoot $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
  Expand-Archive -LiteralPath $zipPath -DestinationPath $RunnerRoot -Force
  Remove-Item -LiteralPath $zipPath -Force
}

$token = gh api --method POST "repos/$Repo/actions/runners/registration-token" --jq .token
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'Could not obtain GitHub Actions runner registration token.'
}

$repoUrl = "https://github.com/$Repo"
Push-Location $RunnerRoot
try {
  & .\config.cmd --unattended --url $repoUrl --token $token --name $RunnerName --labels $Labels --work $WorkFolder --replace
  if ($LASTEXITCODE -ne 0) {
    throw "config.cmd failed with exit code $LASTEXITCODE"
  }

  if ($InstallService) {
    Write-Host "Installing runner service..."
    & .\svc.cmd install
    if ($LASTEXITCODE -ne 0) {
      throw "svc.cmd install failed with exit code $LASTEXITCODE. Rerun PowerShell as Administrator or use -Start."
    }
    & .\svc.cmd start
    if ($LASTEXITCODE -ne 0) {
      throw "svc.cmd start failed with exit code $LASTEXITCODE"
    }
  } elseif ($Start) {
    Write-Host "Starting runner in a hidden window..."
    & (Join-Path $PSScriptRoot 'start-local-runner.ps1') -RunnerRoot $RunnerRoot
  }

  if ($InstallStartupTask) {
    Install-StartupTask -RunnerRoot $RunnerRoot
  }
} finally {
  Pop-Location
}

Write-Host "Runner configured."
Write-Host "Required workflow labels: self-hosted, Windows, X64, aerostaff"
if (-not $Start -and -not $InstallService -and -not $InstallStartupTask) {
  Write-Host "Start manually with: $RunnerRoot\run.cmd"
}
