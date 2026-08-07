# Firmware · 益米笔 Rust 固件

益米自研固件主体使用 Rust。当前 workspace 只实现目标无关的 `no_std`
产品核心和主机一致性测试；芯片 HAL、RTOS、烧录配置与 FFI 进入
`BOARD_TARGET / BOARD_MPN / PCB_REV` 通过证据门后创建的板级 port。

深度调研与证据索引：

- [`docs/research/rust-firmware-feasibility-2026.md`](../docs/research/rust-firmware-feasibility-2026.md)
- [`hardware/evt0/rust-firmware-evidence.json`](../hardware/evt0/rust-firmware-evidence.json)
- [`hardware/evt0/firmware-readiness-matrix.csv`](../hardware/evt0/firmware-readiness-matrix.csv)

## 1. 当前 workspace

```text
firmware/
  Cargo.toml
  Cargo.lock
  crates/
    yimi-fw-contract/       # OID事件、DeviceLink状态、错误码和身份类型
    yimi-snapshot-core/     # stage/verify/activate/boot rollback状态机
    yimi-device-link-core/  # 分块、durable offset、幂等、CAS、abort/rollback
    yimi-runtime-core/      # allocation-free ExecutionModel、逐action冷却、播放计划与WeightedRandom v2
    yimi-platform-ffi/      # C ABI raw边界与安全Rust适配器
    yimi-fw-host/           # 主机交叉检查与Snapshot/DeviceLink transcript adapters
  abi/
    yimi_platform_v1.h      # 板级C/BSP提供者合同
    yimi_platform_mock.c    # 主机独立编译的C参考mock
  boards/                   # 板级证据冻结后再增加精确 port
```

四个目标无关产品核心 crate 同时满足：

- `#![no_std]`；
- `#![forbid(unsafe_code)]`；
- 无芯片、操作系统和执行器依赖；
- 主机单元测试；
- `thumbv7m-none-eabi` 与 `riscv32imac-unknown-none-elf` 可移植性编译哨兵。

这两个 target 只证明核心代码不依赖宿主环境，不代表 MCU 选型。

## 2. 量产架构边界

```text
BOARD_TARGET 原生 BSP / RTOS
  ├─ C：OID SDK、codec、I²S/DMA、存储、USB、Bootloader
  ├─ board port：窄 C ABI、回调/线程/ISR/缓冲区生命周期
  └─ Rust：OID索引、播放决策、Snapshot、DeviceLink、状态机和诊断
```

板级 `unsafe` 统一收口到可审计 FFI raw 模块；精确 port 只负责实现同一 C 合同，
并进入独立 C/Rust 差分测试。当前唯一 `unsafe` 边界集中在
[`yimi-platform-ffi/src/raw.rs`](crates/yimi-platform-ffi/src/raw.rs)，核心 crate
保持纯安全 Rust。

`Platform` handle 不实现 `Clone`、`Copy`、`Send`、`Sync`，除只读元数据外的调用
均要求 `&mut Platform`；C `acquire/release` 以原子或中断安全临界区保证 provider
唯一取得。因此一个板级任务独占一个 handle，C ISR 只入队，不与 Rust 产品逻辑
并发操作 provider。OID sequence、累计 dropped counter 和 queue stats 共同封存丢
事件证据。

## 3. 互斥运行时路线

| 目标板证据 | 运行时路线 |
|---|---|
| OpenVela/NuttX BSP 与媒体链通过 | OpenVela 调度器 + Rust staticlib/app + C ABI |
| ESP-IDF BSP 与媒体链通过 | FreeRTOS/ESP-IDF + Rust app + `esp-idf-*`/窄 FFI |
| 裸机 Rust HAL 全链路通过 | 芯片 HAL + Embassy 或 RTIC（二选一） |
| 仅有封闭播放器/内容工具 | 保留为成熟产品或黑盒参考 |

OpenVela、ESP-IDF 与 Embassy executor 属于替代路线，而非叠加运行时。

## 4. OID 适配边界

板级 adapter 把真实光头/主板事件归一为：

```rust
pub struct PhysicalCodeEvent {
    pub physical_code: Option<PhysicalCode>,
    pub event_at: MonotonicUs,
    pub sensor_at: Option<MonotonicUs>,
    pub ready_at: Option<MonotonicUs>,
    pub quality: Option<u16>,
    pub status: OidStatus,
    pub sequence: u32,
    pub dropped_events: u32,
}
```

供应商未暴露的阶段保持 `None`。物理码和时间戳在 JSON 证据中使用十进制
字符串，设备核心使用 `u64`。

## 5. C/Rust 交叉验证

同一块同 revision 板依次运行供应商 C 参考路径和 Rust 产品路径，输入完全相同的：

- 24码、空白区、错码和低质量事件；
- WAV/MP3与坏文件；
- USB分块、重复请求、断连和掉电；
- Snapshot校验、激活与回滚；
- 低电、存储错误和重启。

比较归一化事件、状态迁移、动作/音频选择、错误码、首音时延和原始 trace。
结果按 [`TestResult v1`](../hardware/evt0/test-result-v1/README.md) 保存。
`request-accepted` 只作诊断；固件输出 P95 使用首个 PCM、DMA/I²S 首 buffer 或
electrical-output 时间，声学 P95 使用外部仪器。

主机合同先使用同一组
[`platform-ffi-v1/golden-vectors.json`](../hardware/evt0/platform-ffi-v1/golden-vectors.json)
分别检查 Node 语义、独立 C mock 与安全 Rust adapter。这里完成的是 ABI 和行为
合同闭环；实物板仍以两块同 revision 样品的 C/Rust 原始 trace 为准。

Snapshot 生命周期另外使用
[`operation-transcript.json`](../hardware/evt0/snapshot-v1/operation-transcript.json)
驱动 Node 文件/A-B adapter 和 Rust `InstallMachine` adapter，逐场景比较 active、
last-good、generation、snapshot 与 error。此主机差分不替代目标存储介质掉电 HIL。

DeviceLink 使用
[`transaction-golden.json`](../hardware/evt0/device-link-v1/transaction-golden.json) 与
[`transaction-negative.json`](../hardware/evt0/device-link-v1/transaction-negative.json)
同时驱动 Node reference handler 和 Rust `yimi-device-link-core` adapter，比较 15 个
事务场景的逐步结果、失败零副作用和最终状态。Rust adapter 的 FileSpec 来自明确标注的
host manifest surrogate；目标板仍需用真实 Snapshot manifest parser、真实存储 sync、
真实传输重连与掉电 HIL 替换该 surrogate。

Snapshot 热路径使用
[`execution-model-v1`](../hardware/evt0/execution-model-v1/README.md) 的稳定字符串 key → 稠密
`ActionSlot/ClipSlot` 映射。`yimi-runtime-core` 只借用 parser 构建的只读表和调用方持有的
cooldown 状态，无分配地完成二分查找、逐 action 抑制、replace/queue/random_one 计划；随机
索引由组合根注入。Family Alpha、Golden-24 与非词法 order-trap 的 Node/Rust 完整结果逐字节
一致，并有 23 条对称负例。host surrogate 不代表真实 OID，板级 parser/encoding 与双板
C/Rust trace 仍单独取证。

加权选择由 [`weighted-random-v2`](../hardware/evt0/weighted-random-v2/README.md) 独立版本化：
`yimi-runtime-core::weighted_random_v2` 只接收正 `u32` 权重与调用方提供的原始 `u64` 词，使用
低端前缀拒绝和半开累计区间，无 RNG/HAL/RTOS 依赖。Node/Rust 6组黄金结果逐字节一致，12条负例
保持输出不覆盖。板卡组合根后续只实现 raw-word provider；其质量、双板 trace 和量产分布 receipt
仍由生产门验收。

## 6. 本机验证

项目固定 Rust `1.97.1`。当前主机已安装两个可移植性 target。
仓库 pin 保持 host-neutral；当前 Windows 开发机因未配置 MSVC linker，使用目录级
`1.97.1-x86_64-pc-windows-gnu` override，该本机选择不进入跨平台契约。

```powershell
npm run validate:firmware-contracts
npm run test:device-link-sim
npm run test:execution-model
npm run validate:rust-firmware
```

机器报告：

- `build/firmware-contract-validation.json`
- `build/rust-firmware-validation.json`

主机测试通过仍保持物理证据门开启；精确板卡的 build/flash/boot、OID、音频、
存储、USB与两机差分结果齐全后才创建目标板 port。
