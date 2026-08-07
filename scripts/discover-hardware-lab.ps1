[CmdletBinding()]
param(
  [string]$OutputPath = "build/hardware-lab-discovery.json"
)

$ErrorActionPreference = "Stop"

function Get-SafePnpDevices {
  $devices = @()
  try {
    $devices = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | ForEach-Object {
      [pscustomobject]@{
        class = $_.Class
        friendlyName = $_.FriendlyName
        instanceId = $_.InstanceId
        manufacturer = $null
        status = $_.Status
      }
    })
  } catch {
    $devices = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object {
      $_.Status -eq "OK"
    } | ForEach-Object {
      [pscustomobject]@{
        class = $_.PNPClass
        friendlyName = $_.Name
        instanceId = $_.DeviceID
        manufacturer = $_.Manufacturer
        status = $_.Status
      }
    })
  }
  return $devices
}

$knownInstrumentPattern = "Keysight|Agilent|Rigol|RIGOL|Siglent|OWON|Hantek|UNI-T|Fluke|Keithley|Tektronix|PicoScope|VISA|USBTMC|CP210|CH340|CH341|FTDI|Silicon Labs"
$candidateClasses = @("Ports", "Camera", "Image", "Media", "AudioEndpoint", "USBDevice")
$allPresent = @(Get-SafePnpDevices)
$candidates = @($allPresent | Where-Object {
  $_.class -in $candidateClasses -or
  $_.friendlyName -match $knownInstrumentPattern -or
  $_.manufacturer -match $knownInstrumentPattern
} | Sort-Object class, friendlyName, instanceId | ForEach-Object {
  [ordered]@{
    class = $_.class
    friendlyName = $_.friendlyName
    instanceId = $_.instanceId
    manufacturer = $_.manufacturer
    status = $_.status
    qualification = "UNQUALIFIED_PNP_DISCOVERY_ONLY"
  }
})

$serialPorts = @(Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue | Sort-Object DeviceID | ForEach-Object {
  [ordered]@{
    name = $_.Name
    deviceId = $_.DeviceID
    pnpDeviceId = $_.PNPDeviceID
    status = $_.Status
    qualification = "UNQUALIFIED_PORT_DISCOVERY_ONLY"
  }
})

$report = [ordered]@{
  schemaVersion = 1
  reportKind = "evt0-lab-pnp-discovery"
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
  host = [ordered]@{
    computerName = $env:COMPUTERNAME
    os = [System.Environment]::OSVersion.VersionString
  }
  visibility = "WINDOWS_PRESENT_PNP_AND_SERIAL_ONLY"
  candidates = $candidates
  serialPorts = $serialPorts
  qualificationEffect = "NONE_DISCOVERY_ONLY"
  interpretation = [ordered]@{
    candidateCount = $candidates.Count
    serialPortCount = $serialPorts.Count
    rule = "PnP or serial visibility is only a lead for manual inventory. It does not prove manufacturer, model, serial, calibration, accuracy, bandwidth, true-RMS behavior, USB-C measurement support, macro capability, or A-weighted SPL capability."
    absenceRule = "A device missing from this report may still be present but non-enumerating; inspect every physical LAB1-LAB6 item manually."
  }
}

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
$report | ConvertTo-Json -Depth 8
Write-Host "Report: $resolvedOutput"

