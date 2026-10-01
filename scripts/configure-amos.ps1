[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AmosHome
)

$ErrorActionPreference = "Stop"
$resolved = [System.IO.Path]::GetFullPath($AmosHome)
$engine = Join-Path $resolved "Amos.EngineLib.dll"
if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) {
    throw "The selected folder does not contain Amos.EngineLib.dll: $resolved"
}
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw "LOCALAPPDATA is not available"
}
$configDirectory = Join-Path $env:LOCALAPPDATA "AI-Data-Analyzer"
$configPath = Join-Path $configDirectory "amos-engine.json"
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
$json = [ordered]@{
    schemaVersion = 1
    amosHome = $resolved
} | ConvertTo-Json
[System.IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
[ordered]@{
    configured = $true
    amosHome = $resolved
    configPath = $configPath
    engineSha256 = (Get-FileHash -LiteralPath $engine -Algorithm SHA256).Hash
} | ConvertTo-Json -Compress
