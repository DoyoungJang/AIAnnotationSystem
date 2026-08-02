[CmdletBinding()]
param(
    # SonoLabel Windows settings. Edit these defaults or pass named parameters.
    [string]$ApiHost = "127.0.0.1",
    [string]$ApiProxyHost = "127.0.0.1",
    [ValidateRange(1, 65535)][int]$ApiPort = 8000,
    [string]$WebHost = "0.0.0.0",
    [ValidateRange(1, 65535)][int]$WebPort = 5173,
    [ValidateSet("Fail", "NextAvailable")][string]$PortConflictMode = "NextAvailable",
    [ValidateSet("Auto", "Always", "Never")][string]$InstallMode = "Auto",
    [string]$SecretKey = "change-this-local-development-secret-key",
    [string]$AdminUsername = "admin",
    [string]$AdminPassword = "ChangeThisBeforeUse123!"
)

$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$VenvDir = Join-Path $RootDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvMarker = Join-Path $VenvDir ".sonolabel-ready"

function Assert-NativeSuccess {
    param([string]$Operation)
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python 3.11 or newer is required and was not found in PATH."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm is required and was not found in PATH."
}

$PythonReady = (Test-Path -LiteralPath $VenvPython) -and (Test-Path -LiteralPath $VenvMarker)
$InstallPython = $InstallMode -eq "Always" -or ($InstallMode -eq "Auto" -and -not $PythonReady)
$InstallFrontend = $InstallMode -eq "Always" -or ($InstallMode -eq "Auto" -and -not (Test-Path -LiteralPath (Join-Path $FrontendDir "node_modules")))

if ($InstallPython) {
    Write-Host "[setup] Creating Python environment and installing backend dependencies..."
    & python -m venv $VenvDir
    Assert-NativeSuccess "Creating the Python virtual environment"
    & $VenvPython -m pip install --upgrade pip
    Assert-NativeSuccess "Upgrading pip"
    & $VenvPython -m pip install -e $BackendDir
    Assert-NativeSuccess "Installing backend dependencies"
    New-Item -ItemType File -Path $VenvMarker -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $VenvPython) -or -not (Test-Path -LiteralPath $VenvMarker)) {
    throw "Python environment is missing. Use -InstallMode Auto or Always."
}

if ($InstallFrontend) {
    Write-Host "[setup] Installing frontend dependencies..."
    Push-Location $FrontendDir
    try {
        & npm.cmd ci
        Assert-NativeSuccess "Installing frontend dependencies"
    }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $FrontendDir "node_modules"))) {
    throw "Frontend dependencies are missing. Use -InstallMode Auto or Always."
}

function Test-SonoPortAvailable {
    param([ValidateRange(1, 65535)][int]$Port)
    $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
    try {
        $Listener.Server.ExclusiveAddressUse = $true
        $Listener.Start()
        return $true
    }
    catch [System.Net.Sockets.SocketException] { return $false }
    finally { $Listener.Stop() }
}

function Resolve-SonoPort {
    param(
        [ValidateRange(1, 65535)][int]$PreferredPort,
        [string]$ServiceName,
        [int[]]$ExcludedPorts = @()
    )
    if ((Test-SonoPortAvailable $PreferredPort) -and $PreferredPort -notin $ExcludedPorts) {
        return $PreferredPort
    }
    if ($PortConflictMode -eq "Fail") {
        throw "$ServiceName port $PreferredPort is already in use. Change the port or use -PortConflictMode NextAvailable."
    }
    for ($Candidate = $PreferredPort + 1; $Candidate -le 65535; $Candidate++) {
        if ($Candidate -notin $ExcludedPorts -and (Test-SonoPortAvailable $Candidate)) {
            Write-Host "[port] $ServiceName port $PreferredPort is unavailable; using $Candidate instead."
            return $Candidate
        }
    }
    throw "No available port was found for $ServiceName after $PreferredPort."
}

$ApiPort = Resolve-SonoPort -PreferredPort $ApiPort -ServiceName "API"
$WebPort = Resolve-SonoPort -PreferredPort $WebPort -ServiceName "Web" -ExcludedPorts @($ApiPort)

$NormalizedRoot = $RootDir.Replace("\", "/")
$env:APP_ENV = "development"
$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "sqlite:///$NormalizedRoot/backend/sonolabel.db" }
$env:SECRET_KEY = $SecretKey
$env:STORAGE_ROOT = if ($env:STORAGE_ROOT) { $env:STORAGE_ROOT } else { Join-Path $RootDir "storage" }
$env:EXPORT_ROOT = if ($env:EXPORT_ROOT) { $env:EXPORT_ROOT } else { Join-Path $RootDir "exports" }
$env:ADMIN_USERNAME = $AdminUsername
$env:ADMIN_PASSWORD = $AdminPassword
$env:CORS_ORIGINS = "http://localhost:$WebPort,http://127.0.0.1:$WebPort"
$env:SONOLABEL_API_TARGET = "http://${ApiProxyHost}:$ApiPort"

Write-Host "[setup] Applying database migrations..."
Push-Location $BackendDir
try {
    & $VenvPython -m alembic -c alembic.ini upgrade head
    Assert-NativeSuccess "Applying database migrations"
}
finally { Pop-Location }

function Start-SonoProcess {
    param([string]$FileName, [string]$Arguments, [string]$WorkingDirectory)
    $Info = [System.Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $FileName
    $Info.Arguments = $Arguments
    $Info.WorkingDirectory = $WorkingDirectory
    $Info.UseShellExecute = $false
    $Process = [System.Diagnostics.Process]::new()
    $Process.StartInfo = $Info
    if (-not $Process.Start()) { throw "Failed to start $FileName" }
    return $Process
}

function Stop-SonoProcessTree {
    param([System.Diagnostics.Process]$Process)
    if ($null -eq $Process -or $Process.HasExited) { return }
    & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
    if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
}

$ApiProcess = $null
$WebProcess = $null
try {
    Write-Host "[start] API: http://localhost:$ApiPort/docs"
    Write-Host "[start] Web: http://localhost:$WebPort"
    Write-Host "[start] Press Ctrl+C to stop both servers."
    $ApiProcess = Start-SonoProcess $VenvPython "-m uvicorn app.main:app --host $ApiHost --port $ApiPort" $BackendDir
    $NodePath = (Get-Command node.exe).Source
    $VitePath = Join-Path $FrontendDir "node_modules\vite\bin\vite.js"
    $ViteArguments = '"' + $VitePath + '" --host ' + $WebHost + ' --port ' + $WebPort + ' --strictPort'
    $WebProcess = Start-SonoProcess $NodePath $ViteArguments $FrontendDir
    while (-not $ApiProcess.HasExited -and -not $WebProcess.HasExited) { Start-Sleep -Seconds 1 }
    throw "One of the servers stopped unexpectedly."
}
finally {
    Write-Host "`n[stop] Stopping SonoLabel servers..."
    Stop-SonoProcessTree $WebProcess
    Stop-SonoProcessTree $ApiProcess
}
