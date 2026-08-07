[CmdletBinding()]
param(
    [ValidateSet('all', 'universal', 'integrated', 'rust', 'esp32', 'pcb')]
    [string]$Route = 'all',

    [switch]$Json
)

$ErrorActionPreference = 'Stop'

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
foreach ($entry in @($userPath -split ';' | Where-Object { $_ })) {
    if (-not (($env:Path -split ';') | Where-Object {
        $_.TrimEnd('\') -ieq $entry.TrimEnd('\')
    })) {
        $env:Path = "$entry;$env:Path"
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Resolve-ToolPath {
    param([Parameter(Mandatory)][string]$Command)

    $resolved = Get-Command $Command -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($resolved) {
        return $resolved.Source
    }

    foreach ($suffix in @('.cmd', '.exe', '.ps1', '')) {
        $candidate = Join-Path $repoRoot "node_modules\.bin\$Command$suffix"
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

$tools = @(
    @{ Name = 'git';             Command = 'git';             Route = 'universal';  Priority = 'required';    Note = '版本与回滚' }
    @{ Name = 'gh';              Command = 'gh';              Route = 'universal';  Priority = 'required';    Note = 'GitHub 搜索、release、issue/PR' }
    @{ Name = 'node';            Command = 'node';            Route = 'universal';  Priority = 'required';    Note = '现有 monorepo 与 Playwright CLI' }
    @{ Name = 'npm';             Command = 'npm';             Route = 'universal';  Priority = 'required';    Note = '现有 monorepo' }
    @{ Name = 'python';          Command = 'python';          Route = 'universal';  Priority = 'required';    Note = '硬件测试宿主' }
    @{ Name = 'rustc';           Command = 'rustc';           Route = 'universal';  Priority = 'required';    Note = '固定版本 Rust 固件编译器' }
    @{ Name = 'cargo';           Command = 'cargo';           Route = 'universal';  Priority = 'required';    Note = 'Rust workspace 构建与锁文件' }
    @{ Name = 'rustup';          Command = 'rustup';          Route = 'universal';  Priority = 'required';    Note = '工具链与跨架构 target 管理' }
    @{ Name = 'cmake';           Command = 'cmake';           Route = 'universal';  Priority = 'recommended'; Note = '自研固件构建' }
    @{ Name = 'ninja';           Command = 'ninja';           Route = 'universal';  Priority = 'recommended'; Note = '快速构建' }
    @{ Name = 'clang-format';    Command = 'clang-format';    Route = 'universal';  Priority = 'recommended'; Note = 'C/C++ 格式化' }
    @{ Name = 'rg';              Command = 'rg';              Route = 'universal';  Priority = 'recommended'; Note = 'SDK/日志检索' }
    @{ Name = 'git-lfs';         Command = 'git-lfs';         Route = 'universal';  Priority = 'optional';    Note = '不可再生大型二进制' }
    @{ Name = 'uv';              Command = 'uv';              Route = 'universal';  Priority = 'recommended'; Note = 'Python 环境与锁文件' }
    @{ Name = 'playwright-cli';  Command = 'playwright-cli';  Route = 'universal';  Priority = 'recommended'; Note = '供应商网页证据' }
    @{ Name = 'ffmpeg';          Command = 'ffmpeg';          Route = 'universal';  Priority = 'recommended'; Note = '音频转换与分析' }
    @{ Name = 'ffprobe';         Command = 'ffprobe';         Route = 'universal';  Priority = 'recommended'; Note = '音频元数据门' }
    @{ Name = 'ffplay';          Command = 'ffplay';          Route = 'universal';  Priority = 'recommended'; Note = '家长端真实预听自然结束回调' }
    @{ Name = 'sigrok-cli';      Command = 'sigrok-cli';      Route = 'universal';  Priority = 'later';       Note = 'UART/SPI/I2S 捕获' }
    @{ Name = 'probe-rs';        Command = 'probe-rs';        Route = 'rust';       Priority = 'route-only';  Note = '目标芯片冻结后的烧录调试与 RTT/defmt' }
    @{ Name = 'espup';           Command = 'espup';           Route = 'esp32';      Priority = 'route-only';  Note = 'ESP32-S3 Xtensa Rust 工具链' }
    @{ Name = 'espflash';        Command = 'espflash';        Route = 'esp32';      Priority = 'route-only';  Note = 'Espressif Rust 串口烧录' }
    @{ Name = 'eim';             Command = 'eim';             Route = 'esp32';      Priority = 'route-only';  Note = 'ESP-IDF 安装管理' }
    @{ Name = 'idf.py';          Command = 'idf.py';          Route = 'esp32';      Priority = 'route-only';  Note = '构建、烧录、监视、MCP' }
    @{ Name = 'esptool';         Command = 'esptool';         Route = 'esp32';      Priority = 'route-only';  Note = 'ESP 芯片烧录/交互' }
    @{ Name = 'openocd';         Command = 'openocd';         Route = 'esp32';      Priority = 'route-only';  Note = 'JTAG/SWD 调试' }
    @{ Name = 'kicad-cli';       Command = 'kicad-cli';       Route = 'pcb';        Priority = 'route-only';  Note = 'ERC/DRC/生产文件' }
    @{ Name = 'kibot';           Command = 'kibot';           Route = 'pcb';        Priority = 'route-only';  Note = 'KiCad 自动交付包' }
)

$selected = if ($Route -eq 'all') {
    $tools
} elseif ($Route -eq 'integrated') {
    $tools | Where-Object { $_.Route -in @('universal', 'integrated') }
} else {
    $tools | Where-Object { $_.Route -in @('universal', $Route) }
}

$results = foreach ($tool in $selected) {
    $resolved = Resolve-ToolPath -Command $tool.Command
    [pscustomobject]@{
        Name     = $tool.Name
        Route    = $tool.Route
        Priority = $tool.Priority
        Status   = if ($resolved) { 'ready' } else { 'missing' }
        Path     = if ($resolved) { $resolved } else { '' }
        Note     = $tool.Note
    }
}

$pythonModules = @(
    @{ Name = 'python:pytest';          Import = 'pytest';           Route = 'universal'; Priority = 'required';   Note = '硬件验收框架' }
    @{ Name = 'python:pyserial';        Import = 'serial';           Route = 'universal'; Priority = 'recommended'; Note = '串口测试与 miniterm' }
    @{ Name = 'python:pytest-embedded'; Import = 'pytest_embedded';  Route = 'esp32';     Priority = 'route-only';  Note = 'ESP-IDF 真机/QEMU 测试' }
)

$selectedModules = if ($Route -eq 'all') {
    $pythonModules
} elseif ($Route -eq 'integrated') {
    $pythonModules | Where-Object { $_.Route -eq 'universal' }
} else {
    $pythonModules | Where-Object { $_.Route -in @('universal', $Route) }
}

$projectPython = Join-Path $repoRoot 'hardware\tests\.venv\Scripts\python.exe'
$pythonPath = if (Test-Path -LiteralPath $projectPython) {
    (Resolve-Path -LiteralPath $projectPython).Path
} else {
    Resolve-ToolPath -Command 'python'
}
foreach ($module in $selectedModules) {
    $moduleReady = $false
    if ($pythonPath) {
        & $pythonPath -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('$($module.Import)') else 1)"
        $moduleReady = ($LASTEXITCODE -eq 0)
    }

    $results += [pscustomobject]@{
        Name     = $module.Name
        Route    = $module.Route
        Priority = $module.Priority
        Status   = if ($moduleReady) { 'ready' } else { 'missing' }
        Path     = if ($moduleReady) { $pythonPath } else { '' }
        Note     = $module.Note
    }
}


if ($Json) {
    $results | ConvertTo-Json -Depth 3
    exit 0
}

$results | Sort-Object Route, Priority, Name | Format-Table -AutoSize

$requiredMissing = @($results | Where-Object {
    $_.Status -eq 'missing' -and $_.Priority -eq 'required'
})

Write-Host ''
Write-Host ("Route: {0}; ready: {1}/{2}; required missing: {3}" -f `
    $Route,
    @($results | Where-Object Status -eq 'ready').Count,
    $results.Count,
    $requiredMissing.Count)

if ($requiredMissing.Count -gt 0) {
    exit 1
}
