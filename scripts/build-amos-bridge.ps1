[CmdletBinding()]
param(
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectRoot "build\amos-bridge"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$source = Join-Path $projectRoot "services\amos_bridge\Program.cs"
$compilerCandidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $compiler) {
    throw "The .NET Framework C# compiler is missing. Install/enable .NET Framework 4.x."
}
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Bridge source is missing: $source"
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = Join-Path $OutputDirectory "amos-bridge.exe"
$arguments = @(
    "/nologo",
    "/target:exe",
    "/platform:x64",
    "/optimize+",
    "/debug-",
    "/utf8output",
    "/reference:System.dll",
    "/reference:System.Core.dll",
    "/reference:System.Xml.dll",
    "/reference:System.Web.Extensions.dll",
    "/reference:Microsoft.CSharp.dll",
    "/out:$output",
    $source
)
& $compiler @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Building Amos Bridge failed with exit code $LASTEXITCODE"
}
if (-not (Test-Path -LiteralPath $output -PathType Leaf)) {
    throw "Amos Bridge output was not created: $output"
}
[ordered]@{
    bridge = $output
    sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
    bytes = (Get-Item -LiteralPath $output).Length
    ibmBinariesBundled = $false
} | ConvertTo-Json -Compress
