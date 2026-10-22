# Boot the packaged application against a disposable profile and vault.
param([string]$Executable)
$ErrorActionPreference = 'Stop'
$version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
if (!$Executable) { $Executable = "desktop-dist/PentaMark-Desktop-$version-Windows.exe" }
$exe = (Resolve-Path -LiteralPath $Executable).Path
$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$fixtureId = [guid]::NewGuid().ToString('N')
$data = Join-Path $temporaryRoot "pentamark-smoke-$fixtureId"
$profile = Join-Path $data 'profile'
$vault = Join-Path $data 'vault'
New-Item -ItemType Directory -Path $profile,$vault -Force | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
try { $listener.Start(); $port = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
$baseUrl = "http://127.0.0.1:$port"
$fixtureName = "Windows smoke $fixtureId"
$markerName = "fixture-$fixtureId.md"
[IO.File]::WriteAllText((Join-Path $vault $markerName),$fixtureId)
@{vaultName=$fixtureName;port=$port;bind='127.0.0.1';openBrowser=$false;aiBridgeEnabled=$false;cleanupUnusedAssets=$false} | ConvertTo-Json | Set-Content (Join-Path $data 'pentamark.config.json') -Encoding utf8NoBOM
@{vaultPath=$vault} | ConvertTo-Json | Set-Content (Join-Path $profile 'pentamark.desktop.json') -Encoding utf8NoBOM
$environmentNames = @('PENTAMARK_DATA_DIR','PENTAMARK_USER_DATA_DIR','PENTAMARK_VAULT_DIR','PENTAMARK_NO_BROWSER','ELECTRON_RUN_AS_NODE','PORTABLE_EXECUTABLE_DIR','PORTABLE_EXECUTABLE_FILE')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
$app = $null
try {
    # Current .NET preserves a null assignment as an empty environment variable.
    # Electron treats presence of ELECTRON_RUN_AS_NODE differently from absence:
    # an empty value can abort its native snapshot bootstrap before main.cjs.
    foreach ($name in $environmentNames) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
    $env:PENTAMARK_DATA_DIR = $data
    $env:PENTAMARK_USER_DATA_DIR = $profile
    $env:PENTAMARK_VAULT_DIR = $vault
    $env:PENTAMARK_NO_BROWSER = '1'
    Write-Host "Isolated smoke fixture: $data"
    $app = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'stdout.log') -RedirectStandardError (Join-Path $data 'stderr.log')
    $deadline = (Get-Date).AddSeconds(60)
    $state = $null
    while ((Get-Date) -lt $deadline) {
        try {
            $state = Invoke-RestMethod -Uri "$baseUrl/api/state" -TimeoutSec 2
            if ($state.app -eq 'PentaMark' -and $state.vaultName -eq $fixtureName) { break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if ($null -eq $state -or $state.app -ne 'PentaMark' -or $state.vaultName -ne $fixtureName) { throw 'The packaged application did not start its own fixture host.' }
    # Prove the selected vault is the fixture BEFORE sending any mutation.
    # Older binaries ignoring profile isolation fail safely here.
    $marker = Invoke-RestMethod -Uri "$baseUrl/api/note?path=$markerName" -TimeoutSec 5
    if ($marker.content -cne $fixtureId) { throw 'Selected vault is not the disposable fixture; no write performed.' }
    $ui = Invoke-WebRequest -Uri "$baseUrl/" -TimeoutSec 5
    if ($ui.StatusCode -ne 200 -or $ui.Content -notmatch 'assets/') { throw 'Packaged frontend unavailable.' }
    $note = @{path='Windows-smoke.md';content='# Packaged application verification'} | ConvertTo-Json
    Invoke-RestMethod -Uri "$baseUrl/api/note" -Method Post -Body $note -ContentType 'application/json' | Out-Null
    $saved = Invoke-RestMethod -Uri "$baseUrl/api/note?path=Windows-smoke.md"
    if ($saved.content -ne '# Packaged application verification') { throw 'Fixture note did not round-trip.' }
    Write-Host ("PentaMark {0}: isolated profile/vault, bundled UI and fixture note round-trip verified. Fixture: {1}" -f $version,$data)
} catch {
    Write-Host "Smoke failure evidence (fixture only): $data"
    if ($app) { $app.Refresh(); Write-Host "Launcher PID=$($app.Id) exited=$($app.HasExited)" }
    foreach ($logName in @('stdout.log','stderr.log')) {
        $logPath = Join-Path $data $logName
        if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 80 }
    }
    throw
} finally {
    if ($app -and !$app.HasExited) { Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', [string]$app.Id, '/T', '/F') -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue }
    foreach ($name in $environmentNames) {
        if ($null -eq $previousEnvironment[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
        else { [Environment]::SetEnvironmentVariable($name,$previousEnvironment[$name],'Process') }
    }
}
