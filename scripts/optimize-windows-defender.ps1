# Optimize Windows Defender exclusions for AeroStaff Pro developer environment
# Requires Administrator privileges to apply.

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warning "Questo script richiede privilegi di Amministratore."
    Write-Host "Per favore, copia ed esegui questo comando in una finestra di PowerShell avviata COME AMMINISTRATORE:`n" -ForegroundColor Yellow
    
    $cmd = 'Add-MpPreference -ExclusionPath "C:\gha", "C:\Users\turni\Documents\Progetti Antigravity\FlightWorkApp-flight-fix", "C:\Users\turni\Documents\Progetti Antigravity\FlightWorkApp", "C:\Users\turni\.gradle", "' + $env:LOCALAPPDATA + '\Android\Sdk"'
    Write-Host "PowerShell Cmd:`n$cmd`n" -ForegroundColor Cyan
    exit 1
}

$exclusions = @(
    "C:\gha",
    "C:\Users\turni\Documents\Progetti Antigravity\FlightWorkApp-flight-fix",
    "C:\Users\turni\Documents\Progetti Antigravity\FlightWorkApp",
    "C:\Users\turni\.gradle",
    "$env:LOCALAPPDATA\Android\Sdk"
)

Write-Host "--- Ottimizzazione Windows Defender per AeroStaff Pro ---" -ForegroundColor Cyan
foreach ($path in $exclusions) {
    if (Test-Path $path) {
        Write-Host "Aggiunta esclusione per: $path..." -NoNewline
        Add-MpPreference -ExclusionPath $path -ErrorAction SilentlyContinue
        Write-Host " OK!" -ForegroundColor Green
    } else {
        Write-Host "Directory non trovata (saltata): $path" -ForegroundColor Yellow
    }
}

Write-Host "`nOttimizzazione completata con successo! Le build locali saranno molto più veloci." -ForegroundColor Green
