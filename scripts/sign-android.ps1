param(
    [Parameter(Mandatory=$true)][string]$UnsignedApk,
    [Parameter(Mandatory=$true)][string]$ApkSignerJar,
    [Parameter(Mandatory=$true)][string]$OutputApk,
    [Parameter(Mandatory=$true)][string]$KeyDirectory,
    [string]$JdkDirectory = 'C:/Program Files/Java/jdk-22'
)
$ErrorActionPreference = 'Stop'
$inputApk = (Resolve-Path -LiteralPath $UnsignedApk).Path
$signerJar = (Resolve-Path -LiteralPath $ApkSignerJar).Path
$javaTool = Join-Path $JdkDirectory 'bin/java.exe'
$keyTool = Join-Path $JdkDirectory 'bin/keytool.exe'
if (!(Test-Path -LiteralPath $javaTool) -or !(Test-Path -LiteralPath $keyTool)) { throw 'JDK não encontrado.' }
if (Test-Path -LiteralPath $OutputApk) { throw 'O APK de saída já existe; escolha outro caminho.' }
[void](New-Item -ItemType Directory -Path $KeyDirectory -Force)
$keyRoot = (Resolve-Path -LiteralPath $KeyDirectory).Path
$keyFile = Join-Path $keyRoot 'pentamark-release.p12'
$passwordFile = Join-Path $keyRoot 'password.dpapi.xml'
if ((Test-Path -LiteralPath $keyFile) -ne (Test-Path -LiteralPath $passwordFile)) { throw 'Chave incompleta. Preserve os arquivos existentes e restaure o par original.' }
try {
    if (!(Test-Path -LiteralPath $keyFile)) {
        $randomBytes = [byte[]]::new(32)
        [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
        $env:PENTAMARK_SIGN_PASSWORD = [Convert]::ToBase64String($randomBytes)
        $credential = [PSCredential]::new('pentamark', (ConvertTo-SecureString $env:PENTAMARK_SIGN_PASSWORD -AsPlainText -Force))
        # DPAPI encrypts the credential for this Windows account. Never upload it.
        $credential | Export-Clixml -LiteralPath $passwordFile
        & $keyTool -genkeypair -noprompt -keystore $keyFile -storetype PKCS12 -storepass:env PENTAMARK_SIGN_PASSWORD -keypass:env PENTAMARK_SIGN_PASSWORD -alias pentamark -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 -dname 'CN=PentaMark Android, OU=Local Release, O=Pentagory'
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar a chave. Não descarte os arquivos sem verificar.' }
    } else {
        $credential = Import-Clixml -LiteralPath $passwordFile
        $env:PENTAMARK_SIGN_PASSWORD = $credential.GetNetworkCredential().Password
    }
    & $javaTool -jar $signerJar sign --ks $keyFile --ks-key-alias pentamark --ks-pass env:PENTAMARK_SIGN_PASSWORD --key-pass env:PENTAMARK_SIGN_PASSWORD --out $OutputApk $inputApk
    if ($LASTEXITCODE -ne 0) { throw 'A assinatura do APK falhou.' }
    & $javaTool -jar $signerJar verify --verbose --print-certs $OutputApk
    if ($LASTEXITCODE -ne 0) { throw 'A verificação da assinatura falhou. Não publique este APK.' }
    Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256
} finally {
    Remove-Item Env:PENTAMARK_SIGN_PASSWORD -ErrorAction SilentlyContinue
}
