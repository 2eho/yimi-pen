# 嘉立创EDA Pro × Codex 研发接入

> 状态：本机stdio链路已完成，2026-08-04复检通过；共享HTTP隔离POC已通过，live迁移待维护窗口
> 适用工程：`D:\work\yimi-pen`

## 1. 研发链路

```text
Codex
  -> stdio MCP: easyeda-mcp-pro 0.35.4
  -> WebSocket: 127.0.0.1:49620
  -> 嘉立创EDA Pro 3.2.149 / MCP Pro Bridge 扩展
  -> 当前打开的原理图、PCB、BOM、ERC/DRC
```

GitHub 保存固件、EDA 导出快照、评审记录、制造发布包和版本清单；嘉立创EDA工程自身的版本节点继续承担设计过程版本管理。

## 2. 本机固定版本

| 项 | 当前值 |
|---|---|
| 嘉立创EDA Pro | `3.2.149` |
| MCP 服务 | `easyeda-mcp-pro 0.35.4` |
| MCP Node | `v24.18.1` 独立运行时 |
| MCP 传输 | `stdio` |
| EDA 桥接 | `127.0.0.1:49620` |
| 工具档位 | `core` |
| 权限 | `diagnostics:read, schematic:read, bom:read, checks:read, pcb:read` |

关键路径：

- 嘉立创EDA：`C:\Users\Admin\AppData\Local\Programs\lceda-pro\lceda-pro.exe`
- MCP：`C:\Users\Admin\.codex\tools\easyeda-mcp-pro\node_modules\easyeda-mcp-pro\dist\index.js`
- 扩展包：`C:\Users\Admin\Downloads\JLCEDA-Codex-Bridge\easyeda-bridge-extension-0.35.4.eext`
- Codex MCP 配置：`C:\Users\Admin\.codex\config.toml`

当前配置关闭原始执行、设计写入、JLCPCB 下单和无密钥器件查询。首阶段只进行读取、BOM/网络检查以及 ERC/DRC 评审。

## 3. 一键复检

从仓库根目录运行：

```powershell
npm run eda:doctor
```

命令会在需要时启动嘉立创EDA，并检查：

1. 固定版本的 Node 与 MCP 文件；
2. Codex 的 MCP 注册和只读 scope；
3. `49620` 仅监听回环地址；
4. 嘉立创EDA扩展与 MCP 的双向 TCP 连接；
5. 将机器可读结果写入忽略提交的 `build/jlceda-bridge-status.json`。

## 4. 共享HTTP隔离POC

共享HTTP的隔离回归可单独执行：

```powershell
npm run validate:eda-shared-http-poc
```

该命令只在`127.0.0.1:49642/49643`启动临时只读进程，验证双逻辑session、关闭隔离和stop/restart，
并核对现有`49620`连接、Codex配置、target-binding、BOM和采购计划前后一致。当前全局配置仍为stdio；
`49620/49630`真实共享服务、两个独立Codex task和完整回滚见
[POC证据报告](./research/jlceda-shared-http-poc-2026-08-04.md)，继续等待受控维护窗口。

## 5. 工程目录约定

```text
hardware/eda/
  source-export/       # 嘉立创EDA工程快照、原理图/PCB可审查导出
  reviews/             # ERC、DRC、BOM diff、网络与封装评审
  releases/<REV>/      # Gerber/ODB++、BOM、CPL、PDF、3D 与发布清单
  manifest.json        # EDA、桥接、BOM/板级版本基线
```

发布前顺序：创建嘉立创EDA版本节点，导出评审资料，执行 ERC/DRC 与 BOM diff，生成制造包和 SHA-256，再建立 Git tag。

当前设计入口由 [HardwareSystem v1](./hardware-system-architecture.md) 管理：
`BOARD_TARGET` 仍为 `UNRESOLVED`，因此先使用层级页、系统框图和接口标签；器件、
引脚、电源轨、连接器与 PCB layout 在 target binding 的证据门关闭后进入。

## 6. 与 OpenVela 的边界

嘉立创EDA负责电气和 PCB 设计；OpenVela属于目标运行时候选。是否采用 OpenVela 由最终主控、板级支持包、音频/OID 驱动和量产 SDK 决定，不由 EDA 工具决定。

本仓库当前还没有冻结 `BOARD_TARGET`。近期量产一体主板路线先验证供应商同版 SDK/运行时、Rust staticlib 或稳定 C ABI；自研分支比较 OpenVela/NuttX + Rust、ESP-IDF + Rust 与裸机 Rust 三条互斥路线。目标主控、驱动、音频/存储/USB与量产证据决定该硬件版本的系统基线。
