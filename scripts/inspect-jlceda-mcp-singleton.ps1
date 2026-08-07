[CmdletBinding()]
param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$bridgePorts = 49620..49629
$nodeProcesses = @(Get-Process -Name node -ErrorAction SilentlyContinue)
$mcpProcesses = [System.Collections.Generic.List[object]]::new()

foreach ($process in $nodeProcesses) {
  $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction SilentlyContinue
  if (-not $cim -or $cim.CommandLine -notlike "*easyeda-mcp-pro*dist\index.js*") {
    continue
  }

  $listeners = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
    $_.OwningProcess -eq $process.Id -and $_.State -eq "Listen" -and $_.LocalAddress -in @("127.0.0.1", "::1") -and $_.LocalPort -in $bridgePorts
  } | Select-Object -ExpandProperty LocalPort)

  $mcpProcesses.Add([pscustomobject]@{
    pid = $process.Id
    parentPid = $cim.ParentProcessId
    startedAt = $process.StartTime.ToString("o")
    ports = @($listeners | Sort-Object)
  })
}

$connections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
  $_.LocalPort -in $bridgePorts -or $_.RemotePort -in $bridgePorts
} | ForEach-Object {
  [pscustomobject]@{
    localAddress = $_.LocalAddress
    localPort = $_.LocalPort
    remoteAddress = $_.RemoteAddress
    remotePort = $_.RemotePort
    state = $_.State.ToString()
    owningProcess = $_.OwningProcess
  }
})

$connectedPorts = @($connections | Where-Object {
  $_.state -eq "Established" -and ($_.localPort -in $bridgePorts -or $_.remotePort -in $bridgePorts)
} | ForEach-Object {
  if ($_.localPort -in $bridgePorts) { $_.localPort } else { $_.remotePort }
} | Sort-Object -Unique)

$report = [ordered]@{
  checkedAt = (Get-Date).ToString("o")
  configuredPort = 49620
  scanPorts = $bridgePorts
  processCount = $mcpProcesses.Count
  listenerCount = @($mcpProcesses | Where-Object { $_.ports.Count -gt 0 }).Count
  singleton = ($mcpProcesses.Count -eq 1 -and @($mcpProcesses | Where-Object { $_.ports -contains 49620 }).Count -eq 1)
  connectedPorts = $connectedPorts
  processes = @($mcpProcesses)
  connections = $connections
  interpretation = if ($mcpProcesses.Count -eq 1 -and @($mcpProcesses | Where-Object { $_.ports -contains 49620 }).Count -eq 1) {
    "one MCP process owns configured port 49620"
  } else {
    "multiple MCP processes or fallback ports are present; do not treat a fallback live probe as the configured bridge"
  }
}

$report | ConvertTo-Json -Depth 8

if ($OutputPath) {
  $resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path (Get-Location) $OutputPath }
  $outputDirectory = Split-Path -Parent $resolvedOutput
  if ($outputDirectory) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
  Write-Host "Report: $resolvedOutput"
}

