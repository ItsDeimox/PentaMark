# Runs from its own temporary directory, never from the NSIS extraction directory.
# All variable input arrives as base64 JSON in the environment, never as PS code.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$logFile = $null
$workerInfo = $null
$workerResult = 'error'
$updateExitCode = 1

function Write-UpdateLog([string] $Message) {
    if ($script:logFile) {
        try { [IO.File]::AppendAllText($script:logFile, ([DateTime]::UtcNow.ToString('o') + ' ' + $Message + [Environment]::NewLine)) }
        catch { } # A full/unavailable log volume must not prevent rollback.
    }
}

function Assert-LocalPath([string] $Path) {
    if ($Path -notmatch '^[a-zA-Z]:\\' -or $Path.Substring(2).Contains(':') -or $Path -match '[\x00-\x1f<>"|?*]') {
        throw 'Caminho local invalido.'
    }
    if ($Path.Length -eq 3) { return } # A data directory can be a drive root.
    foreach ($part in $Path.Substring(3).Split('\')) {
        if (!$part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$') { throw 'Caminho ambiguo.' }
    }
    if ([IO.Path]::GetFullPath($Path) -ine $Path) { throw 'Caminho nao canonico.' }
}

function Assert-NoReparse([string] $Path) {
    $cursor = $Path
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Links e juncoes nao sao permitidos.' }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Get-UpdateHash([string] $Path) {
    # .NET hashing also works when a parent PowerShell 7 environment changes
    # PSModulePath and Windows PowerShell cannot auto-load Get-FileHash.
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Assert-Payload([string] $Path, [long] $Size, [string] $Hash) {
    Assert-NoReparse $Path
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or $item.Length -ne $Size) { throw 'Tamanho do executavel invalido.' }
    if ((Get-UpdateHash $Path) -ine $Hash) { throw 'SHA-256 do executavel invalido.' }
}

function Start-Portable([string] $Path, [string] $DataDirectory) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Path
    $info.WorkingDirectory = [IO.Path]::GetDirectoryName($Path)
    $info.UseShellExecute = $false
    $info.EnvironmentVariables['PENTAMARK_DATA_DIR'] = $DataDirectory
    foreach ($key in @($info.EnvironmentVariables.Keys)) {
        if ($key -match '^(ELECTRON_RUN_AS_NODE|ELECTRON_NO_ASAR|PENTAMARK_UPDATER_.*)$') { $info.EnvironmentVariables.Remove($key) }
    }
    # NSIS resets PORTABLE_EXECUTABLE_* for the new extraction. Inherited vault,
    # profile, language and other environment settings otherwise stay intact.
    $launched = [Diagnostics.Process]::Start($info)
    if (!$launched) { throw 'Nao foi possivel iniciar o portatil.' }
    try {
        if ($launched.WaitForExit(2000) -and $launched.ExitCode -ne 0) { throw ('O portatil encerrou com codigo ' + $launched.ExitCode) }
    } finally { $launched.Dispose() }
}

function Invoke-PortableSwap([string] $Original, [string] $Payload, [long] $Size, [string] $Hash,
    [string] $Token, [string] $DataDirectory, [string] $Cancel) {
    Assert-LocalPath $Original
    Assert-NoReparse $Original
    Assert-Payload $Payload $Size $Hash
    if ($Token -notmatch '^[a-f0-9]{32}$') { throw 'Token invalido.' }
    $prefix = [IO.Path]::Combine([IO.Path]::GetDirectoryName($Original), '.pentamark-update-' + $Token)
    $incoming = $prefix + '.new'
    $backup = $prefix + '.bak'
    if ([IO.File]::Exists($incoming) -or [IO.File]::Exists($backup) -or
        [IO.Directory]::Exists($incoming) -or [IO.Directory]::Exists($backup)) { throw 'Arquivos de recuperacao ja existem.' }
    $swapped = $false
    $ownsIncoming = $false
    try {
        if ([IO.File]::Exists($Cancel)) { throw 'Atualizacao cancelada.' }
        [IO.File]::Copy($Payload, $incoming, $false)
        $ownsIncoming = $true
        Assert-Payload $incoming $Size $Hash
        $until = [DateTime]::UtcNow.AddSeconds(60)
        while (!$swapped) {
            if ([IO.File]::Exists($Cancel)) { throw 'Atualizacao cancelada.' }
            try {
                Assert-NoReparse $Original
                [IO.File]::Replace($incoming, $Original, $backup, $true)
                $swapped = $true
            } catch [IO.IOException] {
                if ([DateTime]::UtcNow -ge $until) { throw }
                Start-Sleep -Milliseconds 250
            }
        }
        Write-UpdateLog ('Executavel substituido; backup: ' + $backup)
        Assert-Payload $Original $Size $Hash
        Start-Portable $Original $DataDirectory
        Write-UpdateLog 'Nova versao iniciada no caminho original. Backup mantido para recuperacao.'
    } catch {
        $failure = $_
        if ($swapped) {
            Write-UpdateLog ('Falha ao iniciar; restaurando original: ' + $failure.Exception.Message)
            Assert-NoReparse $backup
            Assert-NoReparse $Original
            [IO.File]::Copy($backup, $incoming, $false)
            [IO.File]::Replace($incoming, $Original, [System.Management.Automation.Language.NullString]::Value, $true)
            Write-UpdateLog 'Original restaurado.'
        }
        # Even a failed copy/replace should reopen the intact original. Never
        # attempt to launch a payload directly or interpret a path as a command.
        if (![IO.File]::Exists($Cancel)) { Start-Portable $Original $DataDirectory }
        throw $failure
    } finally {
        if ($ownsIncoming -and [IO.File]::Exists($incoming)) { [IO.File]::Delete($incoming) }
    }
}

try {
    $encoded = [Environment]::GetEnvironmentVariable('PENTAMARK_UPDATER_CONFIG')
    if (!$encoded -or $encoded.Length -gt 32768) { throw 'Configuracao ausente ou muito grande.' }
    $config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
    if ($config.token -notmatch '^[a-f0-9]{32}$' -or $config.sha256 -notmatch '^[a-f0-9]{64}$' -or
        ($config.size -isnot [long] -and $config.size -isnot [int])) { throw 'Configuracao invalida.' }
    if ($config.size -le 0 -or $config.size -gt 536870912 -or $config.pid -le 0 -or $config.parentPid -le 0) { throw 'Limites invalidos.' }
    foreach ($path in @($config.original, $config.execPath, $config.workDir, $config.dataRoot)) { Assert-LocalPath $path }
    if ($config.original -ieq $config.execPath -or [IO.Path]::GetExtension($config.original) -ine '.exe') { throw 'Destino nao e o portatil original.' }
    if ([IO.Path]::GetDirectoryName($PSCommandPath) -ine $config.workDir) { throw 'Pasta do auxiliar invalida.' }
    if ($config.workDir -ieq $config.dataRoot -or $config.workDir.StartsWith($config.dataRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'O auxiliar deve ficar fora da pasta de dados.'
    }
    Assert-NoReparse $config.workDir
    Assert-NoReparse $config.original
    if ((Get-Item -LiteralPath $config.original -Force).PSIsContainer) { throw 'O original deve ser um arquivo.' }
    $script:logFile = [IO.Path]::Combine($config.workDir, 'update.log')
    $payload = [IO.Path]::Combine($config.workDir, 'update.exe')
    $ready = [IO.Path]::Combine($config.workDir, 'ready')
    $go = [IO.Path]::Combine($config.workDir, 'go')
    $cancel = [IO.Path]::Combine($config.workDir, 'cancel')
    Assert-Payload $payload $config.size $config.sha256
    $workerInfo = @{ pid = $PID; token = $config.token; workDir = $config.workDir;
        startedTicks = [Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString() }
    [IO.File]::WriteAllText([IO.Path]::Combine($config.workDir, 'worker.pid'), ($workerInfo | ConvertTo-Json -Compress))

    # Capture a handle while the parent is alive, avoiding a later PID reuse.
    $appProcess = [Diagnostics.Process]::GetProcessById([int] $config.pid)
    if ($appProcess.MainModule.FileName -ine $config.execPath) { throw 'Processo do aplicativo nao corresponde ao executavel.' }
    $null = $appProcess.Handle
    $launcher = $null
    try {
        $candidate = [Diagnostics.Process]::GetProcessById([int] $config.parentPid)
        if ($candidate.MainModule.FileName -ieq $config.original) { $null = $candidate.Handle; $launcher = $candidate }
        else { $candidate.Dispose() }
    } catch { Write-UpdateLog 'Launcher indisponivel; a troca aguardara a liberacao do arquivo.' }

    $directory = [IO.Path]::GetDirectoryName($config.original)
    $prefix = [IO.Path]::Combine($directory, '.pentamark-update-' + $config.token)
    $incoming = $prefix + '.new'
    $backup = $prefix + '.bak'
    if ([IO.File]::Exists($incoming) -or [IO.File]::Exists($backup)) { throw 'Arquivos de recuperacao ja existem.' }
    # Preflight write permissions without touching the existing executable.
    $probe = [IO.File]::Open($incoming, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $probe.Dispose()
    [IO.File]::Delete($incoming)
    Write-UpdateLog 'Auxiliar pronto; aguardando autorizacao e encerramento do aplicativo.'
    [IO.File]::WriteAllText($ready, $config.token)
    $until = [DateTime]::UtcNow.AddSeconds(30)
    while (![IO.File]::Exists($go)) {
        if ([IO.File]::Exists($cancel) -or [DateTime]::UtcNow -ge $until -or $appProcess.HasExited) { throw 'Atualizacao cancelada antes do encerramento.' }
        Start-Sleep -Milliseconds 100
    }
    if ([IO.File]::ReadAllText($go) -cne $config.token -or [IO.File]::Exists($cancel)) { throw 'Autorizacao invalida.' }
    if (!$appProcess.WaitForExit(120000)) { throw 'O aplicativo nao encerrou; o original foi preservado.' }
    $appProcess.Dispose()
    if ($launcher) {
        if (!$launcher.WaitForExit(60000)) { throw 'O launcher portatil nao encerrou; o original foi preservado.' }
        $launcher.Dispose()
    }
    if ([IO.File]::Exists($cancel)) { throw 'Atualizacao cancelada.' }
    # Same-volume sibling + ReplaceFile provides an atomic swap and original backup.
    Invoke-PortableSwap $config.original $payload $config.size $config.sha256 $config.token $config.dataRoot $cancel
    $workerResult = 'success'
    $updateExitCode = 0
} catch {
    Write-UpdateLog ('ERRO: ' + $_.Exception.Message)
    [Console]::Error.WriteLine($_.Exception.Message)
} finally {
    if ($workerInfo) {
        $workerInfo['phase'] = $workerResult
        try { [IO.File]::WriteAllText([IO.Path]::Combine($config.workDir, 'result.json'), ($workerInfo | ConvertTo-Json -Compress)) }
        catch { Write-UpdateLog ('ERRO ao registrar resultado: ' + $_.Exception.Message); $updateExitCode = 1 }
    }
}
exit $updateExitCode
