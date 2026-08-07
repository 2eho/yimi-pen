[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifest = Join-Path $repoRoot 'firmware\Cargo.toml'
$lockFile = Join-Path $repoRoot 'firmware\Cargo.lock'
$buildRoot = Join-Path $repoRoot 'build'
$reportPath = Join-Path $buildRoot 'rust-firmware-validation.json'
$resolvedBuild = [System.IO.Path]::GetFullPath($buildRoot)
$resolvedRepo = [System.IO.Path]::GetFullPath($repoRoot)

if (-not $resolvedBuild.StartsWith($resolvedRepo + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Build output escaped repository: $resolvedBuild"
}

New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null

$steps = [System.Collections.Generic.List[object]]::new()

function Invoke-CargoStep {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [string[]] $Arguments
    )

    $output = @(& cargo @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
    $steps.Add([ordered]@{
        name = $Name
        passed = ($exitCode -eq 0)
        exitCode = $exitCode
        command = 'cargo ' + ($Arguments -join ' ')
        outputTail = @($output | Select-Object -Last 20)
    })
}

Push-Location $repoRoot
try {
    $rustcVersion = (& rustc --version).Trim()
    $cargoVersion = (& cargo --version).Trim()
    $activeToolchain = ((& rustup show active-toolchain) -split '\s+')[0]
    $installedTargets = @(& rustup target list --installed --toolchain $activeToolchain)
    $toolchainFile = Get-Content -LiteralPath (Join-Path $repoRoot 'rust-toolchain.toml') -Raw -Encoding utf8
    $steps.Add([ordered]@{
        name = 'toolchain-pin'
        passed = ($rustcVersion -match '^rustc 1\.97\.1 ' -and $toolchainFile -match 'channel\s*=\s*"1\.97\.1"')
        exitCode = 0
        command = 'rustc --version + rust-toolchain.toml'
        outputTail = @($rustcVersion, $activeToolchain)
    })
    $steps.Add([ordered]@{
        name = 'portability-targets-installed'
        passed = ($installedTargets -contains 'thumbv7m-none-eabi' -and $installedTargets -contains 'riscv32imac-unknown-none-elf')
        exitCode = 0
        command = 'rustup target list --installed'
        outputTail = $installedTargets
    })
    $steps.Add([ordered]@{
        name = 'cargo-lock-present'
        passed = (Test-Path -LiteralPath $lockFile)
        exitCode = 0
        command = 'Test-Path firmware/Cargo.lock'
        outputTail = @($lockFile)
    })
    $unsafeFiles = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'firmware\crates') -Recurse -Filter '*.rs' -File | Where-Object {
        Select-String -LiteralPath $_.FullName -Pattern '\bunsafe\s*(?:\{|extern|fn|trait|impl)' -Quiet
    } | ForEach-Object { $_.FullName })
    $allowedUnsafeFile = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'firmware\crates\yimi-platform-ffi\src\raw.rs'))
    $steps.Add([ordered]@{
        name = 'unsafe-boundary'
        passed = ($unsafeFiles.Count -eq 1 -and [System.IO.Path]::GetFullPath($unsafeFiles[0]) -eq $allowedUnsafeFile)
        exitCode = 0
        command = 'scan Rust unsafe boundary'
        outputTail = $unsafeFiles
    })

    Invoke-CargoStep -Name 'format' -Arguments @(
        'fmt', '--manifest-path', $manifest, '--all', '--', '--check'
    )
    Invoke-CargoStep -Name 'clippy' -Arguments @(
        'clippy', '--manifest-path', $manifest, '--locked', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings'
    )
    Invoke-CargoStep -Name 'host-tests' -Arguments @(
        'test', '--manifest-path', $manifest, '--locked', '--workspace', '--quiet'
    )
    Invoke-CargoStep -Name 'ffi-c-mock-tests' -Arguments @(
        'test', '--manifest-path', $manifest, '--locked', '-p', 'yimi-platform-ffi', '--features', 'host-mock', '--quiet'
    )
    $stressOutput = [System.Collections.Generic.List[string]]::new()
    $stressPassed = 0
    $stressExitCode = 0
    for ($iteration = 1; $iteration -le 20; $iteration += 1) {
        $runOutput = @(& cargo test --manifest-path $manifest --locked -p yimi-platform-ffi --features host-mock --lib --quiet -- --test-threads=16 2>&1 | ForEach-Object { $_.ToString() })
        $stressExitCode = $LASTEXITCODE
        $stressOutput.Add("iteration=$iteration exitCode=$stressExitCode")
        foreach ($line in @($runOutput | Select-Object -Last 3)) {
            $stressOutput.Add($line)
        }
        if ($stressExitCode -ne 0) {
            break
        }
        $stressPassed += 1
    }
    $steps.Add([ordered]@{
        name = 'ffi-c-mock-parallel-stress'
        passed = ($stressPassed -eq 20)
        exitCode = $stressExitCode
        command = '20 x cargo test --locked -p yimi-platform-ffi --features host-mock --lib -- --test-threads=16'
        outputTail = @($stressOutput | Select-Object -Last 20)
    })
    Invoke-CargoStep -Name 'thumbv7m-no-std' -Arguments @(
        'check', '--manifest-path', $manifest,
        '--locked',
        '-p', 'yimi-fw-contract', '-p', 'yimi-snapshot-core', '-p', 'yimi-device-link-core', '-p', 'yimi-runtime-core', '-p', 'yimi-platform-ffi',
        '--target', 'thumbv7m-none-eabi', '--quiet'
    )
    Invoke-CargoStep -Name 'riscv32-no-std' -Arguments @(
        'check', '--manifest-path', $manifest,
        '--locked',
        '-p', 'yimi-fw-contract', '-p', 'yimi-snapshot-core', '-p', 'yimi-device-link-core', '-p', 'yimi-runtime-core', '-p', 'yimi-platform-ffi',
        '--target', 'riscv32imac-unknown-none-elf', '--quiet'
    )

    $hostOutput = @(& cargo run --quiet --manifest-path $manifest --locked -p yimi-fw-host 2>&1 | ForEach-Object { $_.ToString() })
    $hostExitCode = $LASTEXITCODE
    $hostJson = $null
    if ($hostExitCode -eq 0 -and $hostOutput.Count -gt 0) {
        try {
            $hostJson = $hostOutput[-1] | ConvertFrom-Json
        }
        catch {
            $hostExitCode = 1
        }
    }
    $steps.Add([ordered]@{
        name = 'host-crosscheck'
        passed = ($hostExitCode -eq 0 -and $null -ne $hostJson -and $hostJson.allPassed -eq $true)
        exitCode = $hostExitCode
        command = 'cargo run --quiet --manifest-path firmware/Cargo.toml --locked -p yimi-fw-host'
        outputTail = @($hostOutput | Select-Object -Last 20)
    })
}
finally {
    Pop-Location
}

$lockSha256 = if (Test-Path -LiteralPath $lockFile) {
    (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash.ToLowerInvariant()
}
else {
    $null
}
$abiHeaderSha256 = (Get-FileHash -LiteralPath (Join-Path $repoRoot 'firmware\abi\yimi_platform_v1.h') -Algorithm SHA256).Hash.ToLowerInvariant()
$cMockSha256 = (Get-FileHash -LiteralPath (Join-Path $repoRoot 'firmware\abi\yimi_platform_mock.c') -Algorithm SHA256).Hash.ToLowerInvariant()

$passed = @($steps | Where-Object passed).Count
$failed = $steps.Count - $passed
$releaseBindingRaw = @(& node (Join-Path $repoRoot 'tools\release-gates\list-blockers.mjs') rust-firmware --binding 2>&1 | ForEach-Object { $_.ToString() })
if ($LASTEXITCODE -ne 0) {
    throw "ReleaseGateCatalog binding failed: $($releaseBindingRaw -join [Environment]::NewLine)"
}
$releaseBinding = ($releaseBindingRaw -join [Environment]::NewLine) | ConvertFrom-Json
$report = [ordered]@{
    schemaVersion = 1
    profile = 'rust-firmware-host-validation'
    rustcVersion = $rustcVersion
    cargoVersion = $cargoVersion
    activeToolchain = $activeToolchain
    installedPortabilityTargets = $installedTargets
    cargoLockSha256 = $lockSha256
    abiHeaderSha256 = $abiHeaderSha256
    cReferenceMockSha256 = $cMockSha256
    passed = $passed
    failed = $failed
    total = $steps.Count
    hostCrosscheck = $hostJson
    releaseGateCatalogId = $releaseBinding.catalogId
    releaseDecisionOwner = $releaseBinding.releaseDecisionOwner
    reportScopeGateIds = @($releaseBinding.reportScopeGateIds)
    steps = $steps
}

$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Host "Rust firmware: $passed/$($steps.Count) steps passed"
Write-Host "Report: $reportPath"
if ($failed -gt 0) {
    exit 1
}
