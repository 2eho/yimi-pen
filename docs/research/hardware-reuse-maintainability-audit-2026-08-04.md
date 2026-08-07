# HardwareSystem v1 硬件复用与可维护性审计（2026-08-04）

> 审计类型：静态、只读的架构与证据链审计。本文不把模板、网页摘要或主机合同
> 当作实物通过证据，也不重新声明任何 `PENDING` 字段已经完成。
>
> 审计结论：**稳定拓扑 → 接口绑定 → EDA 禁入门已形成可校验的合同；
> `target-binding → BOM/revision → intake/lab → release receipt` 尚未形成完整、
> 可追溯的单一事实源闭环。** 当前最准确的状态是“复用骨架已实现，目标实物与
> 变更归因闭环尚未实现”，而不是“硬件系统已冻结”。

## 1. 范围、方法与当前事实

本审计读取以下当前工作树文件：

- [HardwareSystem v1 架构](../hardware-system-architecture.md) 与
  [Gen1 EVT-0 基线](../hardware-gen1-p0.md)；
- [`hardware-system-v1`](../../hardware/evt0/hardware-system-v1/) 的拓扑、
  target binding、Schema 和说明；
- [BOM 锁定台账](../../hardware/evt0/bom-lock.csv)、
  [board/OID intake](../../hardware/evt0/intake-v1/)、
  [lab v1](../../hardware/evt0/lab-v1/)、
  [board-port 证据包](../../hardware/evt0/board-port-evidence-v1/) 与
  [ReleaseGate v1](../../hardware/evt0/release-gates-v1/)；
- [证据源清单](../../hardware/evt0/evidence-sources.json)、
  [候选矩阵](../../hardware/evt0/board-evidence-matrix.csv)、
  [采购计划](../../hardware/evt0/purchase-plan.csv) 和
  [物理 release evidence 目录](../../hardware/evt0/release-evidence/)。

| 事实 | 当前可复核证据 | 状态 |
|---|---|---|
| 稳定逻辑分块 | `topology.json` 有 12 个 block、18 条唯一接口、14 个需求引用；端点语义由同一文件定义。 | `IMPLEMENTED` |
| 拓扑与绑定一致性 | `target-binding.json` 固定 `topologyRef.sha256=98a87a…c4e5f`；本次静态比对为 18/18 接口精确覆盖，所有 observation/test/gate 引用均存在。 | `IMPLEMENTED` |
| 目标板状态 | `targetIdentity.state=UNRESOLVED`；18/18 interface binding 都是 `TARGET_EVIDENCE_PENDING`，EDA 只允许 `SYSTEM_SKELETON_ONLY`。 | `CORRECTLY_BLOCKED` |
| 实物 intake | `intake-v1/records/` 当前不存在；只有两个 `PENDING` 模板。 | `NO_PHYSICAL_RECORD` |
| BOM 锁定 | `bom-lock.csv` 共 13 行：0 `LOCKED`、9 `BLOCKED`、4 `CANDIDATE`。 | `NOT_RELEASED` |
| 可复用测试方法 | `lab-v1` 有 9 个方法、仪器登记模板和会话模板；没有实测会话。 | `TEMPLATE_ONLY` |
| 发布证据 | ReleaseGateCatalog 有 34 门（15 host、17 physical、2 production）；`release-evidence/` 没有 `*.receipt.json`。 | `CATALOG_ONLY` |
| 一手资料台账 | `evidence-sources.json` 有 25 条来源，含 11 条 `SRC-OID-*`；可用条目记录 URL、HTTP 状态、字节数、SHA-256、claim scope 与物理验证门。 | `REFERENCE/RFQ_ONLY` |

`docs/hardware-system-architecture.md` 记录的 “402/402” 是该文档所述的历史
验证结果；本审计未把它当作本轮运行结果或物理证据。

## 2. 稳定分块到证据的映射

| 链路层 | 唯一或主要事实所有者 | 已有防漂移机制 | 当前缺口与审计判断 |
|---|---|---|---|
| 稳定功能块与端口 | [`topology.json`](../../hardware/evt0/hardware-system-v1/topology.json) | JSON Schema、拓扑自哈希、唯一 block/port/interface 校验；绑定引用同一拓扑 SHA-256。 | **强。** 板型变化不需要改写 12 个逻辑职责；但架构文档中的 18 接口表是人工副本，当前人工比对一致，尚未由生成步骤约束。 |
| 版本化接口合同 | `topology.json` 的 `topologyId` + `target-binding.json` 的 `topologyRef` | 绑定漂移会被 SHA-256 检出；端点方向、语义和全覆盖由 `validate-hardware-system.mjs` 校验。 | **部分强。** 拓扑身份可版本化，但接口没有单独的兼容性/弃用策略，文档副本也没有机器对照。 |
| 目标绑定 | [`target-binding.json`](../../hardware/evt0/hardware-system-v1/target-binding.json) | `intakeSelector` 固定到 `MB1-CANDIDATE-A`、两套样品和 `ACCEPTED_BOARD_TARGET`；未解析目标会禁止芯片级 EDA。 | **选择器已实现，目标事实未产生。** 它没有 `bomRevision`、`adapter`、`owner` 或 receipt 引用字段。 |
| 采购/BOM | [`bom-lock.csv`](../../hardware/evt0/bom-lock.csv) | `BLOCKED/CANDIDATE/LOCKED`、`no_substitute` 与阻塞证据文本；硬件 README 规定替料应新 revision。 | **台账存在，revision 合同不存在。** CSV 没有 `bom_revision`、目标五元组、行哈希、审批/变更记录或到 binding/intake 的机器引用。 |
| 来料 | [`board-oid-kit.template.json`](../../hardware/evt0/intake-v1/board-oid-kit.template.json) | Schema、关键字段/测试完整性检查、`ACCEPTED_BOARD_TARGET` 需要两件样品、清零 blocker。 | **模板强，实物为空。** 每件样品未分别记录五元组；artifact 仅是字符串引用，未由 intake 校验文件存在性、字节数或 SHA-256。 |
| 实验室与测试 | [`method-catalog.json`](../../hardware/evt0/lab-v1/method-catalog.json) | 9 个可复用方法、仪器角色和原始工件要求；模板明确未知值保持 `PENDING`。 | **方法目录可复用，记录链未落地。** 不存在会话 Schema/records 目录；现有 validator 只验证模板和方法/仪器 ID，不扫描实际会话。 |
| 板级 port/adapter | [`board-port-evidence-v1/README.md`](../../hardware/evt0/board-port-evidence-v1/README.md) 与拓扑中的 `TARGET-BOARD-ADAPTER` | 供应商材料清单和两板执行顺序；`IF-DIAGNOSTIC` 已引用一部分 C/Rust 证据。 | **仍是说明，不是可版本化 adapter 工件。** 没有 `adapterId/revision/path/interface coverage`，不能从当前 target 追到唯一 BSP/FFI/测试实现。 |
| 发布判定 | [`release-gates-v1/catalog.json`](../../hardware/evt0/release-gates-v1/catalog.json) | 物理/生产 gate 拒绝 synthetic evidence，receipt Schema 要求 subject revision、artifact 路径、大小和 SHA-256。 | **门目录强，绑定弱。** `target-binding` 只校验 gate ID 存在；其 `FROZEN`/`CHIP_LEVEL_READY` 状态没有被当前硬件验证器同 receipt/BOM PASS 联动。 |

## 3. 哪些变更已经被收敛，哪些只停在命名层

| 变更类别 | 已经收敛的位置 | 对应来料/测试入口 | BOM 对应项 | 当前结论 |
|---|---|---|---|---|
| 一体主板、OID 头、PCB/FW 五元组 | `targetIdentity.intakeSelector`、`IF-OID-EVENT`、`IF-BOARD-MECHANICAL`、`IF-DIAGNOSTIC` | `boardMpn`、`pcbRev`、`headMpn`、`headRev`、`firmwareVersion`、`KIT-IDENTITY` | `MB1`、`M1` | 已有“换板不改稳定拓扑”的入口；没有已接受 record、BOM revision 或实际 adapter。 |
| 存储方案 | `IF-STORAGE` | `storage`、`storageDurabilityContract`、`KIT-STORAGE-POWERLOSS`、`KIT-OFFLINE` | `SD1` | 接口和测试命名已收敛；BOM/target binding 没有机器交叉引用。 |
| 音频/扬声器/声腔 | `IF-AUDIO-SIGNAL`、`IF-AUDIO-POWER`、`IF-AUDIO-ACOUSTIC` | `audioPath`、`audioTimestampClass`、`KIT-AUDIO-TIMESTAMP`、`KIT-LATENCY` | `U2`、`SP1` | 逻辑边界正确；声学和目标结构均未产生实物记录。 |
| USB、充电、电芯、供电 | `IF-USB-DATA`、`IF-USB-POWER`、`IF-BATTERY-POWER`、`IF-BOARD-POWER` | `usbData`、`powerPath`、`KIT-POWER` | `B1`、`U3`、`U4`、`U5`、`J1` | 接口分层完整；电源数值/连接器/实测均仍锁定。 |
| 机械包络与人机 | `IF-HEAD/BOARD/USB/USER-IO-MECHANICAL` | `boardDimensions`、`headMechanical`、`KIT-IDENTITY` | `MB1`、`M1`、`J1`、`ENC1` | 可定位受影响接口；没有 CAD revision、安装基准或结构测试结果的版本化 owner。 |
| OID 工具与印刷 | `IF-OID-OPTICAL`、ReleaseGate `RG-OID-*` | `codeTool`、`printProfile`、`KIT-24CODE`、`KIT-NEGATIVE` | `M1`（头）；没有印刷/码工具 BOM 或 revision 实体 | 工具/印刷的 gate 已命名；尚没有可封存的工具、profile、印刷批次和 physical-map 工件。 |

## 4. 已证实的漂移和单一事实源缺口

### P0：`J1` 的身份在基线与 BOM 中冲突

[`docs/hardware-gen1-p0.md` §4.2](../hardware-gen1-p0.md) 将 `J1` 写为“存储”；
[`bom-lock.csv`](../../hardware/evt0/bom-lock.csv) 将 `J1` 定义为
`usb_c_connector`，而 `SD1` 才是 `storage_32gb`。这会使采购、测试与接口影响
分析指向不同物料，是当前已观察到的直接漂移。应在任何采购或模板实例化前消除，
并增加一个由 BOM 生成/校验基线表中 Ref 的检查。

### P0：BOM-REV-A 是文档目标，不是当前机器事实

基线和硬件 README 都要求 `BOM-REV-A` 与目标板/图纸一起冻结，但 CSV 标头只有
`item_id`、子系统、MPN、数量、状态和阻塞文本。它没有 revision ID、目标五元组、
target-binding SHA、source/artifact hash、批准者或替料影响接口。因此“换件只改 BOM
revision”还没有可验证的落点；目前只能靠人工同步 CSV、文档和 binding。

### P0：两套同版的证明模型不足以逐件复算

`intake-v1/schema.json` 中每个 `samples[]` 只含 `sampleId`、可为 `null` 的
`serialNumber/lot` 和字符串 `artifactRefs`；全局 observations 才保存五元组。当前
`validate-evt0-intake.mjs` 对 accepted record 主要检查样品**数量**、字段非
`PENDING`、测试状态和 blocker，不检查两个 sample 的非空/唯一序列号、各自五元组、
artifact 文件存在性或 hash。故“两个相同 revision”是流程意图，尚不是数据模型硬
约束。

### P1：接口到 intake 的反向影响分析不完整

binding 正确引用了 25/36 个 observation 和 16/20 个 test；未被任何接口 binding
引用的项为：

- observations：`abiLayoutProbe`、`ffiConcurrencyContract`、`firmwareVersion`、
  `halOrOs`、`oidQueueEvidence`、`providerOwnership`、`rustExecutionRoute`、
  `rustTargetTriple`、`rustToolchain`、`supplyEvidence`、`vendor`；
- tests：`KIT-PROVIDER-OWNERSHIP`、`KIT-QUEUE-OVERFLOW`、`KIT-RUST-REPRO`、
  `KIT-SUPPLY`。

accepted intake 会全局要求这些关键字段，但它们没有指向受影响的稳定接口或 target
identity。结果是“某个 ABI/队列/工具链/供货事实变化后该重跑什么”无法由 binding
自动得出。`IF-DIAGNOSTIC` 和 target identity 是最自然的归属候选。

### P1：adapter、实验室记录和 release receipt 之间没有可追溯接缝

`TARGET-BOARD-ADAPTER` 是稳定拓扑中的正确收敛点，但 target binding Schema 不含
adapter 相关字段；board-port 包也只有 README。与此同时，lab 只有模板，且实际
session 没有 Schema、method catalog hash 或 binding/BOM ref。Release receipt Schema
反而已经具备 artifact 字节数、SHA-256 与 evidence subject revision 的严谨模型，
却没有被 intake、lab 或 target binding 引用。重复建字符串 `artifactRefs` 会导致
三套证据索引漂移。

### P2：完成门的测量粒度仍主要保存在文字中

Gen1 基线要求头/印刷矩阵、负样、邻区、P50/P95/P99、声压、续航、温升、跌落和耐久
的明确重复次数与阈值。当前 `KIT-24CODE`、`KIT-NEGATIVE`、`KIT-LATENCY` 是正确的
稳定测试 ID，但 intake test Schema 的 `result` 是任意 JSON，`artifactRefs` 是字符串；
`RG-OID-TWO-HEAD-TWO-PRINT-MATRIX-PASSED` 只要求通用 `oid-matrix` artifact role。
还没有一个与 `TestResult v1`/lab method revision 绑定、可自动复算这些完成门的硬件
acceptance profile。

### P2：一手资料台账可检测在线漂移，但没有本地归档/版本 owner

`evidence-sources.json` 记录了来源、全局 `retrievedAt`、字节数和 SHA-256；
`refresh-hardware-evidence.mjs` 会复查 `SRC-OID-*` 的在线响应。清单没有每条资料的
版本字段或本地原始归档路径，且当前工作树中没有将这些 source bytes 作为受控工件的
目录。因此它很适合作为“网页漂移报警”，还不足以单独证明可离线复算的供应商资料
版本。

## 5. 缺少责任/版本 owner 的事实清单

这里的“owner”指能唯一定位和批准某类工程事实的工件/角色，不从现有模板推断人名。

| 事实 | 当前所在位置 | 当前 owner 证据 | 缺少的 owner/键 |
|---|---|---|---|
| `BOARD_TARGET` 五元组 | binding selector + board-kit template | selector 指向候选；没有实际 record。 | 每件样品五元组、串号、批次、照片/日志 hash 及 intake disposition signer。 |
| BOM 发布与替料 | `bom-lock.csv` | 行级 `lock_state` 和文本 blocker。 | `BOM_REV_ID`、binding/identity ref、行 hash、变更原因、批准和受影响接口/测试 owner。 |
| 板级 adapter | topology block、board-port README | 只有逻辑职责和供应商清单。 | `BOARD_ADAPTER_ID/REV`、实现路径、BSP/ABI/toolchain hashes、覆盖接口与 HIL receipt。 |
| 实测会话 | `lab-v1` 模板 | 模板有 `operator` 字段，但没有实际 session。 | session record ID、method-catalog ref/hash、仪器序列号、raw artifact manifest、BOM/target identity ref。 |
| OID 工具/印刷批次 | intake observations、`RG-OID-*` | 名称、预期观测和 gate ID。 | tool/profile revision、命令/输入/输出 hash、印刷批次/工艺 ID、physical-map owner。 |
| 发布判定 | catalog 与空 `release-evidence/` | catalog owner 与 receipt Schema 已存在。 | 物理 producer 生成的 non-synthetic receipt 集，以及它们与 target binding/BOM revision 的双向引用。 |

## 6. 按收益重新排序的建议

分数按当前任务定义的六项权重估算：关键路径解锁 30、证据就绪度 20、实物闭环距离 20、
复用收益 10、时间/成本 10、返工风险 10。它们是下一步选择的透明依据，不是已完成
证据。

| 排名 | 工作包 | 30 | 20 | 20 | 10 | 10 | 10 | 总分 | 建议交付 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | **WP-H01：取得 MB1 的两套同五元组资料与实物，并创建真实 intake records** | 30 | 15 | 20 | 10 | 6 | 10 | **91** | 供应商书面回件、两件实物、原始照片/日志和 `ACCEPTED/REJECTED` 结论；若任一不符立即拆 candidate。 |
| 2 | **WP-H02：建立 BOM revision ↔ target binding ↔ receipt 的单一链接，并先修复 `J1` 漂移** | 24 | 20 | 5 | 10 | 8 | 10 | **77** | 一个可哈希的 BOM revision manifest；CSV 作为导出或受该 manifest 校验；引用五元组、binding SHA、物料 source 与受影响接口。 |
| 3 | **WP-H03：补强 intake 的逐样品身份、artifact hash 与完整影响映射** | 22 | 20 | 5 | 10 | 9 | 10 | **76** | 每 sample 的五元组/serial/lot/raw artifact manifest；把 11 个 observation 和 4 个 test 映射至 `IF-DIAGNOSTIC` 或 target identity；复用 EvidenceReceipt artifact 结构。 |
| 4 | **WP-H04：将 lab 会话和完成门变成可复算记录合同** | 20 | 18 | 10 | 10 | 8 | 10 | **76** | session Schema/records 目录、method catalog hash、仪器/环境/原始文件 hash，以及可复算的 OID、时延、声学、电池 acceptance profile。 |
| 5 | **WP-H05：在 MB1 冻结后建立 board-adapter manifest** | 14 | 15 | 0 | 10 | 8 | 10 | **57** | 仅为已确认板型建立 adapter ID、BSP/FFI/toolchain 与接口覆盖；不在目标未解析时猜芯片或引脚。 |

`WP-H01` 是当前收益最高的下一硬件任务；`WP-H02` 可在等待供应商/到货期间并行完成，
因为它不决定任何器件参数，只消除既有事实漂移与后续重复维护。

## 7. 立即需要的外部动作与保持锁定项

1. 向 MB1 候选供应方发送现有 board-port 证据包，要求两套同
   `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION` 的完整套件、供货书面
   说明、码工具/印刷资料、C build/flash/log 路径和至少 24 码/空白对照资料；收到前
   保持 `BOARD_TARGET=UNRESOLVED`。
2. 到货后先登记实验仪器的真实型号、序列号和自检/校准，再做身份封存、限流上电和
   两头两印刷批次测试；所有原始工件保留为可哈希文件，不用汇总文字替代。
3. 在上述证据通过前，保持 `MB1`、`M1`、`SD1`、`B1`、`SP1`、`J1`、`ENC1` 和
   自研 PCB 分支的现有 `BLOCKED/CANDIDATE` 状态；不产生芯片级原理图、引脚、电源数值、
   连接器或 PCB layout 事实。
