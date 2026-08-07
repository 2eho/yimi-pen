[CmdletBinding()]
param(
  [string]$OutputDirectory = "build/evt0-host-audio"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$codesPath = Join-Path $root "hardware/evt0/golden-24/codes.json"
$output = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory
} else {
  Join-Path $root $OutputDirectory
}
$output = [IO.Path]::GetFullPath($output)
$buildRoot = [IO.Path]::GetFullPath((Join-Path $root "build")) + [IO.Path]::DirectorySeparatorChar
if (-not ($output + [IO.Path]::DirectorySeparatorChar).StartsWith($buildRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDirectory must resolve inside $buildRoot"
}

$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
$codes = Get-Content -LiteralPath $codesPath -Raw -Encoding utf8 | ConvertFrom-Json

if ($codes.entries.Count -ne 24) {
  throw "Expected exactly 24 golden entries"
}

if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Path $output -Force | Out-Null

$artifacts = [System.Collections.Generic.List[object]]::new()

foreach ($entry in $codes.entries) {
  $slot = [int]$entry.slot
  $variants = if ($entry.codecPlan -eq "MP3") {
    @("mp3")
  } elseif ($entry.codecPlan -eq "WAV_PCM16") {
    @("wav")
  } else {
    @("wav", "mp3")
  }

  for ($clipIndex = 1; $clipIndex -le [int]$entry.clipCount; $clipIndex++) {
    foreach ($variant in $variants) {
      $frequency = 320 + ($slot * 19) + ($clipIndex * 3)
      $baseName = "clip-{0:D3}-{1:D2}-host" -f $slot, $clipIndex
      $target = Join-Path $output "$baseName.$variant"
      $common = @(
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "sine=frequency=$frequency`:duration=0.45",
        "-af", "afade=t=in:st=0:d=0.01,afade=t=out:st=0.40:d=0.05",
        "-map_metadata", "-1", "-ac", "1"
      )
      $codec = if ($variant -eq "wav") {
        @("-ar", "16000", "-c:a", "pcm_s16le")
      } else {
        @("-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", "-write_xing", "0")
      }

      & $ffmpeg @common @codec $target
      if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for $target" }

      $probeRaw = & $ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -show_entries format=duration -of json $target
      if ($LASTEXITCODE -ne 0) { throw "ffprobe failed for $target" }
      $probe = $probeRaw | ConvertFrom-Json
      $file = Get-Item -LiteralPath $target
      $artifacts.Add([ordered]@{
        slot = $slot
        logicalOid = $entry.logicalOid
        clipIndex = $clipIndex
        profile = if ($variant -eq "wav") { "HOST_WAV_PCM_S16LE_16K_MONO" } else { "HOST_MP3_CBR_128K_44K1_MONO" }
        path = $file.Name
        bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        codec = $probe.streams[0].codec_name
        sampleRate = [int]$probe.streams[0].sample_rate
        channels = [int]$probe.streams[0].channels
        durationSeconds = [double]$probe.format.duration
        frequencyHz = $frequency
      })
    }
  }
}

$versionLine = (& $ffmpeg -version | Select-Object -First 1)
$manifest = [ordered]@{
  schemaVersion = 1
  fixtureId = "yimi-evt0-host-audio"
  status = "HOST_ONLY_NOT_TARGET_RELEASE"
  generatedAt = (Get-Date).ToString("o")
  generator = $versionLine
  source = "hardware/evt0/golden-24/codes.json"
  artifactCount = $artifacts.Count
  artifacts = $artifacts
}

$manifestPath = Join-Path $output "manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Host "Generated $($artifacts.Count) deterministic host audio artifacts"
Write-Host "Manifest: $manifestPath"
