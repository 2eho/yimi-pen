# 嵌入式开发工具、CLI 与 MCP 选型（2026-07-26）

> 适用范围：Gen1 EVT-0 单件目标样机。当前首选是近期量产一体主板/OID 套件；
> `ESP32-S3` 自研板仍是条件分支。本文只选择能减少构建、烧录、日志、测试、
> 音频、制板和资料核验摩擦的工具，不用工具热度替代主板/光头/固件证据。
>
> **2026-08-03 路线更新：** 益米自研固件主体已冻结为 Rust。本文件保留早期
> 工具调查；固件框架结论以 [`rust-firmware-feasibility-2026.md`](./rust-firmware-feasibility-2026.md)
> 为准。ESP-IDF/ESP-GMF 只作为 Rust app 的底层 C BSP/媒体组件候选。

## 0. 结论

1. **CLI 优先，MCP 补充。** 编译、烧录、串口采集、音频检查、ERC/DRC 和 CI
   都应先有可复现 CLI；MCP 只在它能提供项目上下文或持久会话时接入。
2. **一体主板路线的第一工具不是 PlatformIO 或 Zephyr，而是供应商 SDK/CLI。**
   若供应商只给 Windows GUI、不给命令行构建/烧录、日志接口和版本映射，自动化
   只能停留在 UART/USB/声学黑盒验收，属于主板锁定风险。
3. **当前立即有价值的最小工具箱：** 已安装的 `gh`、`git`、`rg`、
   `CMake/Ninja`；待补的 `uv + pytest + pyserial`、`FFmpeg/ffprobe`，以及网页资料
   核验用的 Playwright CLI。
4. **若正式进入 ESP32-S3 分支：** 先比较 `esp-hal` 裸机 Rust 与
   `ESP-IDF/ESP-GMF + Rust app`；后者通过 `esp-idf-sys/hal` 或窄 C ABI 复用媒体链，
   两条路线用同一 HIL 向量决定。
5. **若正式进入自研 PCB 分支：** 采用 KiCad 10 的 `kicad-cli`、KiBot 和
   InteractiveHtmlBom；KiCad MCP 先只做读取、连通性分析和 ERC/DRC，不让它直接
   主导原理图或 PCB 编辑。
6. GitHub 上仍没有可直接承担现代 OID 光头协议、码生成、印刷工具和量产固件的
   开源底座；工具链不能替代供应商交付物。

## 1. 选型约束

| 约束 | 对工具选择的影响 |
|------|------------------|
| EVT-0 与目标产品同架构、同版本 | 不用开发板专属框架替换目标主板 SDK |
| 主板/SoC 尚未冻结 | 调试器、RTOS、烧录器和编译器必须延后到 MPN 明确后 |
| OID 光头与码工具通常成套 | 串口工具只能观察协议，不能补齐码制授权/生成器 |
| 本地离线点读和 `<200 ms` P95 | 必须保留设备时间戳、串口日志、逻辑分析和音频起播测量 |
| 单件采购但质量门不降低 | 测试先用 pytest；多工位/小批量后再升级 OpenHTF/labgrid |
| Windows 主工作站 | 优先选择 Windows 可运行、可脚本化、可锁版本的 CLI |

## 2. 当前工作站快照

以下是 2026-07-26 的本机探测结果；用
[`scripts/check-embedded-tools.ps1`](../../scripts/check-embedded-tools.ps1) 复查。

### 2.1 已具备

| 工具 | 当前状态 | 立即用途 |
|------|----------|----------|
| Git `2.48.1` | 已安装 | 版本与回滚边界 |
| GitHub CLI `2.67.0` | 已安装并登录 | 仓库/代码/issue/release 搜索与下载 |
| Node `22.23.1` / npm `10.9.8` | 已安装 | 当前 monorepo、Playwright CLI |
| Python `3.12.9` / pytest | 已安装 | 后续硬件测试宿主 |
| CMake `4.4.0` / Ninja `1.13.2` | 已安装 | 自研固件构建底座 |
| Clang / clang-format | 已安装 | C/C++ 格式化与宿主侧检查 |
| Git LFS `3.6.1` | 已安装 | 必要时管理不可再生的大型二进制；当前可再生音频仍忽略 |
| ripgrep `15.2.0` | 已安装 | SDK、数据手册和日志快速检索 |
| uv `0.11.32` | 已安装并加入用户 PATH | `hardware/tests` 隔离环境与 `uv.lock` |
| pytest `9.1.1` / pyserial `3.5` | 已锁定在项目 `.venv` | 无板串口 loopback 已通过，等待实机夹具 |
| FFmpeg/ffprobe `8.1.2` | 已安装并加入用户 PATH | 16kHz 单声道 WAV 生成和元数据 smoke test 已通过 |
| Playwright CLI `0.1.17` | 根 `package-lock.json` 精确锁定 | `example.com` 打开、快照和关闭 smoke test 已通过 |

版本、来源和 SHA-256 见
[`hardware/tools/phase-a-toolchain.lock.json`](../../hardware/tools/phase-a-toolchain.lock.json)。

### 2.2 路线锁定前继续不安装

| 工具 | 何时安装 |
|------|----------|
| `sigrok-cli` / PulseView | 主板到货且暴露 UART/SPI/I2S 测点后 |
| EIM、`idf.py`、`esptool`、OpenOCD | 仅在 ESP32-S3 分支正式入场后 |
| `kicad-cli`、KiBot | 仅在自研 PCB 分支正式入场后 |
| PlatformIO、Zephyr `west`、Arduino CLI | 有明确框架收益和目标支持证据后；当前不作为必装项 |

当前 Codex 已登记 `easyeda-mcp-pro 0.35.4`，通过本机
`127.0.0.1:49620` 连接嘉立创EDA Pro 3.2.149；初始 scope 只开放诊断、原理图、
BOM、ERC/DRC 和 PCB 读取。固定版本、检查命令与发布目录见
[`docs/jlceda-codex.md`](../jlceda-codex.md)。

## 3. CLI 工具分层

### 3.1 现在采用

| 工具 | 决策 | 具体用途 |
|------|------|----------|
| [`gh`](https://cli.github.com/manual/) | **主用** | `gh search code/repos`、`gh api`、release 下载、issue/PR、CI 日志 |
| [`uv`](https://github.com/astral-sh/uv) | **采用** | 为 `hardware/tests` 创建隔离且可锁版本的 Python 环境；替代全局 pip 堆包 |
| [`pytest`](https://github.com/pytest-dev/pytest) | **采用** | 读码、起播时延、按键、电量、断电恢复和 1,000 次循环验收 |
| [`pyserial`](https://github.com/pyserial/pyserial) | **采用** | Windows 串口枚举、收发和 `python -m serial.tools.miniterm` 日志 |
| [`FFmpeg`](https://github.com/FFmpeg/FFmpeg) | **采用** | `ffprobe` 元数据门、转码、响度/静音/截断检查和黄金音频生成 |
| [Playwright CLI](https://github.com/microsoft/playwright-cli) | **采用** | 供应商页面证据、下载链接、截图和网页流程；比浏览器 MCP 更节省上下文 |
| PowerShell + npm scripts | **继续使用** | 先统一仓库入口；等固件命令稳定后再决定是否增加 `just` |

Playwright 项目明确建议编码代理优先使用 CLI + skills；MCP 更适合需要持久浏览器
上下文和反复页面推理的长会话。

### 3.2 主板到货后采用

| 工具 | 决策 | 用途/边界 |
|------|------|-----------|
| 供应商 Build/Flash CLI | **锁板硬门** | 无交互构建、烧录、校验、返回码、批处理和工具版本封存 |
| `sigrok-cli` / PulseView | **推荐** | UART/SPI/I2S/OID 事件时间线、触发捕获和协议解码 |
| [Saleae Logic 2 Automation](https://github.com/saleae/logic2-automation) | **预算允许时** | 更稳定的自动采集和导出；与 Saleae 硬件绑定 |
| pytest + pyserial | **主验收** | 一台设备的自动化与原始日志留存 |
| [OpenHTF](https://github.com/google/openhtf) | **后移** | EVT/DVT 或小批量工位的测量上下限、附件和 DUT 记录 |
| [labgrid](https://github.com/labgrid-project/labgrid) | **后移** | 多设备、远程电源/复位/串口和共享实验室；单桌面样机阶段偏重 |

### 3.3 ESP32-S3 后备分支

| 工具/组件 | 决策 | 理由 |
|-----------|------|------|
| [ESP-IDF](https://github.com/espressif/esp-idf) `v6.0.x` | **底层 BSP 候选** | Rust app 通过 `esp-idf-sys/hal` 或窄 C ABI 复用驱动、构建、烧录和诊断能力 |
| [EIM](https://github.com/espressif/idf-im-ui) | **主安装器** | ESP-IDF 6.0 起 Windows 旧安装器已被 EIM 取代；可运行 `eim` CLI |
| [ESP-GMF](https://github.com/espressif/esp-gmf) `v1.0` | **C ABI 音频候选** | 与 Rust app 做窄适配和差分测试；是否进入产品由 RAM、首音和掉电 HIL 决定 |
| [`esp_audio_simple_player`](https://github.com/espressif/esp-gmf/tree/v1.0/packages/esp_audio_simple_player) | **优先 PoC** | 点读笔只需本地索引后快速起播，不先引入完整复杂媒体服务 |
| [pytest-embedded](https://github.com/espressif/pytest-embedded) | **采用** | 提供 serial/esp/idf/jtag/qemu/wokwi 服务和自动烧录/日志断言 |
| [idf-ci](https://github.com/espressif/idf-ci) | **采用** | 官方的多目标构建、变更过滤、pytest 和 GitHub Actions 矩阵 |
| Espressif QEMU | **只测可模拟逻辑** | ESP32-S3 已有目标支持，但 OID 光学、I2S 功放、SD 卡时序和声学仍须真机 |
| [PlatformIO espressif32](https://github.com/platformio/platform-espressif32) | **可选外壳** | 当前平台版本已支持 IDF 6.0.1；仍以原生 IDF 项目为真源 |
| [Zephyr](https://github.com/zephyrproject-rtos/zephyr) | **暂缓** | 多平台优势当前抵不过 Espressif 音频组件、官方测试与 MCP 的直接收益 |
| Arduino CLI | **暂缓** | 适合快速样例，不作为产品固件的默认构建和版本真源 |

ESP-ADF `v2.8` 仍是成熟音频框架，但其公开兼容表到 ESP-IDF 5.5；ESP-GMF 文档
说明未来会替换 ADF 的 `audio_pipeline`，并已支持 ESP-IDF 6.0。因此若我们要同时
使用 IDF 6.0 的官方 MCP，新项目先验证 `ESP-IDF 6.0.x + ESP-GMF 1.0` 的堆内存、
SD 卡起播和 P95 时延，不为 MCP 单独牺牲已验证的固件稳定性。

### 3.4 自研 PCB 分支

| 工具 | 决策 | 用途 |
|------|------|------|
| [KiCad 10](https://www.kicad.org/) / [`kicad-cli`](https://docs.kicad.org/10.0/en/cli/cli.html) | **采用** | ERC、DRC、BOM、Gerber、钻孔、坐标、STEP/STL 和无头渲染 |
| [KiBot](https://github.com/INTI-CMNB/KiBot) | **采用** | 用配置文件一次生成审查与生产交付包 |
| [InteractiveHtmlBom](https://github.com/openscopeproject/InteractiveHtmlBom) | **采用** | 单件手贴/返修和供应商装配核对 |
| KiCad MCP | **先只读** | 连接追踪、器件/网络查询和 ERC/DRC 汇总；人工审阅所有写入 |

KiCad 10 CLI 已覆盖原理图 ERC/BOM 和 PCB DRC、Gerber、位置、STEP、统计及渲染，
这些确定性命令应先进入 CI。Seeed 的 KiCad MCP 自身也把原理图编辑标为实验性，并
建议 GUI 负责设计、MCP 负责分析与验证。

## 4. MCP 采用矩阵

| MCP | 时机 | 结论 | 推荐配置 |
|-----|------|------|----------|
| 嘉立创EDA Pro MCP | 现在 | **已接入只读** | `core` + `diagnostics/schematic/bom/checks/pcb:read`；仅回环地址，不启用原始执行、写入和下单 |
| [GitHub MCP Server](https://github.com/github/github-mcp-server) | 现在 | **值得接入** | 先用 `repos,issues,pull_requests,actions` 且只读；写操作继续由 `gh`/Git 明确执行 |
| ESP-IDF 官方 MCP | ESP32 分支 | **强推荐** | ESP-IDF 6.0+ 的 `idf.py mcp-server`；负责 target/build/flash/clean/create |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | 特殊网页会话 | **条件使用** | 日常代理优先 CLI；只有需要持久页面状态和结构化探索时启用 MCP |
| [serial-mcp-server](https://github.com/Adancurusul/serial-mcp-server) | 主板到货 | **小范围试用** | 固定 COM 口/波特率；先 `list-ports` 和 macro plan，再允许写入、RTS/DTR |
| [Seeed KiCad MCP](https://github.com/Seeed-Studio/kicad-mcp-server) | 自研 PCB | **只读试用** | 仅分析、网表追踪、ERC/DRC、代码骨架；不自动提交编辑结果 |
| GDB/OpenOCD/J-Link MCP | MCU/探针锁定后 | **暂缓** | 生态小且常暴露任意调试命令；先用 GDB/OpenOCD/J-Link CLI 和脚本 |

### 4.1 GitHub MCP 的边界

官方服务器支持 toolset 白名单和只读模式。对本项目最合理的是：

- 资料检索和 issue/PR/Actions 状态可交给 MCP；
- 供应商二进制、固件 release 和数据手册仍用 `gh release download`/`gh api`
  下载后计算哈希；
- 初始使用细粒度、只读凭据；不把 token 写入仓库；
- 现有 `gh` CLI 已登录，因此 GitHub MCP 是便利层，不是阻塞项。

### 4.2 ESP-IDF 官方 MCP 的真实能力

ESP-IDF `v6.0` 已内置 `idf.py mcp-server`，公开工具包括：

- set target；
- build project；
- flash project；
- clean project；
- create project；
- 读取项目配置、构建状态/产物和已连接设备。

它目前不是完整串口/调试替代品；持续日志仍使用 `idf.py monitor`、pyserial 或经过
限制的串口 MCP，断点和寄存器调试仍由 GDB/OpenOCD/J-Link CLI 完成。

## 5. 一体主板供应商的工具交付硬门

任何 `BOARD_TARGET + OID_TARGET_HEAD` 候选都必须回答以下工具问题：

1. SDK/IDE/编译器准确名称、版本、许可、下载地址和 SHA-256；
2. 是否提供无交互 build CLI，能否指定工程、配置、输出目录并返回非零错误码；
3. 是否提供 flash CLI，能否枚举设备、整片/分区烧录、读回校验和批处理；
4. 开机/升级/崩溃日志从 UART、USB CDC 还是专有接口输出，时间戳在哪里生成；
5. 是否有板号、PCB revision、主控 revision、光头 revision 与固件版本映射表；
6. OID 码生成、页面排版、音频打包和资源下载工具是否有 CLI 或稳定文件格式；
7. 是否提供最小可构建工程、固件升级/回滚包、驱动和离线安装包；
8. Windows 11、自动化调用、并行设备和后续量产烧录是否属于正式支持范围。

若只提供 GUI，候选仍可做功能样机，但在 `bom-lock.csv` 中必须记录
`AUTOMATION_RISK=GUI_ONLY`，不能把“可以手动烧一次”当作可维护的同版量产工具链。

组创公开方案页只列出 `ZC3205L`、存储和 `95500` 等硬件组合，没有公开 SDK/CLI
说明；GitHub 对 `ZC3205L`、`ZC95303`、`ZC7648` 和组创域名的定向代码/仓库搜索
也没有得到可用的官方开发包。因此供应商工具交付必须进入询价和样品锁定门。

## 6. GitHub 上的 OID 结论

| 项目 | 当前证据 | 结论 |
|------|----------|------|
| [labrick-lib/TalkingPen](https://github.com/labrick-lib/TalkingPen) | 5 stars；最后代码推送 2015-12-08；旧固件/音频打包结构 | 只参考历史装包思路，不作 Gen1 底座 |
| [DreamXLong/OIDPen](https://github.com/DreamXLong/OIDPen) | 仅 19 字节 README 和流程图，无代码/SDK | 不可用 |
| 现代 OID4/第四代完整栈 | 未找到主板 MPN、光头 MPN、协议、码生成器和量产工具齐全的仓库 | 继续依赖供应商证据和实物测试 |

这与既有 [GitHub 技术调研](./github-survey-2026.md) 和
[OID 主板/代际复核](./oid-board-generation-survey-2026.md) 一致。

## 7. 最小落地顺序

### Phase A：现在，不等主板

**状态：2026-07-26 已完成。**

1. `gh` 继续作为 GitHub 调研和 release 取证主入口；GitHub MCP 仍不是阻塞项。
2. `uv 0.11.32` 已安装；`hardware/tests/uv.lock` 锁定 pytest/pyserial，串口 loopback 通过。
3. FFmpeg/ffprobe `8.1.2` 已安装，音频生成和元数据检查通过。
4. `@playwright/cli 0.1.17` 已在根 package lock 精确锁定，浏览器 smoke test 通过。
5. ESP-IDF、Zephyr、PlatformIO、KiCad MCP 和 GDB MCP 仍未安装。

日常入口：

```powershell
npm run tools:doctor
npm run test:hardware
npx playwright-cli --help
```

### Phase B：一体主板样品到货

1. 先封存供应商 SDK/CLI/驱动/示例的版本和哈希；验证 build/flash/log 可脚本化。
2. 建立 `pytest + pyserial` 黑盒夹具，记录 `tap -> board timestamp -> audio start`。
3. 使用逻辑分析仪和 `sigrok-cli` 捕获 UART/SPI/I2S；避免把人工听感当时延证据。
4. 需要代理直接读串口时，再以固定端口、只读优先方式试用 serial MCP。

### Phase C：一体主板失格后才进入 ESP32-S3

1. 固定 Rust、`espup/espflash`、ESP-IDF 与 Cargo.lock，分别建立裸机 Rust 和 Rust-on-IDF 最小工程。
2. 用同一音频/存储向量比较 `esp-hal` 路径与 ESP-GMF 窄 C ABI 路径。
3. 接入 HIL、`pytest-embedded`/等价夹具和 C/Rust 差分，再选择唯一运行时。
4. 目标 PCB 仍由嘉立创EDA专业版和既定评审流程完成。

## 8. 推荐的下一动作

Phase A 已完成。下一动作是把“build/flash/log/码生成 CLI”作为硬门，筛选并单买
两套同 `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION` 的近期一体主板/OID 套件；
到货当天直接扩展现有 pytest/pyserial 夹具，不再先搭另一套开发板路线。
