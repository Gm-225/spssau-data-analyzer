[CmdletBinding()]
param(
    [string]$PythonPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$buildRoot = Join-Path $projectRoot "build"
$runtimeRoot = Join-Path $buildRoot "science-runtime"
$runtimeDir = Join-Path $runtimeRoot "questionnaire-engine"
$pyinstallerRoot = Join-Path $buildRoot "pyinstaller"
$legalRoot = Join-Path $buildRoot "legal"
$amosBuildScript = Join-Path $projectRoot "scripts\build-amos-bridge.ps1"

function Reset-ProjectDirectory {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $resolved = [System.IO.Path]::GetFullPath($LiteralPath)
    $expectedPrefix = $projectRoot.TrimEnd("\") + "\build\"
    if (-not $resolved.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to reset a directory outside the project build root: $resolved"
    }
    if (Test-Path -LiteralPath $resolved) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    New-Item -ItemType Directory -Path $resolved -Force | Out-Null
}

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $PythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"
}
$PythonPath = [System.IO.Path]::GetFullPath($PythonPath)
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
    throw "Build Python is missing: $PythonPath"
}

& powershell -NoProfile -ExecutionPolicy Bypass -File $amosBuildScript
if ($LASTEXITCODE -ne 0) { throw "Building Amos Bridge failed with exit code $LASTEXITCODE" }

Reset-ProjectDirectory -LiteralPath $runtimeRoot
Reset-ProjectDirectory -LiteralPath $pyinstallerRoot
Reset-ProjectDirectory -LiteralPath $legalRoot

$buildRequirements = Join-Path $projectRoot "services\runtime-build-requirements.txt"
& $PythonPath -m pip install --disable-pip-version-check -r $buildRequirements
if ($LASTEXITCODE -ne 0) { throw "Installing runtime build requirements failed with exit code $LASTEXITCODE" }

$pipeline = Join-Path $projectRoot "services\questionnaire_pipeline.py"
$workPath = Join-Path $pyinstallerRoot "work"
$specPath = Join-Path $pyinstallerRoot "spec"

$pyinstallerArgs = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--console",
    "--noupx",
    "--name", "questionnaire-engine",
    "--distpath", $runtimeRoot,
    "--workpath", $workPath,
    "--specpath", $specPath,
    "--hidden-import", "openpyxl",
    "--exclude-module", "statsmodels",
    "--exclude-module", "patsy",
    "--exclude-module", "pypdfium2",
    "--exclude-module", "tkinter",
    "--exclude-module", "PyQt5",
    "--exclude-module", "PyQt6",
    "--exclude-module", "PySide2",
    "--exclude-module", "PySide6",
    $pipeline
)
& $PythonPath @pyinstallerArgs
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }

$entrypoint = Join-Path $runtimeDir "questionnaire-engine.exe"
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
    throw "Frozen runtime entrypoint was not created: $entrypoint"
}

$manifestScript = Join-Path $projectRoot "scripts\build_runtime_manifest.py"
$manifestPath = Join-Path $runtimeRoot "runtime-manifest.json"
& $PythonPath $manifestScript `
    --project-root $projectRoot `
    --runtime-dir $runtimeDir `
    --manifest $manifestPath `
    --legal-dir $legalRoot
if ($LASTEXITCODE -ne 0) { throw "Runtime manifest generation failed with exit code $LASTEXITCODE" }

$runtimeBytes = (Get-ChildItem -LiteralPath $runtimeDir -File -Recurse | Measure-Object -Property Length -Sum).Sum
$runtimeFiles = (Get-ChildItem -LiteralPath $runtimeDir -File -Recurse | Measure-Object).Count
[ordered]@{
    runtime = $runtimeDir
    entrypoint = $entrypoint
    manifest = $manifestPath
    legal = $legalRoot
    files = $runtimeFiles
    bytes = $runtimeBytes
} | ConvertTo-Json -Compress
