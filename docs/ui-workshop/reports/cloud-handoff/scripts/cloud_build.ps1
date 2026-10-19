# Windows PowerShell 7+ (pwsh.exe) handoff script. NOT executed on Windows during preparation.
# Builds installers only; does not install, uninstall, push, or publish anything.
# Requires PowerShell 7, Git, Node 22.12+ (24 recommended), Python 3.10+, Rust/MSVC, and Windows SDK/Build Tools.
# The source repo must contain the candidate commit and the exact v1.2.9 tag.
[CmdletBinding()]
param(
    [string]$Repo = 'C:\ke-cloud\repo',
    [string]$OutDir = 'C:\ke-cloud\installers',
    [string]$BuildRoot = 'C:\ke-cloud\builds',
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This handoff script requires Windows; no Windows build/VM acceptance has been performed.'
}
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Run this handoff with PowerShell 7 (pwsh.exe); the UTF-8 source build scripts require it.'
}

$candidateCommit = '689575b00d0474caf4303e9681f0257df6581f15'
$baselineCommit = '47675b9762360bdaa0ffb3ee832a8fd0603ef803'
$root = (Resolve-Path -LiteralPath $Repo).ProviderPath
$outRoot = [IO.Path]::GetFullPath($OutDir)
$buildBase = [IO.Path]::GetFullPath($BuildRoot)
$pythonCommand = (Get-Command $Python -ErrorAction Stop).Source
$powerShellCommand = (Get-Command pwsh.exe -CommandType Application -ErrorAction Stop).Source
foreach ($tool in @('git', 'npm.cmd', 'node.exe', 'cargo', 'rustc', 'curl.exe')) {
    Get-Command $tool -ErrorAction Stop | Out-Null
}

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    # Send child stdout to the host: Build-Installer must return only its object.
    & $Command @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE): $($Arguments -join ' ')" }
}
function Get-NativeText {
    param([string]$Command, [string[]]$Arguments)
    $lines = @(& $Command @Arguments)
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE): $($Arguments -join ' ')" }
    return ($lines -join "`n").Trim()
}
function Get-GitText {
    param([string[]]$Arguments)
    return Get-NativeText -Command 'git' -Arguments (@('-C', $root) + $Arguments)
}
function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Set-ProcessEnv {
    param([string]$Name, [AllowNull()][string]$Value)
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

# ^{commit} verifies the object exists; rev-parse of a literal hash alone does not.
if ((Get-GitText -Arguments @('rev-parse', '--verify', ($candidateCommit + '^{commit}'))) -cne $candidateCommit) {
    throw 'Candidate commit is absent or differs from the taskpack.'
}
if ((Get-GitText -Arguments @('rev-parse', '--verify', 'refs/tags/v1.2.9^{commit}')) -cne $baselineCommit) {
    throw 'The v1.2.9 tag is absent or does not match the reviewed baseline commit.'
}
$powerShellVersion = Get-NativeText -Command $powerShellCommand -Arguments @('-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()')
if ([version]$powerShellVersion -lt [version]'7.0') { throw 'The child pwsh.exe must be PowerShell 7 or newer.' }
$originalHead = Get-GitText -Arguments @('rev-parse', 'HEAD')
$runId = 'build-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runDir = Join-Path $outRoot $runId
$runBuildDir = Join-Path $buildBase $runId
if ((Test-Path -LiteralPath $runDir) -or (Test-Path -LiteralPath $runBuildDir)) {
    throw 'Refusing to reuse a prior build directory.'
}
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
New-Item -ItemType Directory -Path $runBuildDir -Force | Out-Null
$envNames = @('PATH', 'VIRTUAL_ENV', 'PYTHONHOME', 'PYTHONPATH', 'CARGO_TARGET_DIR', 'CI',
    'VITE_KE_WORKSHOP', 'VITE_KE_CORE_SAVE', 'APPDATA', 'KE_WORKSPACE', 'KE_APP_CONFIG',
    'KE_SIGN_CERT_THUMBPRINT', 'KE_APP_CONFIG_LEGACY')
$savedEnv = @{}
foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$manifest = [ordered]@{
    schemaVersion = 2
    generatedAt = [DateTime]::UtcNow.ToString('o')
    status = 'BUILD_IN_PROGRESS'
    windowsVmAcceptance = 'NOT_RUN'
    preparationNote = 'Handoff script statically reviewed on Linux; Windows builds and installation acceptance remain unverified.'
    repo = $root
    originalHead = $originalHead
    runDir = $runDir
    buildDir = $runBuildDir
    sourceRefs = [ordered]@{ candidate = $candidateCommit; baselineTag = 'v1.2.9'; baseline = $baselineCommit }
    tools = [ordered]@{}
    installers = @()
    worktrees = @()
    environmentRestored = $false
    repositoryHeadUnchanged = $false
    error = $null
    completedAt = $null
}
$transcribing = $false

function New-BuildSource {
    param([string]$Name, [string]$Commit, [string]$Version)
    $worktree = Join-Path $runBuildDir $Name
    Invoke-Checked -Command 'git' -Arguments @('-C', $root, 'worktree', 'add', '--detach', $worktree, $Commit)
    $script:manifest.worktrees += $worktree
    $actualHead = Get-NativeText -Command 'git' -Arguments @('-C', $worktree, 'rev-parse', 'HEAD')
    if ($actualHead -cne $Commit) { throw "Unexpected source HEAD: $actualHead" }
    $configPath = Join-Path $worktree 'desktop\src-tauri\tauri.conf.json'
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($config.version -cne $Version -or $config.productName -cne 'AstraNota') {
        throw "Unexpected Tauri product/version in $Name" 
    }
    $required = @('backend\requirements.txt', 'scripts\build.ps1', 'frontend\package-lock.json',
        'desktop\package-lock.json', 'desktop\src-tauri\Cargo.lock')
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $worktree $relative) -PathType Leaf)) {
            throw "Missing required build input: $relative"
        }
    }
    $venv = Join-Path $worktree 'backend\.venv'
    Invoke-Checked -Command $pythonCommand -Arguments @('-m', 'venv', $venv)
    $venvPython = Join-Path $venv 'Scripts\python.exe'
    Invoke-Checked -Command $venvPython -Arguments @('-m', 'pip', 'install', '-r', (Join-Path $worktree 'backend\requirements.txt'), 'pyinstaller')
    Invoke-Checked -Command 'npm.cmd' -Arguments @('ci', '--prefix', (Join-Path $worktree 'frontend'))
    Invoke-Checked -Command 'npm.cmd' -Arguments @('ci', '--prefix', (Join-Path $worktree 'desktop'))
    $freezePath = Join-Path $runDir ("$Name-python-freeze.txt")
    Get-NativeText -Command $venvPython -Arguments @('-m', 'pip', 'freeze') | Set-Content -LiteralPath $freezePath -Encoding UTF8
    $target = Join-Path $runBuildDir ("$Name-cargo-target")
    New-Item -ItemType Directory -Path $target | Out-Null
    $inputs = [ordered]@{}
    foreach ($relative in $required + @('desktop\src-tauri\tauri.conf.json')) {
        $inputs[$relative] = Get-Sha256 -Path (Join-Path $worktree $relative)
    }
    return [pscustomobject]@{ name = $Name; path = $worktree; commit = $Commit; version = $Version
        python = $venvPython; venv = $venv; target = $target; inputs = $inputs
        pythonFreeze = $freezePath; pythonFreezeSha256 = (Get-Sha256 -Path $freezePath) }
}

function Build-Installer {
    param($Source, [string]$Label, [bool]$Workshop, [bool]$SkipSidecar = $false)
    Write-Host "Building $Label from $($Source.commit) workshop=$Workshop"
    Set-ProcessEnv -Name 'PATH' -Value ((Join-Path $Source.venv 'Scripts') + ';' + $savedEnv['PATH'])
    Set-ProcessEnv -Name 'VIRTUAL_ENV' -Value $Source.venv
    Set-ProcessEnv -Name 'PYTHONHOME' -Value $null
    # v1.2.9's source build script imports app from the repo root without setting this.
    Set-ProcessEnv -Name 'PYTHONPATH' -Value (Join-Path $Source.path 'backend')
    Set-ProcessEnv -Name 'CI' -Value 'true'
    Set-ProcessEnv -Name 'CARGO_TARGET_DIR' -Value $Source.target
    Set-ProcessEnv -Name 'VITE_KE_WORKSHOP' -Value $(if ($Workshop) { '1' } else { $null })
    Set-ProcessEnv -Name 'VITE_KE_CORE_SAVE' -Value $(if ($Workshop) { '1' } else { $null })
    Set-ProcessEnv -Name 'KE_SIGN_CERT_THUMBPRINT' -Value $null
    $isolatedData = Join-Path $runBuildDir ("$Label-data")
    New-Item -ItemType Directory -Path (Join-Path $isolatedData 'appdata') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $isolatedData 'workspace') -Force | Out-Null
    Set-ProcessEnv -Name 'APPDATA' -Value (Join-Path $isolatedData 'appdata')
    Set-ProcessEnv -Name 'KE_WORKSPACE' -Value (Join-Path $isolatedData 'workspace')
    Set-ProcessEnv -Name 'KE_APP_CONFIG' -Value (Join-Path $isolatedData 'app-config.json')
    Set-ProcessEnv -Name 'KE_APP_CONFIG_LEGACY' -Value (Join-Path $isolatedData 'legacy-app-config.json')
    $nsis = Join-Path $Source.target 'release\bundle\nsis'
    # Only this script's newly created target directory is touched. Do not search the repo.
    if (Test-Path -LiteralPath $nsis) {
        Get-ChildItem -LiteralPath $nsis -File -Filter '*.exe' | Remove-Item -Force
    }
    $startedAt = [DateTime]::UtcNow
    $buildArguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Source.path 'scripts\build.ps1'))
    if ($SkipSidecar) { $buildArguments += '-SkipSidecar' }
    Push-Location $Source.path
    try {
        Invoke-Checked -Command $powerShellCommand -Arguments $buildArguments
        Push-Location (Join-Path $Source.path 'desktop')
        try { Invoke-Checked -Command 'npm.cmd' -Arguments @('run', 'build') }
        finally { Pop-Location }
    } finally { Pop-Location }
    foreach ($relative in $Source.inputs.Keys) {
        if ((Get-Sha256 -Path (Join-Path $Source.path $relative)) -cne $Source.inputs[$relative]) {
            throw "Build modified a reviewed source input/lockfile: $relative"
        }
    }
    if (-not (Test-Path -LiteralPath $nsis -PathType Container)) { throw "NSIS output is missing: $nsis" }
    $bundles = @(Get-ChildItem -LiteralPath $nsis -File -Filter '*_x64-setup.exe')
    $expectedName = 'AstraNota_' + $Source.version + '_x64-setup.exe'
    if ($bundles.Count -ne 1 -or $bundles[0].Name -cne $expectedName) {
        throw "Expected exactly one freshly generated $expectedName in $nsis"
    }
    $bundle = $bundles[0]
    if ($bundle.LastWriteTimeUtc -lt $startedAt.AddSeconds(-2)) { throw 'Refusing an older installer.' }
    $fileVersion = $bundle.VersionInfo.FileVersion
    $productVersion = $bundle.VersionInfo.ProductVersion
    $normalizedVersion = ([string]$fileVersion).Trim() -replace '\.0$', ''
    if ($normalizedVersion -cne $Source.version) {
        throw "Installer FileVersion '$fileVersion' does not match source '$($Source.version)'"
    }
    $dest = Join-Path $runDir ("AstraNota-$Label`_x64-setup.exe")
    Copy-Item -LiteralPath $bundle.FullName -Destination $dest
    $hash = Get-Sha256 -Path $dest
    if ($hash -cne (Get-Sha256 -Path $bundle.FullName)) { throw 'Copied installer hash differs.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $dest
    return [pscustomobject][ordered]@{
        label = $Label; path = $dest; sha256 = $hash; size = (Get-Item -LiteralPath $dest).Length
        sourceCommit = $Source.commit; sourceVersion = $Source.version; fileVersion = $fileVersion
        productVersion = $productVersion; workshop = $Workshop; coreSave = $Workshop
        sourceInputSha256 = $Source.inputs; pythonFreeze = $Source.pythonFreeze
        pythonFreezeSha256 = $Source.pythonFreezeSha256; worktree = $Source.path
        cargoTargetDir = $Source.target; startedAt = $startedAt.ToString('o')
        completedAt = [DateTime]::UtcNow.ToString('o'); authenticodeStatus = [string]$signature.Status
        windowsVmAcceptance = 'NOT_RUN'
    }
}

try {
    Start-Transcript -LiteralPath (Join-Path $runDir 'build.log') -Force | Out-Null
    $transcribing = $true
    Set-ProcessEnv -Name 'PYTHONHOME' -Value $null
    Set-ProcessEnv -Name 'PYTHONPATH' -Value $null
    Invoke-Checked -Command $pythonCommand -Arguments @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)')
    $nodeVersion = Get-NativeText -Command 'node.exe' -Arguments @('--version')
    if ([version]($nodeVersion -replace '^v', '') -lt [version]'22.12.0') {
        throw 'Node 22.12+ is required by the locked commander dependency; Node 24 is recommended.'
    }
    $manifest.tools = [ordered]@{
        powershell = $powerShellVersion
        git = (Get-NativeText -Command 'git' -Arguments @('--version'))
        node = $nodeVersion
        npm = (Get-NativeText -Command 'npm.cmd' -Arguments @('--version'))
        python = (Get-NativeText -Command $pythonCommand -Arguments @('--version'))
        rustc = (Get-NativeText -Command 'rustc' -Arguments @('--version'))
        cargo = (Get-NativeText -Command 'cargo' -Arguments @('--version'))
    }
    $candidate = New-BuildSource -Name 'candidate' -Commit $candidateCommit -Version '1.2.18'
    $manifest.installers += Build-Installer -Source $candidate -Label 'candidate-default' -Workshop $false
    $manifest.installers += Build-Installer -Source $candidate -Label 'candidate-workshop' -Workshop $true -SkipSidecar $true
    if ($manifest.installers[0].sha256 -ceq $manifest.installers[1].sha256) {
        throw 'Default and workshop installers unexpectedly have identical hashes.'
    }
    $baseline = New-BuildSource -Name 'baseline' -Commit $baselineCommit -Version '1.2.9'
    $manifest.installers += Build-Installer -Source $baseline -Label 'baseline-v1.2.9-default' -Workshop $false
    $manifest.status = 'BUILT_NOT_VM_VALIDATED'
} catch {
    $manifest.status = 'BUILD_FAILED'
    $manifest.error = $_.Exception.Message
    throw
} finally {
    foreach ($name in $envNames) { Set-ProcessEnv -Name $name -Value $savedEnv[$name] }
    $manifest.environmentRestored = $true
    foreach ($name in $envNames) {
        if ([Environment]::GetEnvironmentVariable($name, 'Process') -cne $savedEnv[$name]) {
            $manifest.environmentRestored = $false
        }
    }
    try { $manifest.repositoryHeadUnchanged = (Get-GitText -Arguments @('rev-parse', 'HEAD')) -ceq $originalHead }
    catch { $manifest.repositoryHeadUnchanged = $false }
    if (-not $manifest.environmentRestored -or -not $manifest.repositoryHeadUnchanged) {
        $manifest.status = 'BUILD_FAILED'
        $manifest.error = 'Environment restoration or original repository HEAD verification failed.'
    }
    $manifest.completedAt = [DateTime]::UtcNow.ToString('o')
    $json = $manifest | ConvertTo-Json -Depth 10
    $json | Set-Content -LiteralPath (Join-Path $runDir 'build-manifest.json') -Encoding UTF8
    $json | Set-Content -LiteralPath (Join-Path $outRoot 'build-manifest.json') -Encoding UTF8
    Write-Host "Manifest: $(Join-Path $runDir 'build-manifest.json')"
    Write-Host 'Worktrees and build data were retained for inspection; the original checkout was not switched.'
    if ($transcribing) { Stop-Transcript | Out-Null }
}
if ($manifest.status -ne 'BUILT_NOT_VM_VALIDATED') { throw $manifest.error }
