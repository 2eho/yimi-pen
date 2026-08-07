[CmdletBinding()]
param(
  [switch]$StartJLCEDA,
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }
$nodePath = Join-Path $codexHome "tools\node-v24.18.1-win-x64\node.exe"
$serverEntry = Join-Path $codexHome "tools\easyeda-mcp-pro\node_modules\easyeda-mcp-pro\dist\index.js"
$packageJson = Join-Path $codexHome "tools\easyeda-mcp-pro\node_modules\easyeda-mcp-pro\package.json"
$configPath = Join-Path $codexHome "config.toml"
$jlcedaPath = Join-Path $env:LOCALAPPDATA "Programs\lceda-pro\lceda-pro.exe"
$bridgeHost = "127.0.0.1"
$bridgePort = 49620
$expectedScopes = "diagnostics:read,schematic:read,bom:read,checks:read,pcb:read"

$checks = [System.Collections.Generic.List[object]]::new()

function Start-JLCEDAWithPersistentLogs {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  # Electron writes console warnings from its main process. A GUI process started
  # by a short-lived captured shell must not inherit that shell's pipe handles.
  $logDirectory = Join-Path $env:LOCALAPPDATA "LCEDA-Pro\codex-launch-logs"
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

  $launchId = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $stdoutPath = Join-Path $logDirectory "lceda-pro-$launchId.stdout.log"
  $stderrPath = Join-Path $logDirectory "lceda-pro-$launchId.stderr.log"

  Start-Process `
    -FilePath $Path `
    -WorkingDirectory (Split-Path -Parent $Path) `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath | Out-Null

  Write-Host "JLCEDA logs: $stdoutPath ; $stderrPath"
}

function Add-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail
  )

  $checks.Add([pscustomobject]@{
    Check  = $Name
    Status = if ($Passed) { "PASS" } else { "FAIL" }
    Detail = $Detail
  })
}

if ($StartJLCEDA -and (Test-Path -LiteralPath $jlcedaPath)) {
  $running = Get-Process -Name "lceda-pro" -ErrorAction SilentlyContinue
  if (-not $running) {
    Start-JLCEDAWithPersistentLogs -Path $jlcedaPath
    Start-Sleep -Seconds 12
  }
}

Add-Check "JLCEDA executable" (Test-Path -LiteralPath $jlcedaPath) $jlcedaPath
Add-Check "Node 24 runtime" (Test-Path -LiteralPath $nodePath) $nodePath
Add-Check "MCP server entry" (Test-Path -LiteralPath $serverEntry) $serverEntry
Add-Check "Codex config" (Test-Path -LiteralPath $configPath) $configPath

$packageVersion = "unknown"
if (Test-Path -LiteralPath $packageJson) {
  $packageVersion = (Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json).version
}
Add-Check "easyeda-mcp-pro version" ($packageVersion -eq "0.35.4") $packageVersion

$nodeVersion = "unknown"
if (Test-Path -LiteralPath $nodePath) {
  $nodeVersion = (& $nodePath --version 2>$null).Trim()
}
Add-Check "Node version" ($nodeVersion -eq "v24.18.1") $nodeVersion

$configText = if (Test-Path -LiteralPath $configPath) {
  Get-Content -LiteralPath $configPath -Raw
} else {
  ""
}

Add-Check "MCP registered" ($configText -match '(?m)^\[mcp_servers\.easyeda-mcp-pro\]$') "easyeda-mcp-pro"
Add-Check "Bridge loopback host" ($configText -match '(?m)^BRIDGE_HOST\s*=\s*"127\.0\.0\.1"$') $bridgeHost
Add-Check "Bridge port" ($configText -match '(?m)^BRIDGE_PORT\s*=\s*"49620"$') "$bridgePort"
Add-Check "Read-only scopes" ($configText -match "(?m)^TOOL_SCOPES\s*=\s*`"$([regex]::Escape($expectedScopes))`"$") $expectedScopes
Add-Check "Raw execution disabled" ($configText -match '(?m)^BRIDGE_RAW_EXEC_ENABLED\s*=\s*"false"$') "false"
Add-Check "Ordering disabled" ($configText -match '(?m)^JLCPCB_ENABLE_ORDERING\s*=\s*"false"$') "false"

$jlcedaProcesses = @(Get-Process -Name "lceda-pro" -ErrorAction SilentlyContinue)
$jlcedaMain = $jlcedaProcesses | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
$jlcedaDetail = if ($jlcedaMain) {
  "PID $($jlcedaMain.Id): $($jlcedaMain.MainWindowTitle)"
} elseif ($jlcedaProcesses.Count -gt 0) {
  "processes: $($jlcedaProcesses.Count)"
} else {
  "not running"
}
Add-Check "JLCEDA running" ($jlcedaProcesses.Count -gt 0) $jlcedaDetail

$connections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
  $_.LocalPort -eq $bridgePort -or $_.RemotePort -eq $bridgePort
})
$listener = $connections | Where-Object {
  $_.State -eq "Listen" -and $_.LocalAddress -eq $bridgeHost -and $_.LocalPort -eq $bridgePort
} | Select-Object -First 1
$externalListener = $connections | Where-Object {
  $_.State -eq "Listen" -and $_.LocalPort -eq $bridgePort -and $_.LocalAddress -notin @($bridgeHost, "::1")
}
$established = $connections | Where-Object {
  $_.State -eq "Established" -and
  $_.LocalAddress -in @($bridgeHost, "::1") -and
  $_.RemoteAddress -in @($bridgeHost, "::1")
}

$listenerDetail = if ($listener) { "PID $($listener.OwningProcess) on ${bridgeHost}:$bridgePort" } else { "no loopback listener" }
Add-Check "Bridge listener" ($null -ne $listener) $listenerDetail
Add-Check "No external listener" (@($externalListener).Count -eq 0) "loopback only"
Add-Check "EDA bridge connected" (@($established).Count -ge 2) "$(@($established).Count) established loopback endpoints"

$report = [ordered]@{
  checkedAt = (Get-Date).ToString("o")
  project = "yimi-pen"
  bridge = [ordered]@{
    host = $bridgeHost
    port = $bridgePort
    package = "easyeda-mcp-pro"
    version = $packageVersion
    scopes = $expectedScopes.Split(",")
  }
  checks = $checks
  passed = (@($checks | Where-Object Status -eq "FAIL").Count -eq 0)
}

$checks | Format-Table -AutoSize

if ($OutputPath) {
  $resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
  } else {
    Join-Path (Get-Location) $OutputPath
  }
  $outputDirectory = Split-Path -Parent $resolvedOutput
  if ($outputDirectory) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
  Write-Host "Report: $resolvedOutput"
}

if (-not $report.passed) {
  exit 1
}
