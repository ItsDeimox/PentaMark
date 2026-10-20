# Boot the packaged application against a disposable fixture, never a personal vault.
$ErrorActionPreference = 'Stop'
$version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
$exe = (Resolve-Path "desktop-dist/PentaMark-Desktop-$version-Windows.exe").Path
$data = Join-Path $env:RUNNER_TEMP ('pentamark-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $data | Out-Null
@{vaultName='Windows smoke fixture';port=3417;bind='127.0.0.1';openBrowser=$false;aiBridgeEnabled=$false} | ConvertTo-Json | Set-Content (Join-Path $data 'pentamark.config.json') -Encoding utf8NoBOM
$env:PENTAMARK_DATA_DIR = $data
$env:PENTAMARK_NO_BROWSER = '1'
$app = $null
try {
    $app = Start-Process -FilePath $exe -PassThru
    $deadline = (Get-Date).AddSeconds(60)
    $state = $null
    while ((Get-Date) -lt $deadline) {
        try {
            $state = Invoke-RestMethod -Uri 'http://127.0.0.1:3417/api/state' -TimeoutSec 2
            if ($state.app -eq 'PentaMark' -and $state.vaultName -eq 'Windows smoke fixture') { break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if ($null -eq $state -or $state.app -ne 'PentaMark' -or $state.vaultName -ne 'Windows smoke fixture') { throw 'The packaged application did not start its own fixture host.' }
    $ui = Invoke-WebRequest -Uri 'http://127.0.0.1:3417/' -TimeoutSec 5
    if ($ui.StatusCode -ne 200 -or $ui.Content -notmatch 'assets/') { throw 'Packaged frontend unavailable.' }
    $note = @{path='Windows-smoke.md';content='# Packaged application verification'} | ConvertTo-Json
    Invoke-RestMethod -Uri 'http://127.0.0.1:3417/api/note' -Method Post -Body $note -ContentType 'application/json' | Out-Null
    $saved = Invoke-RestMethod -Uri 'http://127.0.0.1:3417/api/note?path=Windows-smoke.md'
    if ($saved.content -ne '# Packaged application verification') { throw 'Fixture note did not round-trip.' }
    Write-Host ("PentaMark {0}: portable Windows launch, bundled UI and fixture note round-trip verified." -f $version)
} finally {
    if ($app) { Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', [string]$app.Id, '/T', '/F') -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue }
    Remove-Item Env:PENTAMARK_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:PENTAMARK_NO_BROWSER -ErrorAction SilentlyContinue
}
