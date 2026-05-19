param(
  [string]$RunnerRoot = 'C:\gha'
)

$ErrorActionPreference = 'Stop'

$runnerRootFullPath = [System.IO.Path]::GetFullPath($RunnerRoot).TrimEnd('\')
$runCmd = Join-Path $runnerRootFullPath 'run.cmd'

if (-not (Test-Path -LiteralPath $runCmd)) {
  throw "GitHub Actions runner not found at $runCmd. Run: npm run runner:setup"
}

$runnerProcesses = Get-CimInstance Win32_Process -Filter "Name = 'Runner.Listener.exe' OR Name = 'Runner.Worker.exe'" |
  Where-Object {
    $_.ExecutablePath -and
    [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith(
      $runnerRootFullPath,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  }

if ($runnerProcesses) {
  Write-Host "AeroStaff Pro runner is already running from $runnerRootFullPath."
  exit 0
}

Write-Host "Starting AeroStaff Pro runner from $runnerRootFullPath..."
Start-Process -FilePath $runCmd -WorkingDirectory $runnerRootFullPath -WindowStyle Hidden
