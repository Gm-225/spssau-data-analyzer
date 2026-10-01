[CmdletBinding()]
param(
    [string]$EvidenceRoot = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$validationBase = [System.IO.Path]::GetFullPath("D:\Desktop\Codex-Projects\AIAV\T10")
$runStartedUtc = [DateTime]::UtcNow
$runStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$stages = New-Object System.Collections.Generic.List[object]
$sourceMatrix = New-Object System.Collections.Generic.List[object]
$jsonValidation = New-Object System.Collections.Generic.List[object]
$packageArtifacts = $null
$installedMetrics = $null
$installedExecutable = $null
$installedExecutableMetrics = $null
$nsisSummary = $null
$portableSummary = $null
$tamperSummary = $null
$artifactQa = $null
$outputsEvidence = $null
$tamperCleanup = $null
$formalInstallIntegrity = $null
$registrationState = $null
$packageStageStartedUtc = $null
$overallExitCode = 0
$failureMessage = $null
$failureStack = $null
$transcriptStarted = $false
$locationPushed = $false

function Test-IsAsciiPath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    return $LiteralPath -notmatch "[^\x00-\x7F]"
}

function Test-IsStrictChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$Child
    )

    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd("\") + "\"
    $childFull = [System.IO.Path]::GetFullPath($Child)
    return $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathEqual {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )

    $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd("\")
    $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd("\")
    return [string]::Equals($leftFull, $rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-NewEvidencePath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    $resolved = [System.IO.Path]::GetFullPath($LiteralPath)
    if (-not (Test-IsAsciiPath -LiteralPath $resolved)) {
        throw "Evidence root must be a pure ASCII path: $resolved"
    }
    if (-not (Test-IsStrictChildPath -Parent $validationBase -Child $resolved)) {
        throw "Evidence root must be a unique child of ${validationBase}: $resolved"
    }
    if (Test-Path -LiteralPath $resolved) {
        throw "Evidence root already exists; refusing to overwrite it: $resolved"
    }
    return $resolved
}

function Assert-PathIsChild {
    param(
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$Child,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not (Test-IsStrictChildPath -Parent $Parent -Child $Child)) {
        throw "$Label escaped its required root. root=$Parent path=$Child"
    }
}

function New-NativeFailure {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [Parameter(Mandatory = $true)][int]$ExitCode
    )

    $exception = New-Object System.Exception($Message)
    $exception.Data["NativeExitCode"] = $ExitCode
    return $exception
}

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    Write-Host ("[COMMAND] {0} {1}" -f $FilePath, ($Arguments -join " "))
    & $FilePath @Arguments
    $nativeExitCode = $LASTEXITCODE
    if ($nativeExitCode -ne 0) {
        throw (New-NativeFailure -Message "Native command failed with exit code ${nativeExitCode}: $FilePath" -ExitCode $nativeExitCode)
    }
}

function Invoke-RecordedStage {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    $startedUtc = [DateTime]::UtcNow
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $status = "passed"
    $exitCode = 0
    $errorMessage = $null
    Write-Host ""
    Write-Host "[STAGE START] $Name"
    try {
        & $Action
    }
    catch {
        $status = "failed"
        $errorMessage = $_.Exception.Message
        if ($_.Exception.Data.Contains("NativeExitCode")) {
            $exitCode = [int]$_.Exception.Data["NativeExitCode"]
        }
        else {
            $exitCode = 1
        }
        throw
    }
    finally {
        $stopwatch.Stop()
        $record = [ordered]@{
            name = $Name
            status = $status
            command = $Command
            startedAt = $startedUtc.ToString("o")
            endedAt = [DateTime]::UtcNow.ToString("o")
            durationSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
            exitCode = $exitCode
            error = $errorMessage
        }
        $stages.Add([pscustomobject]$record)
        Write-Host "[STAGE END] $Name status=$status exitCode=$exitCode durationSeconds=$($record.durationSeconds)"
    }
}

function Get-DirectoryMetrics {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Container)) {
        throw "Directory is missing: $LiteralPath"
    }
    $files = @(Get-ChildItem -LiteralPath $LiteralPath -File -Recurse)
    $bytes = 0L
    foreach ($file in $files) {
        $bytes += [int64]$file.Length
    }
    return [ordered]@{
        path = [System.IO.Path]::GetFullPath($LiteralPath)
        files = $files.Count
        bytes = $bytes
        mebibytes = [Math]::Round($bytes / 1MB, 3)
    }
}

function Get-FileMetrics {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "File is missing: $LiteralPath"
    }
    $file = Get-Item -LiteralPath $LiteralPath
    $hash = Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256
    return [ordered]@{
        path = $file.FullName
        bytes = [int64]$file.Length
        mebibytes = [Math]::Round($file.Length / 1MB, 3)
        sha256 = $hash.Hash.ToUpperInvariant()
        lastWriteTimeUtc = $file.LastWriteTimeUtc.ToString("o")
    }
}

function Get-PackageArtifacts {
    param([Parameter(Mandatory = $true)][DateTime]$NotBeforeUtc)

    $releaseRoot = Join-Path $projectRoot "release"
    $metadata = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Encoding UTF8 -Raw | ConvertFrom-Json
    $version = [string]$metadata.version
    $setupPath = Join-Path $releaseRoot "AI-Data-Analyzer-${version}-x64-Setup.exe"
    $portablePath = Join-Path $releaseRoot "AI-Data-Analyzer-${version}-x64-Portable.exe"
    $winUnpacked = Join-Path $releaseRoot "win-unpacked"

    foreach ($artifact in @($setupPath, $portablePath)) {
        if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
            throw "Expected package artifact is missing: $artifact"
        }
        $item = Get-Item -LiteralPath $artifact
        if ($item.LastWriteTimeUtc -lt $NotBeforeUtc.AddSeconds(-2)) {
            throw "Package artifact predates this build and may be stale: $artifact"
        }
    }

    return [ordered]@{
        releaseRoot = $releaseRoot
        installer = Get-FileMetrics -LiteralPath $setupPath
        portable = Get-FileMetrics -LiteralPath $portablePath
        winUnpacked = Get-DirectoryMetrics -LiteralPath $winUnpacked
        installFootprintBasis = "NSIS actual installation; win-unpacked is inventoried only and is forbidden as an E2E source"
    }
}

function Resolve-InstalledExecutable {
    param([Parameter(Mandatory = $true)][string]$InstallDirectory)

    if (-not (Test-Path -LiteralPath $InstallDirectory -PathType Container)) {
        throw "NSIS installation directory is missing: $InstallDirectory"
    }
    $metadata = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Encoding UTF8 -Raw | ConvertFrom-Json
    $productName = [string]$metadata.build.productName
    if (-not [string]::IsNullOrWhiteSpace($productName)) {
        $expected = Join-Path $InstallDirectory "${productName}.exe"
        if (Test-Path -LiteralPath $expected -PathType Leaf) {
            return [System.IO.Path]::GetFullPath($expected)
        }
    }
    $candidates = @(Get-ChildItem -LiteralPath $InstallDirectory -File -Filter "*.exe" | Where-Object {
        $_.Name -notmatch "(?i)uninstall|unins"
    } | Sort-Object Length -Descending)
    if ($candidates.Count -ne 1) {
        throw "Could not resolve exactly one installed application EXE in ${InstallDirectory}; candidates=$($candidates.FullName -join ' | ')"
    }
    return $candidates[0].FullName
}

function Write-JsonUtf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)]$Value,
        [int]$Depth = 40
    )

    $json = $Value | ConvertTo-Json -Depth $Depth
    [System.IO.File]::WriteAllText($LiteralPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-JsonStrict {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "Required JSON evidence is missing: $LiteralPath"
    }
    $bytes = [System.IO.File]::ReadAllBytes($LiteralPath)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw "JSON evidence must be UTF-8 without BOM: $LiteralPath"
    }
    $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    try {
        $text = $strictUtf8.GetString($bytes)
    }
    catch {
        throw "JSON evidence is not valid UTF-8: $LiteralPath :: $($_.Exception.Message)"
    }
    try {
        return $text | ConvertFrom-Json
    }
    catch {
        throw "PowerShell ConvertFrom-Json rejected evidence: $LiteralPath :: $($_.Exception.Message)"
    }
}

function Get-ProductUninstallRegistration {
    param([Parameter(Mandatory = $true)][string]$DisplayName)

    $registryRoot = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    $matches = New-Object System.Collections.Generic.List[object]
    foreach ($key in @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue)) {
        $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
        if ($null -ne $properties -and [string]$properties.DisplayName -eq $DisplayName) {
            $matches.Add([pscustomobject][ordered]@{
                keyName = $key.PSChildName
                psPath = $key.PSPath
                nativePath = "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($key.PSChildName)"
                displayName = [string]$properties.DisplayName
                displayVersion = [string]$properties.DisplayVersion
                uninstallString = [string]$properties.UninstallString
                quietUninstallString = [string]$properties.QuietUninstallString
            })
        }
    }
    if ($matches.Count -gt 1) {
        throw "Multiple uninstall registrations match ${DisplayName}; refusing ambiguous mutation"
    }
    if ($matches.Count -eq 0) { return $null }
    return $matches[0]
}

function Suspend-ProductUninstallRegistration {
    param([Parameter(Mandatory = $true)][string]$EvidenceDirectory)

    $metadata = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Encoding UTF8 -Raw | ConvertFrom-Json
    $displayName = "$([string]$metadata.build.productName) $([string]$metadata.version)"
    $existing = Get-ProductUninstallRegistration -DisplayName $displayName
    $exportPath = Join-Path $EvidenceDirectory "preexisting-uninstall-registration.reg"
    $state = [ordered]@{
        displayName = $displayName
        preexistingFound = ($null -ne $existing)
        original = $existing
        exportPath = if ($null -ne $existing) { $exportPath } else { $null }
        suspended = $false
        testRegistrationRemoved = $false
        restored = $false
        restorationVerified = $false
    }
    if ($null -eq $existing) { return $state }

    $regExe = Join-Path ($env:SystemRoot) "System32\reg.exe"
    $null = Invoke-NativeChecked -FilePath $regExe -Arguments @("export", [string]$existing.nativePath, $exportPath, "/y")
    Remove-Item -LiteralPath ([string]$existing.psPath) -Recurse -Force -ErrorAction Stop
    if ($null -ne (Get-ProductUninstallRegistration -DisplayName $displayName)) {
        throw "Could not suspend the preexisting product uninstall registration"
    }
    $state.suspended = $true
    return $state
}

function Restore-ProductUninstallRegistration {
    param([Parameter(Mandatory = $true)]$State)

    $current = Get-ProductUninstallRegistration -DisplayName ([string]$State.displayName)
    if ($null -ne $current) {
        Remove-Item -LiteralPath ([string]$current.psPath) -Recurse -Force -ErrorAction Stop
    }
    $State.testRegistrationRemoved = ($null -eq (Get-ProductUninstallRegistration -DisplayName ([string]$State.displayName)))
    if (-not $State.testRegistrationRemoved) {
        throw "Could not remove the disposable NSIS test registration"
    }

    if ($State.preexistingFound) {
        if (-not (Test-Path -LiteralPath ([string]$State.exportPath) -PathType Leaf)) {
            throw "Preexisting uninstall registration export is missing: $($State.exportPath)"
        }
        $regExe = Join-Path ($env:SystemRoot) "System32\reg.exe"
        $null = Invoke-NativeChecked -FilePath $regExe -Arguments @("import", [string]$State.exportPath)
        $restored = Get-ProductUninstallRegistration -DisplayName ([string]$State.displayName)
        $State.restored = $null -ne $restored
        $State.restorationVerified = (
            $null -ne $restored -and
            [string]$restored.keyName -eq [string]$State.original.keyName -and
            [string]$restored.uninstallString -eq [string]$State.original.uninstallString
        )
    }
    else {
        $State.restored = $true
        $State.restorationVerified = $true
    }
    if (-not $State.restorationVerified) {
        throw "Preexisting uninstall registration was not restored exactly"
    }
    return $State
}

function Assert-JsonParsers {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$NodePath
    )

    $null = Read-JsonStrict -LiteralPath $LiteralPath
    Invoke-NativeChecked -FilePath $NodePath -Arguments @(
        "-e",
        "const fs=require('fs'); JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));",
        $LiteralPath
    )
    $metric = Get-FileMetrics -LiteralPath $LiteralPath
    return [ordered]@{
        path = $metric.path
        bytes = $metric.bytes
        sha256 = $metric.sha256
        utf8NoBom = $true
        powershellConvertFromJson = $true
        nodeJsonParse = $true
    }
}

function Get-NestedValue {
    param(
        [Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string]$PropertyPath
    )

    $current = $InputObject
    foreach ($segment in $PropertyPath.Split(".")) {
        if ($null -eq $current) { return $null }
        $property = $current.PSObject.Properties[$segment]
        if ($null -eq $property) { return $null }
        $current = $property.Value
    }
    return $current
}

function Get-FirstNestedValue {
    param(
        [Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$PropertyPaths
    )

    foreach ($propertyPath in $PropertyPaths) {
        $value = Get-NestedValue -InputObject $InputObject -PropertyPath $propertyPath
        if ($null -ne $value -and -not ([string]::IsNullOrWhiteSpace([string]$value))) {
            return $value
        }
    }
    return $null
}

function Assert-StringValue {
    param(
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not [string]::Equals([string]$Actual, $Expected, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label mismatch. expected=$Expected actual=$Actual"
    }
}

function Assert-Sha256Value {
    param(
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $actualText = ([string]$Actual).ToUpperInvariant()
    if ($actualText -notmatch "^[0-9A-F]{64}$") {
        throw "$Label is not a SHA-256 value: $Actual"
    }
    if ($actualText -ne $Expected.ToUpperInvariant()) {
        throw "$Label mismatch. expected=$Expected actual=$actualText"
    }
}

function Assert-E2eCommon {
    param(
        [Parameter(Mandatory = $true)]$Summary,
        [Parameter(Mandatory = $true)][ValidateSet("nsis", "portable")][string]$ReleaseSource,
        [Parameter(Mandatory = $true)][ValidateSet("nsis", "portable", "tamper")][string]$Profile
    )

    Assert-StringValue -Actual $Summary.status -Expected "passed" -Label "$Profile E2E status"
    $actualSource = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("releaseSource", "source.releaseSource", "source.type")
    $actualProfile = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("profile", "e2eProfile", "source.profile")
    Assert-StringValue -Actual $actualSource -Expected $ReleaseSource -Label "$Profile release source"
    Assert-StringValue -Actual $actualProfile -Expected $Profile -Label "$Profile E2E profile"

    $environmentProperty = $Summary.PSObject.Properties["environment"]
    $externalRequestsProperty = if ($null -ne $environmentProperty -and $null -ne $environmentProperty.Value) {
        $environmentProperty.Value.PSObject.Properties["externalNetworkRequests"]
    }
    else {
        $null
    }
    if ($null -eq $externalRequestsProperty) {
        throw "$Profile summary omitted external network request evidence"
    }
    $externalRequests = $externalRequestsProperty.Value
    if (@($externalRequests).Count -ne 0) {
        throw "$Profile E2E recorded external network requests: $(@($externalRequests).Count)"
    }

    $fakeReports = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "fakeReportArtifactsCreated",
        "failures.fakeReportArtifactsCreated",
        "tamper.reportArtifactsCreated"
    )
    if ($null -eq $fakeReports -or [int]$fakeReports -ne 0) {
        throw "$Profile summary must record zero fake report artifacts; actual=$fakeReports"
    }
}

function Assert-ReportTriple {
    param(
        [Parameter(Mandatory = $true)][string]$JobDirectory,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Assert-PathIsChild -Parent $EvidenceDirectory -Child $JobDirectory -Label "$Label report directory"
    $requiredArtifacts = New-Object System.Collections.Generic.List[string]
    $requiredArtifacts.Add((Join-Path $JobDirectory "analysis-result.json"))
    foreach ($extension in @("docx", "pdf")) {
        $candidates = @(Get-ChildItem -LiteralPath $JobDirectory -File -Filter "*.${extension}")
        if ($candidates.Count -ne 1) {
            throw "$Label must generate exactly one .$extension report; found $($candidates.Count) in $JobDirectory"
        }
        $requiredArtifacts.Add($candidates[0].FullName)
    }
    foreach ($artifactPath in $requiredArtifacts) {
        if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
            throw "$Label did not generate required artifact: $artifactPath"
        }
        if ((Get-Item -LiteralPath $artifactPath).Length -le 0) {
            throw "$Label generated an empty artifact: $artifactPath"
        }
    }
}

function Assert-NsisSummary {
    param(
        [Parameter(Mandatory = $true)]$Summary,
        [Parameter(Mandatory = $true)][string]$ExpectedInstallRoot,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory
    )

    Assert-E2eCommon -Summary $Summary -ReleaseSource "nsis" -Profile "nsis"
    $sourceAppDir = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("source.sourceAppDir", "sourceAppDir", "source.appDir")
    $executable = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("source.actualExecutable.path", "executable", "source.executable.path", "sourceExecutable")
    $executableSha256 = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("source.actualExecutable.sha256", "executableSha256", "source.executable.sha256", "sourceExecutableSha256")
    if (-not (Test-PathEqual -Left ([string]$sourceAppDir) -Right $ExpectedInstallRoot)) {
        throw "NSIS sourceAppDir is not the actual installation directory. expected=$ExpectedInstallRoot actual=$sourceAppDir"
    }
    if ([string]$sourceAppDir -match "(?i)[\\/]release[\\/]win-unpacked(?:[\\/]|$)") {
        throw "NSIS E2E silently fell back to release/win-unpacked: $sourceAppDir"
    }
    if (-not (Test-PathEqual -Left ([string]$executable) -Right $ExpectedExecutable)) {
        throw "NSIS launched executable is not the installed application EXE. expected=$ExpectedExecutable actual=$executable"
    }
    $expectedMetric = Get-FileMetrics -LiteralPath $ExpectedExecutable
    Assert-Sha256Value -Actual $executableSha256 -Expected $expectedMetric.sha256 -Label "NSIS executable SHA-256"

    $fullJob = [string](Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("reports.full.jobDir", "fullReportDir", "fullJobDir"))
    Assert-ReportTriple -JobDirectory $fullJob -EvidenceDirectory $EvidenceDirectory -Label "NSIS XLSX full analysis"
    $fullRepeatJob = [string](Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("reports.fullRepeat.jobDir", "fullRepeatReportDir", "repeatJobDir"))
    Assert-ReportTriple -JobDirectory $fullRepeatJob -EvidenceDirectory $EvidenceDirectory -Label "NSIS XLSX fixed-seed repeat analysis"
    $reproducibility = Get-NestedValue -InputObject $Summary -PropertyPath "science.reproducibility"
    if ($null -eq $reproducibility -or $reproducibility.identical -ne $true -or @($reproducibility.comparedRawKeys).Count -ne 6) {
        throw "NSIS summary omitted six-field fixed-seed reproducibility evidence"
    }
    $invalidMessage = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("failures.invalidDemand.message", "failures.invalidDemand")
    if ([string]::IsNullOrWhiteSpace([string]$invalidMessage)) {
        throw "NSIS summary omitted invalid-demand rejection evidence"
    }

    return [ordered]@{
        releaseSource = "nsis"
        profile = "nsis"
        sourceAppDir = [System.IO.Path]::GetFullPath([string]$sourceAppDir)
        entryExecutable = $expectedMetric
        fullJobDir = [System.IO.Path]::GetFullPath($fullJob)
        fullRepeatJobDir = [System.IO.Path]::GetFullPath($fullRepeatJob)
        scienceBaseline = "fixed seed, frozen Bootstrap fingerprint, and six-field exact reproduction"
        invalidDemandRejected = $true
        externalNetworkRequests = 0
        fakeReportArtifactsCreated = 0
    }
}

function Assert-PortableSummary {
    param(
        [Parameter(Mandatory = $true)]$Summary,
        [Parameter(Mandatory = $true)][string]$ExpectedPortableExe,
        [Parameter(Mandatory = $true)][string]$ExpectedPortableSha256,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory
    )

    Assert-E2eCommon -Summary $Summary -ReleaseSource "portable" -Profile "portable"
    $wrapperPath = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "source.wrapper.path",
        "processChain.wrapper.path",
        "processChain.entrypoint.path",
        "portable.wrapper.path",
        "wrapper.path",
        "portableExecutable"
    )
    $wrapperSha256 = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "source.wrapper.sha256",
        "processChain.wrapper.sha256",
        "processChain.entrypoint.sha256",
        "portable.wrapper.sha256",
        "wrapper.sha256",
        "portableExecutableSha256"
    )
    $wrapperPid = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "source.wrapper.pid",
        "processChain.wrapper.pid",
        "processChain.entrypoint.pid",
        "portable.wrapper.pid",
        "wrapper.pid"
    )
    $electronPath = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "source.actualExecutable.path",
        "processChain.electron.path",
        "portable.electron.path",
        "electron.path",
        "executable"
    )
    $electronSha256 = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "source.actualExecutable.sha256",
        "processChain.electron.sha256",
        "portable.electron.sha256",
        "electron.sha256",
        "executableSha256"
    )
    $electronPid = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "source.actualExecutable.pid",
        "processChain.electron.pid",
        "portable.electron.pid",
        "electron.pid"
    )
    $electronParentPid = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "source.actualExecutable.parentPid",
        "processChain.electron.parentPid",
        "portable.electron.parentPid",
        "electron.parentPid"
    )
    $processChain = Get-NestedValue -InputObject $Summary -PropertyPath "source.processChain"

    if (-not (Test-PathEqual -Left ([string]$wrapperPath) -Right $ExpectedPortableExe)) {
        throw "Portable E2E entrypoint is not Portable.exe. expected=$ExpectedPortableExe actual=$wrapperPath"
    }
    $wrapperMetric = Get-FileMetrics -LiteralPath $ExpectedPortableExe
    Assert-Sha256Value -Actual $wrapperMetric.sha256 -Expected $ExpectedPortableSha256 -Label "Portable wrapper package-inventory SHA-256"
    Assert-Sha256Value -Actual $wrapperSha256 -Expected $wrapperMetric.sha256 -Label "Portable wrapper SHA-256"
    if ([int64]$wrapperPid -le 0 -or [int64]$electronPid -le 0 -or [int64]$electronParentPid -le 0) {
        throw "Portable process chain must include positive wrapper/electron/parent PIDs"
    }
    $chainRecords = @($processChain)
    if ($chainRecords.Count -lt 2) {
        throw "Portable summary must record the Electron-to-wrapper process ancestry chain"
    }
    if ([int64]$chainRecords[0].pid -ne [int64]$electronPid) {
        throw "Portable process chain does not start at the actual Electron PID"
    }
    if (-not @($chainRecords | Where-Object { [int64]$_.pid -eq [int64]$wrapperPid }).Count) {
        throw "Portable process ancestry does not contain the Portable.exe wrapper PID"
    }
    for ($index = 0; $index -lt ($chainRecords.Count - 1); $index++) {
        if ([int64]$chainRecords[$index].parentPid -ne [int64]$chainRecords[$index + 1].pid) {
            throw "Portable process chain contains a broken parent relationship at index $index"
        }
    }
    if ([int64]$electronParentPid -ne [int64]$chainRecords[1].pid) {
        throw "Portable actual Electron parent PID disagrees with the recorded process chain"
    }
    if ([string]::IsNullOrWhiteSpace([string]$electronPath) -or -not ([string]$electronPath).EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Portable summary omitted the extracted Electron executable path: $electronPath"
    }
    if ([string]$electronPath -match "(?i)[\\/]release[\\/]win-unpacked(?:[\\/]|$)") {
        throw "Portable E2E silently substituted release/win-unpacked: $electronPath"
    }
    if ([string]$electronSha256 -notmatch "^[0-9A-Fa-f]{64}$") {
        throw "Portable extracted Electron SHA-256 is missing or invalid: $electronSha256"
    }

    $reliabilityJob = [string](Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "reports.csvReliabilityOnly.jobDir",
        "reports.reliability.jobDir",
        "limitedReportDir",
        "reliabilityJobDir"
    ))
    Assert-ReportTriple -JobDirectory $reliabilityJob -EvidenceDirectory $EvidenceDirectory -Label "Portable CSV reliability-only analysis"
    $missingColumnMessage = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("failures.missingColumn.message", "failures.missingColumn")
    if ([string]::IsNullOrWhiteSpace([string]$missingColumnMessage)) {
        throw "Portable summary omitted missing-column rejection evidence"
    }

    return [ordered]@{
        releaseSource = "portable"
        profile = "portable"
        wrapper = [ordered]@{
            path = [System.IO.Path]::GetFullPath([string]$wrapperPath)
            pid = [int64]$wrapperPid
            sha256 = ([string]$wrapperSha256).ToUpperInvariant()
        }
        electron = [ordered]@{
            path = [string]$electronPath
            pid = [int64]$electronPid
            parentPid = [int64]$electronParentPid
            sha256 = ([string]$electronSha256).ToUpperInvariant()
        }
        processChain = $chainRecords
        reliabilityJobDir = [System.IO.Path]::GetFullPath($reliabilityJob)
        missingColumnRejected = $true
        externalNetworkRequests = 0
        fakeReportArtifactsCreated = 0
    }
}

function Assert-TamperSummary {
    param(
        [Parameter(Mandatory = $true)]$Summary,
        [Parameter(Mandatory = $true)][string]$ExpectedTamperRoot
    )

    Assert-E2eCommon -Summary $Summary -ReleaseSource "nsis" -Profile "tamper"
    $sourceAppDir = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("source.sourceAppDir", "sourceAppDir", "source.appDir")
    if (-not (Test-PathEqual -Left ([string]$sourceAppDir) -Right $ExpectedTamperRoot)) {
        throw "Tamper E2E did not use the disposable NSIS copy. expected=$ExpectedTamperRoot actual=$sourceAppDir"
    }
    $reportArtifacts = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "failures.manifestTamper.reportArtifacts",
        "tamper.reportArtifactsCreated",
        "manifestTamper.reportArtifactsCreated",
        "integrity.reportArtifactsCreated",
        "fakeReportArtifactsCreated"
    )
    $message = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @(
        "failures.manifestTamper.message",
        "tamper.message",
        "manifestTamper.message",
        "integrity.message",
        "failures.manifestTamper.message"
    )
    if ($null -eq $reportArtifacts -or [int]$reportArtifacts -ne 0) {
        throw "Dynamic tamper rejection generated report artifacts: $reportArtifacts"
    }
    if ([string]::IsNullOrWhiteSpace([string]$message)) {
        throw "Dynamic tamper rejection did not record an actionable error message"
    }
    $disposableDeleted = Get-FirstNestedValue -InputObject $Summary -PropertyPaths @("tamper.disposableCopyDeleted")
    if ($disposableDeleted -ne $true) {
        throw "Tamper E2E did not confirm deletion of the disposable installation copy"
    }

    return [ordered]@{
        releaseSource = "nsis"
        profile = "tamper"
        sourceAppDir = [System.IO.Path]::GetFullPath([string]$sourceAppDir)
        rejected = $true
        message = [string]$message
        reportArtifactsCreated = 0
        externalNetworkRequests = 0
    }
}

function Get-FormalInstallIntegrity {
    param([Parameter(Mandatory = $true)][string]$InstallDirectory)

    $manifest = Join-Path $InstallDirectory "resources\runtime-manifest.json"
    $runtimeExecutable = Join-Path $InstallDirectory "resources\runtime\questionnaire-engine\questionnaire-engine.exe"
    if (-not (Test-Path -LiteralPath $runtimeExecutable -PathType Leaf)) {
        throw "Installed questionnaire-engine.exe is missing from the fixed packaged resource path: $runtimeExecutable"
    }
    return [ordered]@{
        manifest = Get-FileMetrics -LiteralPath $manifest
        runtimeExecutable = Get-FileMetrics -LiteralPath $runtimeExecutable
    }
}

function Assert-FormalIntegrityEqual {
    param(
        [Parameter(Mandatory = $true)]$Before,
        [Parameter(Mandatory = $true)]$After
    )

    foreach ($name in @("manifest", "runtimeExecutable")) {
        if ($Before[$name].sha256 -ne $After[$name].sha256 -or $Before[$name].bytes -ne $After[$name].bytes) {
            throw "Formal NSIS installation changed during disposable tamper test: $name"
        }
    }
}

function Invoke-E2eProfile {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("nsis", "portable")][string]$ReleaseSource,
        [Parameter(Mandatory = $true)][ValidateSet("nsis", "portable", "tamper")][string]$Profile,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [string]$PackagedAppDirectory,
        [string]$PortableExecutable,
        [Parameter(Mandatory = $true)][string]$NodePath
    )

    $env:ANALYZER_PACKAGE_EVIDENCE_ROOT = $EvidenceDirectory
    $env:ANALYZER_RELEASE_SOURCE = $ReleaseSource
    $env:ANALYZER_E2E_PROFILE = $Profile
    if ($Profile -eq "tamper") {
        $env:ANALYZER_TAMPER_DISPOSABLE = "1"
    }
    else {
        Remove-Item Env:ANALYZER_TAMPER_DISPOSABLE -ErrorAction SilentlyContinue
    }
    if ([string]::IsNullOrWhiteSpace($PackagedAppDirectory)) {
        Remove-Item Env:ANALYZER_PACKAGED_APP_DIR -ErrorAction SilentlyContinue
    }
    else {
        if (-not (Test-Path -LiteralPath $PackagedAppDirectory -PathType Container)) {
            throw "Requested $Profile packaged app directory is missing: $PackagedAppDirectory"
        }
        $env:ANALYZER_PACKAGED_APP_DIR = [System.IO.Path]::GetFullPath($PackagedAppDirectory)
    }
    if ([string]::IsNullOrWhiteSpace($PortableExecutable)) {
        Remove-Item Env:ANALYZER_PORTABLE_EXE -ErrorAction SilentlyContinue
    }
    else {
        if (-not (Test-Path -LiteralPath $PortableExecutable -PathType Leaf)) {
            throw "Requested Portable.exe source is missing: $PortableExecutable"
        }
        $env:ANALYZER_PORTABLE_EXE = [System.IO.Path]::GetFullPath($PortableExecutable)
    }

    Invoke-NativeChecked -FilePath $NodePath -Arguments @("scripts/e2e-packaged.mjs")
}

function Test-ByteIdentical {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )

    $leftBytes = [System.IO.File]::ReadAllBytes($Left)
    $rightBytes = [System.IO.File]::ReadAllBytes($Right)
    if ($leftBytes.Length -ne $rightBytes.Length) { return $false }
    for ($index = 0; $index -lt $leftBytes.Length; $index++) {
        if ($leftBytes[$index] -ne $rightBytes[$index]) { return $false }
    }
    return $true
}

function Assert-OutputsEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$NodePath
    )

    $beforePath = Join-Path $EvidenceDirectory "historical-outputs-before.json"
    $afterPath = Join-Path $EvidenceDirectory "historical-outputs-after.json"
    $beforeValidation = Assert-JsonParsers -LiteralPath $beforePath -NodePath $NodePath
    $afterValidation = Assert-JsonParsers -LiteralPath $afterPath -NodePath $NodePath
    $byteIdentical = Test-ByteIdentical -Left $beforePath -Right $afterPath
    if (-not $byteIdentical) {
        throw "$Label historical outputs before/after JSON files are not byte-for-byte identical"
    }
    return [ordered]@{
        label = $Label
        before = $beforeValidation
        after = $afterValidation
        byteForByteIdentical = $true
    }
}

function Get-EnvSnapshot {
    param([Parameter(Mandatory = $true)][string[]]$Names)
    $snapshot = [ordered]@{}
    foreach ($name in $Names) {
        $snapshot[$name] = [System.Environment]::GetEnvironmentVariable($name, "Process")
    }
    return $snapshot
}

function Restore-EnvSnapshot {
    param([Parameter(Mandatory = $true)]$Snapshot)
    foreach ($entry in $Snapshot.GetEnumerator()) {
        if ($null -eq $entry.Value) {
            [System.Environment]::SetEnvironmentVariable([string]$entry.Key, $null, "Process")
        }
        else {
            [System.Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, "Process")
        }
    }
}

function ConvertTo-MarkdownCell {
    param($Value)
    if ($null -eq $Value) { return "" }
    return ([string]$Value).Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
}

if (-not (Test-IsAsciiPath -LiteralPath $validationBase)) {
    throw "Validation base must be a pure ASCII path: $validationBase"
}
if (-not (Test-Path -LiteralPath $validationBase -PathType Container)) {
    New-Item -ItemType Directory -Path $validationBase -Force | Out-Null
}
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $runName = "r8-{0}-p{1}" -f ([DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")), $PID
    $EvidenceRoot = Join-Path $validationBase $runName
}
$EvidenceRoot = Assert-NewEvidencePath -LiteralPath $EvidenceRoot
New-Item -ItemType Directory -Path $EvidenceRoot -ErrorAction Stop | Out-Null

$transcriptPath = Join-Path $EvidenceRoot "installable-verification.log"
$jsonSummaryPath = Join-Path $EvidenceRoot "installable-verification.json"
$markdownSummaryPath = Join-Path $EvidenceRoot "installable-verification.md"
$nsisEvidenceRoot = Join-Path $EvidenceRoot "nsis-e2e"
$portableEvidenceRoot = Join-Path $EvidenceRoot "portable-e2e"
$tamperEvidenceRoot = Join-Path $EvidenceRoot "tamper-e2e"
$installRoot = Join-Path $EvidenceRoot "nsis-installed"
$tamperInstallRoot = Join-Path $EvidenceRoot "tamper-installed-disposable"

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = if ($null -ne $npmCommand) { $npmCommand.Source } else { $null }
$node = if ($null -ne $nodeCommand) { $nodeCommand.Source } else { $null }
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$builder = Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd"
$managedEnvironmentNames = @(
    "CSC_IDENTITY_AUTO_DISCOVERY",
    "ANALYZER_PACKAGE_EVIDENCE_ROOT",
    "ANALYZER_RELEASE_SOURCE",
    "ANALYZER_E2E_PROFILE",
    "ANALYZER_PACKAGED_APP_DIR",
    "ANALYZER_PORTABLE_EXE",
    "ANALYZER_TAMPER_DISPOSABLE"
)
$environmentBefore = Get-EnvSnapshot -Names $managedEnvironmentNames

try {
    Start-Transcript -LiteralPath $transcriptPath -NoClobber | Out-Null
    $transcriptStarted = $true
    Push-Location -LiteralPath $projectRoot
    $locationPushed = $true

    Write-Host "Installable Issue 008 verification evidence: $EvidenceRoot"
    Write-Host "Project root: $projectRoot"
    Write-Host "NSIS evidence: $nsisEvidenceRoot"
    Write-Host "Portable evidence: $portableEvidenceRoot"
    Write-Host "Tamper evidence: $tamperEvidenceRoot"

    Invoke-RecordedStage -Name "runtime-build" -Command "npm run runtime:build" -Action {
        if ([string]::IsNullOrWhiteSpace($npm)) {
            throw "npm.cmd was not found on PATH"
        }
        Invoke-NativeChecked -FilePath $npm -Arguments @("run", "runtime:build")
    }

    Invoke-RecordedStage -Name "web-build" -Command "npm run build" -Action {
        Invoke-NativeChecked -FilePath $npm -Arguments @("run", "build")
    }

    $packageStageStartedUtc = [DateTime]::UtcNow
    Invoke-RecordedStage -Name "windows-package" -Command "electron-builder --win (CSC_IDENTITY_AUTO_DISCOVERY=false)" -Action {
        if (-not (Test-Path -LiteralPath $builder -PathType Leaf)) {
            throw "electron-builder command is missing: $builder"
        }
        $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
        Invoke-NativeChecked -FilePath $builder -Arguments @("--win")
    }

    Invoke-RecordedStage -Name "package-inventory" -Command "SHA-256/size for NSIS+Portable; win-unpacked inventory only" -Action {
        $script:packageArtifacts = Get-PackageArtifacts -NotBeforeUtc $packageStageStartedUtc
        $script:packageArtifacts | ConvertTo-Json -Depth 8 | Write-Host
    }

    Invoke-RecordedStage -Name "nsis-silent-install" -Command "Setup.exe /S /D=<fresh ASCII evidence>/nsis-installed (mandatory)" -Action {
        if (Test-Path -LiteralPath $installRoot) {
            throw "Install destination already exists; refusing to overwrite it: $installRoot"
        }
        Assert-PathIsChild -Parent $EvidenceRoot -Child $installRoot -Label "NSIS install destination"
        $setupPath = [string]$script:packageArtifacts.installer.path
        $setupMetric = Get-FileMetrics -LiteralPath $setupPath
        Assert-Sha256Value -Actual $setupMetric.sha256 -Expected ([string]$script:packageArtifacts.installer.sha256) -Label "Installer pre-launch package-inventory SHA-256"
        $script:registrationState = Suspend-ProductUninstallRegistration -EvidenceDirectory $EvidenceRoot
        $process = Start-Process -FilePath $setupPath -ArgumentList @("/S", "/currentuser", "/D=$installRoot") -PassThru -WindowStyle Hidden
        if (-not $process.WaitForExit(180000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            throw (New-NativeFailure -Message "NSIS silent install timed out after 180 seconds" -ExitCode 124)
        }
        $process.Refresh()
        if ($process.ExitCode -ne 0) {
            throw (New-NativeFailure -Message "NSIS silent install failed with exit code $($process.ExitCode)" -ExitCode $process.ExitCode)
        }
        $script:installedExecutable = Resolve-InstalledExecutable -InstallDirectory $installRoot
        Assert-PathIsChild -Parent $installRoot -Child $script:installedExecutable -Label "Installed application executable"
        $script:installedExecutableMetrics = Get-FileMetrics -LiteralPath $script:installedExecutable
        $script:installedMetrics = Get-DirectoryMetrics -LiteralPath $installRoot
        $script:formalInstallIntegrity = [ordered]@{
            beforeTamper = Get-FormalInstallIntegrity -InstallDirectory $installRoot
            afterTamper = $null
            unchanged = $null
        }
    }

    Invoke-RecordedStage -Name "nsis-source-e2e" -Command "ANALYZER_RELEASE_SOURCE=nsis ANALYZER_E2E_PROFILE=nsis ANALYZER_PACKAGED_APP_DIR=<actual install>" -Action {
        if ([string]::IsNullOrWhiteSpace($node)) {
            throw "node.exe was not found on PATH"
        }
        Invoke-E2eProfile -ReleaseSource "nsis" -Profile "nsis" -EvidenceDirectory $nsisEvidenceRoot -PackagedAppDirectory $installRoot -NodePath $node
        $summaryPath = Join-Path $nsisEvidenceRoot "e2e-summary.json"
        $script:nsisSummary = Read-JsonStrict -LiteralPath $summaryPath
        $record = Assert-NsisSummary -Summary $script:nsisSummary -ExpectedInstallRoot $installRoot -ExpectedExecutable $script:installedExecutable -EvidenceDirectory $nsisEvidenceRoot
        $sourceMatrix.Add([pscustomobject]$record)
    }

    Invoke-RecordedStage -Name "portable-source-e2e" -Command "ANALYZER_RELEASE_SOURCE=portable ANALYZER_E2E_PROFILE=portable ANALYZER_PORTABLE_EXE=<release Portable.exe>" -Action {
        $portablePath = [string]$script:packageArtifacts.portable.path
        Invoke-E2eProfile -ReleaseSource "portable" -Profile "portable" -EvidenceDirectory $portableEvidenceRoot -PortableExecutable $portablePath -NodePath $node
        $summaryPath = Join-Path $portableEvidenceRoot "e2e-summary.json"
        $script:portableSummary = Read-JsonStrict -LiteralPath $summaryPath
        $record = Assert-PortableSummary -Summary $script:portableSummary -ExpectedPortableExe $portablePath -ExpectedPortableSha256 ([string]$script:packageArtifacts.portable.sha256) -EvidenceDirectory $portableEvidenceRoot
        $sourceMatrix.Add([pscustomobject]$record)
    }

    Invoke-RecordedStage -Name "cross-source-artifact-qa" -Command "verify_packaged_artifacts.py --full-job <NSIS> --reliability-job <Portable>" -Action {
        if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
            throw "QA Python is missing: $python"
        }
        $nsisFullJob = [string](Get-FirstNestedValue -InputObject $script:nsisSummary -PropertyPaths @("reports.full.jobDir", "fullReportDir", "fullJobDir"))
        $portableReliabilityJob = [string](Get-FirstNestedValue -InputObject $script:portableSummary -PropertyPaths @(
            "reports.csvReliabilityOnly.jobDir",
            "reports.reliability.jobDir",
            "limitedReportDir",
            "reliabilityJobDir"
        ))
        Assert-PathIsChild -Parent $nsisEvidenceRoot -Child $nsisFullJob -Label "NSIS full QA job"
        Assert-PathIsChild -Parent $portableEvidenceRoot -Child $portableReliabilityJob -Label "Portable reliability QA job"
        Invoke-NativeChecked -FilePath $python -Arguments @(
            "scripts/verify_packaged_artifacts.py",
            "--evidence-root", $EvidenceRoot,
            "--full-job", $nsisFullJob,
            "--reliability-job", $portableReliabilityJob
        )
        $script:artifactQa = Read-JsonStrict -LiteralPath (Join-Path $EvidenceRoot "artifact-qa.json")
        Assert-StringValue -Actual $script:artifactQa.status -Expected "passed" -Label "Cross-source artifact QA status"
    }

    Invoke-RecordedStage -Name "disposable-manifest-tamper" -Command "copy actual NSIS install; ANALYZER_E2E_PROFILE=tamper; verify rejection; delete copy" -Action {
        $cleanupRecord = [ordered]@{
            disposablePath = $tamperInstallRoot
            created = $false
            removed = $false
            formalInstallUnchanged = $false
            releaseInstallerUnchanged = $false
            releasePortableUnchanged = $false
        }
        $installerBefore = Get-FileMetrics -LiteralPath ([string]$script:packageArtifacts.installer.path)
        $portableBefore = Get-FileMetrics -LiteralPath ([string]$script:packageArtifacts.portable.path)
        Assert-Sha256Value -Actual $installerBefore.sha256 -Expected ([string]$script:packageArtifacts.installer.sha256) -Label "Installer pre-tamper package-inventory SHA-256"
        Assert-Sha256Value -Actual $portableBefore.sha256 -Expected ([string]$script:packageArtifacts.portable.sha256) -Label "Portable pre-tamper package-inventory SHA-256"
        try {
            if (Test-Path -LiteralPath $tamperInstallRoot) {
                throw "Disposable tamper path already exists; refusing to overwrite: $tamperInstallRoot"
            }
            Assert-PathIsChild -Parent $EvidenceRoot -Child $tamperInstallRoot -Label "Disposable tamper installation copy"
            Copy-Item -LiteralPath $installRoot -Destination $tamperInstallRoot -Recurse -ErrorAction Stop
            $cleanupRecord.created = $true
            Invoke-E2eProfile -ReleaseSource "nsis" -Profile "tamper" -EvidenceDirectory $tamperEvidenceRoot -PackagedAppDirectory $tamperInstallRoot -NodePath $node
            $summaryPath = Join-Path $tamperEvidenceRoot "e2e-summary.json"
            $script:tamperSummary = Read-JsonStrict -LiteralPath $summaryPath
            $tamperRecord = Assert-TamperSummary -Summary $script:tamperSummary -ExpectedTamperRoot $tamperInstallRoot
            $sourceMatrix.Add([pscustomobject]$tamperRecord)
        }
        finally {
            if (Test-Path -LiteralPath $tamperInstallRoot) {
                if (-not (Test-IsStrictChildPath -Parent $EvidenceRoot -Child $tamperInstallRoot)) {
                    throw "Refusing unsafe recursive deletion outside evidence root: $tamperInstallRoot"
                }
                Remove-Item -LiteralPath $tamperInstallRoot -Recurse -Force -ErrorAction Stop
            }
            $cleanupRecord.removed = -not (Test-Path -LiteralPath $tamperInstallRoot)
            $afterFormal = Get-FormalInstallIntegrity -InstallDirectory $installRoot
            Assert-FormalIntegrityEqual -Before $script:formalInstallIntegrity.beforeTamper -After $afterFormal
            $script:formalInstallIntegrity.afterTamper = $afterFormal
            $script:formalInstallIntegrity.unchanged = $true
            $cleanupRecord.formalInstallUnchanged = $true
            $installerAfter = Get-FileMetrics -LiteralPath ([string]$script:packageArtifacts.installer.path)
            $portableAfter = Get-FileMetrics -LiteralPath ([string]$script:packageArtifacts.portable.path)
            $cleanupRecord.releaseInstallerUnchanged = ($installerBefore.sha256 -eq $installerAfter.sha256 -and $installerBefore.bytes -eq $installerAfter.bytes)
            $cleanupRecord.releasePortableUnchanged = ($portableBefore.sha256 -eq $portableAfter.sha256 -and $portableBefore.bytes -eq $portableAfter.bytes)
            if (-not $cleanupRecord.removed -or -not $cleanupRecord.releaseInstallerUnchanged -or -not $cleanupRecord.releasePortableUnchanged) {
                throw "Disposable tamper cleanup or formal release integrity verification failed"
            }
            if (-not (Test-Path -LiteralPath $tamperEvidenceRoot -PathType Container)) {
                New-Item -ItemType Directory -Path $tamperEvidenceRoot -ErrorAction Stop | Out-Null
            }
            $cleanupPath = Join-Path $tamperEvidenceRoot "tamper-cleanup.json"
            Write-JsonUtf8NoBom -LiteralPath $cleanupPath -Value $cleanupRecord
            $script:tamperCleanup = $cleanupRecord
        }
    }

    Invoke-RecordedStage -Name "utf8-json-and-outputs-integrity" -Command "strict UTF-8 no BOM + ConvertFrom-Json + Node JSON.parse + byte-identical outputs snapshots" -Action {
        $outputsRecords = New-Object System.Collections.Generic.List[object]
        foreach ($entry in @(
            [ordered]@{ label = "nsis"; root = $nsisEvidenceRoot },
            [ordered]@{ label = "portable"; root = $portableEvidenceRoot },
            [ordered]@{ label = "tamper"; root = $tamperEvidenceRoot }
        )) {
            $outputsRecords.Add([pscustomobject](Assert-OutputsEvidence -EvidenceDirectory $entry.root -Label $entry.label -NodePath $node))
        }
        $script:outputsEvidence = @($outputsRecords | ForEach-Object { $_ })

        $jsonFiles = New-Object System.Collections.Generic.List[System.IO.FileInfo]
        foreach ($jsonRoot in @($nsisEvidenceRoot, $portableEvidenceRoot, $tamperEvidenceRoot)) {
            foreach ($jsonFile in @(Get-ChildItem -LiteralPath $jsonRoot -File -Recurse -Filter "*.json")) {
                $jsonFiles.Add($jsonFile)
            }
        }
        $rootArtifactQa = Get-Item -LiteralPath (Join-Path $EvidenceRoot "artifact-qa.json")
        $jsonFiles.Add($rootArtifactQa)
        $jsonFiles = @($jsonFiles | Sort-Object FullName -Unique)
        if ($jsonFiles.Count -eq 0) {
            throw "No JSON evidence was produced"
        }
        foreach ($jsonFile in $jsonFiles) {
            $jsonValidation.Add([pscustomobject](Assert-JsonParsers -LiteralPath $jsonFile.FullName -NodePath $node))
        }
    }
}
catch {
    $overallExitCode = 1
    $failureMessage = $_.Exception.Message
    $failureStack = $_.ScriptStackTrace
    Write-Host "[VERIFY FAILED] $failureMessage"
}
finally {
    if (Test-Path -LiteralPath $tamperInstallRoot) {
        try {
            if (-not (Test-IsStrictChildPath -Parent $EvidenceRoot -Child $tamperInstallRoot)) {
                throw "Refusing unsafe fallback cleanup outside evidence root: $tamperInstallRoot"
            }
            Remove-Item -LiteralPath $tamperInstallRoot -Recurse -Force -ErrorAction Stop
            Write-Host "[CLEANUP] Removed disposable tamper copy after failure: $tamperInstallRoot"
        }
        catch {
            $overallExitCode = 1
            if ([string]::IsNullOrWhiteSpace($failureMessage)) {
                $failureMessage = "Disposable tamper cleanup failed: $($_.Exception.Message)"
                $failureStack = $_.ScriptStackTrace
            }
            Write-Host "[CLEANUP FAILED] $($_.Exception.Message)"
        }
    }

    if ($locationPushed) {
        Pop-Location
        $locationPushed = $false
    }

    if ($null -ne $registrationState -and -not $registrationState.restorationVerified) {
        try {
            $registrationState = Restore-ProductUninstallRegistration -State $registrationState
            Write-JsonUtf8NoBom -LiteralPath (Join-Path $EvidenceRoot "uninstall-registration-restore.json") -Value $registrationState
        }
        catch {
            $overallExitCode = 1
            if ([string]::IsNullOrWhiteSpace($failureMessage)) {
                $failureMessage = "Uninstall registration restoration failed: $($_.Exception.Message)"
                $failureStack = $_.ScriptStackTrace
            }
            Write-Host "[REGISTRATION RESTORE FAILED] $($_.Exception.Message)"
        }
    }

    if ($null -eq $packageArtifacts -and $null -ne $packageStageStartedUtc) {
        try {
            $packageArtifacts = Get-PackageArtifacts -NotBeforeUtc $packageStageStartedUtc
        }
        catch {
            Write-Host "[INFO] Current-run package inventory unavailable: $($_.Exception.Message)"
        }
    }

    $runStopwatch.Stop()
    $summary = [ordered]@{
        schemaVersion = "2.0"
        issue = "Issue 008 - release artifact source E2E closure"
        taskId = "T-20260717-10"
        status = if ($overallExitCode -eq 0) { "passed" } else { "failed" }
        exitCode = $overallExitCode
        syntheticOnly = $true
        projectRoot = $projectRoot
        evidenceRoot = $EvidenceRoot
        transcript = $transcriptPath
        startedAt = $runStartedUtc.ToString("o")
        endedAt = [DateTime]::UtcNow.ToString("o")
        totalDurationSeconds = [Math]::Round($runStopwatch.Elapsed.TotalSeconds, 3)
        defaultCommand = "npm run verify:installable"
        mandatorySources = @("nsis", "portable")
        winUnpackedUsedForE2e = $false
        stages = @($stages | ForEach-Object { $_ })
        packages = $packageArtifacts
        nsisInstallation = [ordered]@{
            mandatory = $true
            path = $installRoot
            executable = $installedExecutableMetrics
            footprint = $installedMetrics
        }
        sourceMatrix = @($sourceMatrix | ForEach-Object { $_ })
        e2e = [ordered]@{
            nsis = [ordered]@{ root = $nsisEvidenceRoot; summary = $nsisSummary }
            portable = [ordered]@{ root = $portableEvidenceRoot; summary = $portableSummary }
            tamper = [ordered]@{ root = $tamperEvidenceRoot; summary = $tamperSummary; cleanup = $tamperCleanup }
        }
        artifactQa = $artifactQa
        formalInstallIntegrity = $formalInstallIntegrity
        uninstallRegistration = $registrationState
        outputsEvidence = $outputsEvidence
        jsonEvidenceValidation = @($jsonValidation | ForEach-Object { $_ })
        summaryJsonContract = [ordered]@{
            encoding = "UTF-8"
            bom = $false
            powershellConvertFromJson = $true
            nodeJsonParse = $true
            validationTiming = "immediately after summary write, before process exit"
        }
        failure = if ($overallExitCode -eq 0) {
            $null
        }
        else {
            [ordered]@{
                message = $failureMessage
                stack = $failureStack
            }
        }
    }

    try {
        Write-JsonUtf8NoBom -LiteralPath $jsonSummaryPath -Value $summary
        if (-not [string]::IsNullOrWhiteSpace($node)) {
            $null = Assert-JsonParsers -LiteralPath $jsonSummaryPath -NodePath $node
        }

        $markdown = New-Object System.Collections.Generic.List[string]
        $markdown.Add("# Installable Verification - T-20260717-10 / Issue 008")
        $markdown.Add("")
        $markdown.Add("- Status: ``$($summary.status)``")
        $markdown.Add("- Exit code: ``$($summary.exitCode)``")
        $markdown.Add("- Evidence root: ``$EvidenceRoot``")
        $markdown.Add("- Total duration: ``$($summary.totalDurationSeconds) s``")
        $markdown.Add("- Default command: ``npm run verify:installable``")
        $markdown.Add("- E2E source fallback: ``forbidden``; ``release\\win-unpacked`` was inventory-only")
        if ($failureMessage) {
            $markdown.Add("- Failure: ``$(ConvertTo-MarkdownCell $failureMessage)``")
        }
        $markdown.Add("")
        $markdown.Add("## Stages")
        $markdown.Add("")
        $markdown.Add("| Stage | Status | Exit | Seconds | Error |")
        $markdown.Add("|---|---:|---:|---:|---|")
        foreach ($stage in $stages) {
            $markdown.Add("| $(ConvertTo-MarkdownCell $stage.name) | $($stage.status) | $($stage.exitCode) | $($stage.durationSeconds) | $(ConvertTo-MarkdownCell $stage.error) |")
        }
        $markdown.Add("")
        $markdown.Add("## Real release sources")
        $markdown.Add("")
        if ($null -ne $installedExecutableMetrics) {
            $markdown.Add("- NSIS install root: ``$installRoot``")
            $markdown.Add("- NSIS application EXE: ``$($installedExecutableMetrics.path)``")
            $markdown.Add("  - SHA-256: ``$($installedExecutableMetrics.sha256)``")
        }
        if ($null -ne $packageArtifacts) {
            $markdown.Add("- Portable wrapper: ``$($packageArtifacts.portable.path)``")
            $markdown.Add("  - SHA-256: ``$($packageArtifacts.portable.sha256)``")
        }
        $markdown.Add("")
        $markdown.Add("## Scenario matrix")
        $markdown.Add("")
        $markdown.Add("| Source | Profile | Required success | Required failure | Network | Fake reports |")
        $markdown.Add("|---|---|---|---|---:|---:|")
        $markdown.Add("| NSIS actual install | nsis | XLSX full + frozen-seed science baseline + JSON/DOCX/PDF | invalid demand | 0 | 0 |")
        $markdown.Add("| Portable.exe wrapper | portable | CSV reliability-only + JSON/DOCX/PDF | missing AA3 | 0 | 0 |")
        $markdown.Add("| Disposable NSIS copy | tamper | manifest/runtime integrity check | dynamic tamper rejected | 0 | 0 |")
        $markdown.Add("")
        $markdown.Add("## Replay evidence")
        $markdown.Add("")
        $markdown.Add("- Transcript: ``$transcriptPath``")
        $markdown.Add("- NSIS E2E: ``$nsisEvidenceRoot``")
        $markdown.Add("- Portable E2E: ``$portableEvidenceRoot``")
        $markdown.Add("- Tamper E2E: ``$tamperEvidenceRoot``")
        $markdown.Add("- Cross-source artifact QA: ``$(Join-Path $EvidenceRoot 'artifact-qa.json')``")
        [System.IO.File]::WriteAllLines($markdownSummaryPath, $markdown, (New-Object System.Text.UTF8Encoding($false)))

        Write-Host "Verification summary JSON: $jsonSummaryPath"
        Write-Host "Verification summary Markdown: $markdownSummaryPath"
    }
    catch {
        $overallExitCode = 1
        $summaryFailure = $_.Exception.Message
        $summary.status = "failed"
        $summary.exitCode = 1
        $summary.failure = [ordered]@{
            message = "Summary write/parse validation failed: $summaryFailure"
            stack = $_.ScriptStackTrace
        }
        try {
            Write-JsonUtf8NoBom -LiteralPath $jsonSummaryPath -Value $summary
            if (-not [string]::IsNullOrWhiteSpace($node)) {
                $null = Assert-JsonParsers -LiteralPath $jsonSummaryPath -NodePath $node
            }
        }
        catch {
            Write-Host "[SUMMARY RECOVERY WRITE FAILED] $($_.Exception.Message)"
        }
        Write-Host "[SUMMARY WRITE OR PARSE FAILED] $summaryFailure"
    }

    if ($transcriptStarted) {
        try {
            Stop-Transcript | Out-Null
        }
        catch {
            $overallExitCode = 1
            Write-Host "[TRANSCRIPT STOP FAILED] $($_.Exception.Message)"
        }
    }

    Restore-EnvSnapshot -Snapshot $environmentBefore
}

exit $overallExitCode
