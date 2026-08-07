[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
foreach ($entry in @($userPath -split ';' | Where-Object { $_ })) {
    if (-not (($env:Path -split ';') | Where-Object {
        $_.TrimEnd('\') -ieq $entry.TrimEnd('\')
    })) {
        $env:Path = "$entry;$env:Path"
    }
}

$uv = Get-Command uv -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $uv) {
    throw 'uv is missing. Run scripts/check-embedded-tools.ps1 and install the locked Phase A uv build.'
}

$project = (Resolve-Path (Join-Path $PSScriptRoot '..\hardware\tests')).Path
Push-Location $project
try {
    & $uv.Source sync --frozen
    if ($LASTEXITCODE -ne 0) {
        throw "uv sync failed with exit code $LASTEXITCODE"
    }

    & $uv.Source run --frozen pytest
    if ($LASTEXITCODE -ne 0) {
        throw "hardware pytest failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

