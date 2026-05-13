param(
  [string]$Mode = "start"
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RootDir

function Show-Usage {
  @"
usage: ./script/build_and_run.ps1 [mode]

Modes:
  start, run         Start the Expo dev server
  --android, android Start Expo and open Android
  build-android      Build and install the native Android debug app
  --web, web         Start Expo for web
  --dev-client       Start Expo in development-client mode
  --tunnel, tunnel   Start Expo using tunnel transport
  --export-web       Export the web build locally
  --doctor, doctor   Run Expo diagnostics
  --help, help       Show this help
"@
}

function Resolve-ExpoCommand {
  if ($env:EXPO_CLI) {
    return $env:EXPO_CLI -split "\s+"
  }

  if ((Test-Path "pnpm-lock.yaml") -and (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    return @("pnpm", "exec", "expo")
  }
  if ((Test-Path "yarn.lock") -and (Get-Command yarn -ErrorAction SilentlyContinue)) {
    return @("yarn", "expo")
  }
  if (((Test-Path "bun.lock") -or (Test-Path "bun.lockb")) -and (Get-Command bun -ErrorAction SilentlyContinue)) {
    return @("bunx", "expo")
  }

  return @("npx.cmd", "expo")
}

function Invoke-CommandParts {
  param(
    [string[]]$CommandParts,
    [string[]]$ExtraArgs = @()
  )

  $exe = $CommandParts[0]
  $baseArgs = @()
  if ($CommandParts.Count -gt 1) {
    $baseArgs = $CommandParts[1..($CommandParts.Count - 1)]
  }
  & $exe @baseArgs @ExtraArgs
}

function Get-AndroidBuildWorkspace {
  $resolvedRoot = (Resolve-Path $RootDir).ProviderPath
  if ($env:OS -ne "Windows_NT") {
    return $resolvedRoot
  }

  $linkPath = "C:\fw"
  if (Test-Path -LiteralPath $linkPath) {
    $existingLink = Get-Item -LiteralPath $linkPath -Force
    if ($existingLink.LinkType -eq "Junction" -and $existingLink.Target -eq $resolvedRoot) {
      return $linkPath
    }

    Write-Warning "C:\fw already exists and does not point to this repo; using the original path."
    return $resolvedRoot
  }

  New-Item -ItemType Junction -Path $linkPath -Target $resolvedRoot | Out-Null
  return $linkPath
}

function Invoke-AndroidDebugBuild {
  $workspace = Get-AndroidBuildWorkspace
  Push-Location $workspace
  try {
    $localExpo = Resolve-ExpoCommand
    Invoke-CommandParts $localExpo @("run:android", "--no-bundler")
  }
  finally {
    Pop-Location
  }
}

$expo = Resolve-ExpoCommand

switch ($Mode) {
  { $_ -in @("start", "run") } {
    Invoke-CommandParts $expo @("start")
    break
  }
  { $_ -in @("--android", "android") } {
    Invoke-CommandParts $expo @("start", "--android")
    break
  }
  { $_ -in @("--build-android", "build-android") } {
    Invoke-AndroidDebugBuild
    break
  }
  { $_ -in @("--web", "web") } {
    Invoke-CommandParts $expo @("start", "--web")
    break
  }
  { $_ -in @("--dev-client", "dev-client") } {
    Invoke-CommandParts $expo @("start", "--dev-client")
    break
  }
  { $_ -in @("--tunnel", "tunnel") } {
    Invoke-CommandParts $expo @("start", "--tunnel")
    break
  }
  { $_ -in @("--export-web", "export-web") } {
    Invoke-CommandParts $expo @("export", "--platform", "web")
    break
  }
  { $_ -in @("--doctor", "doctor") } {
    Invoke-CommandParts @("npx.cmd", "expo-doctor")
    break
  }
  { $_ -in @("--help", "help") } {
    Show-Usage
    break
  }
  default {
    Show-Usage
    exit 2
  }
}
