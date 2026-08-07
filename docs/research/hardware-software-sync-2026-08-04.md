# 硬件 / 软件双线接口同步（2026-08-04）

> 同步范围：硬件线程只读复核软件任务锚点与已落地合同，识别对硬件接口、测量、BSP 和发布门的影响；本次未修改软件源码、软件合同或运行时。

## 1. 当前两线状态

| 线别 | 最近完成 | 当前下一包 | 对另一线的意义 |
|---|---|---|---|
| 软件 | `SW-ASSET-VAULT-RECOVERY-01A` 已由owner收口，受控进程退出/重启验收70/70 | `SW-AUTHORING-PRODUCT-SHELL-01A` 已启动 | Recovery属于host资产生命周期；新包限定framework-neutral会话内核，当前均未形成硬件输入 |
| 硬件 | MB1 联系/回执、Lab 6槽位/7资产，以及 REF2 卖家原件合同/11项门/9项自检和 pending 工作区 | 真实 MB1 外发并取得书面回件；并行发送 REF2 请求 | 需要持续输出 OID 事件、目标存储、DeviceLink 物理传输、音频 profile、诊断/BSP 和电源/结构实测证据 |

软件当前权威进度来自 `docs/codex/tasks/system-product-rd/active-task.md`。硬件当前权威目标仍由
`docs/codex/active-task.md` 和 `hardware/evt0/hardware-system-v1/target-binding.json` 持有。

## 2. 本次软件增量的硬件影响判定

### `SW-AUTHORING-CAPTURE-ADAPTER-01`

- canonical 音频、FamilyRevision、预听和授权 Snapshot 均保持 target-neutral；
- DirectShow 设备名与主机路径停留在 companion adapter，不进入设备合同；
- 没有改变目标 codec、采样率、设备文件系统或传输协议；
- 硬件影响：`NONE`，无需更新 `target-binding`、adapter、BOM revision 或 EDA。

### `SW-ASSET-VAULT-MAINTENANCE-01`

- 已验收对象是家庭全部历史 revision 所引用的主机内容寻址资产；报告 21/21，SHA-256
  `c56e2acd468518334d8fb299ceb7d99aa0c4135f6c65b1ee810e067dc9b164df`；
- mark set、dry-run、保留期、orphan 删除、稳定引用租约和 quarantine rollback 属于 host repository/vault 边界；
- 设备安装后的 Snapshot/内容副本继续由 DeviceLink 与目标存储耐久合同承担；
- 报告明确 `deviceStorageGcIncluded=false`、`crossProcessWriterLeaseIncluded=false`；
- 当前硬件影响：`NONE`。若后续改变设备安装事务、设备端 GC 或跨进程设备写入，必须重新进入本同步门。

### `SW-FAMILY-WORKSPACE-COMPOSITION-01`

- 已把 repository、主机 asset vault、reference coordinator 和文件/录音来源端口集中到 App-local composition root；
- 不改变 Snapshot 字节、DeviceLink、目标存储、OID 事件、音频 profile 或 board adapter；
- 真实文件验收34/34，报告5,532 bytes、SHA-256
  `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`；
- owner收口边界为 `single-process-app-owned-directories`，没有新增设备端写入/存储假设；硬件影响：`NONE`。

### `SW-ASSET-VAULT-RECOVERY-01A`

- 计划在现有FamilyWorkspace唯一队列内增加版本化maintenance journal与startup recovery；
- 计划边界仍是主机vault的进程中断恢复；跨进程锁、真实介质掉电和设备端GC保持独立；
- 软件owner现已正式收口；报告70/70，14,616 bytes、SHA-256
  `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`，`valid=true`、`fixtureOnly=true`、
  `hardwareImpact=NONE`；
- 当前硬件影响：`NONE`。候选报告明确parent-directory fsync、cross-process writer、root replacement与physical
  power loss仍为独立门；若后续形成设备存储原子性、wear、A/B snapshot或DeviceLink新假设，再进入本同步门。

### `SW-AUTHORING-PRODUCT-SHELL-01A`（软件当前执行包）

- 当前只启动 framework-neutral source/permission/metadata/prelisten/confirmation 会话内核与端口；
- 复用FamilyWorkspace公开capability，文件/录音/TTS、UI框架、OS权限和provider/compiler仍由既有adapter/owner持有；
- 当前尚无正式验收报告，也没有codec、storage、USB、OID event、控制/状态、电源或结构新要求；
- 当前硬件影响：`NONE_IN_PROGRESS`。软件owner收口时，硬件线再次读取报告并按interface/adapter/test/ReleaseGate复算。

### `HW-BENCHMARK-SELLER-EVIDENCE-V1` 收口回读

- 硬件包只收集 `REF2` 同一待发消费品的卖家原始图像/视频、平台导出、bytes/SHA-256 和人工判定；
- `gate-catalog` 的 11 项门与连续视频绑定不新增设备接口、板级字段或产品运行时能力；
- 状态固定为 `targetBindingEffect=NONE_BENCHMARK_ONLY`、`adapterEffect=NONE`、
  `releaseGateEffect=NONE`、`purchaseAuthorizationEffect=NONE_HUMAN_DECISION_REQUIRED`；
- 后续软件owner已把FamilyWorkspace正式收口到34/34；当前权威报告为5,532 bytes、SHA-256
  `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`，边界仍为`hardwareImpact=NONE`；
- 收口软件影响：`NONE`。不更新 Snapshot、DeviceLink、Rust/C ABI、codec/storage/USB/OID event 或 board adapter。

### `HW-EDA-SHARED-HTTP-POC` 收口回读

- 隔离 `49642/49643` 上的单进程双逻辑session、关闭隔离、scope反证、独立runtime storage、stop/restart与保护态回归为31/31；第二校验器复算20/20；
- POC运行期间软件owner完成FamilyWorkspace 34/34正式收口，因此硬件关闭时重新读取owner anchor、capsule和报告；
- FamilyWorkspace没有触及MCP、JLCEDA bridge、端口、EDA工程或板级接口；对本包仍为 `NONE`；
- POC保持 `targetBindingEffect=NONE`、`adapterEffect=NONE`、`bomRevisionEffect=NONE`、
  `releaseGateEffect=NONE`、`globalCodexConfigEffect=NONE_NOT_APPLIED`；
- 真实 `49620/49630` 迁移、两个独立Codex task、真实EDA并发和stdio回滚继续
  `PENDING_CONTROLLED_MAINTENANCE_WINDOW`。

### `HW-MB1-SEND-PREFLIGHT-01` 收口回读

- 发送日再次复算 Ztron、春苗、Sonix FAE page/script 四项官方来源，4/4 bytes/SHA-256 与台账一致；
- 新增统一 preflight checker，三份待发工作区各25/25，隔离负向门4/4；它只验证 draft、冻结
  outbound tree、sourceRefs、官方 URL、空 raw 目录与正式 record 空位；
- 真实 receipt/submitted/response/READY_TO_BUY/accepted target 仍为0，状态保持
  `targetBindingEffect=NONE_CONTACT_ONLY` 与 `paymentEffect=NONE_AWAIT_VENDOR_RESPONSE`；
- 软件侧 Asset Vault Recovery 70/70 已正式收口；Authoring Product Shell处于启动执行期，当前两者对
  HardwareSystem、target-binding、board adapter、BOM、硬件测试、ReleaseGate与EDA transport的影响均为`NONE`；
- 因此本包只降低人工发送时的归档漂移风险，产品接口和硬件排序保持原值。

## 3. 两线共用但单一所有者不变的接口

| HardwareSystem 接口 | 软件消费边界 | 当前硬件证据状态 |
|---|---|---|
| `IF-OID-EVENT` | Rust `no_std` 执行核心接收稳定 OID 事件；板级 transport 由 adapter 提供 | `TARGET_EVIDENCE_PENDING` |
| `IF-STORAGE` | Snapshot/内容安装、原子激活、掉电恢复和回滚；软件语义稳定，介质实现由目标 adapter 提供 | `TARGET_EVIDENCE_PENDING` |
| `IF-USB-DATA` | DeviceLink 事务语义稳定；USB 模式、stream/framing 与错误恢复等实物证据由硬件线提供 | `TARGET_EVIDENCE_PENDING` |
| `IF-AUDIO-SIGNAL` | 软件输出逻辑播放事件；目标 codec/profile、开始时间戳和音频链由硬件线测量 | `TARGET_EVIDENCE_PENDING` |
| `IF-CONTROL` / `IF-STATUS` | 稳定控制与状态事件；电平、引脚和机械位置收敛到 board adapter | `TARGET_EVIDENCE_PENDING` |
| `IF-DIAGNOSTIC` | Rust BSP、窄 C ABI、build/flash/log、HIL 和 C/Rust 差分 | `TARGET_EVIDENCE_PENDING` |

这些接口继续由 HardwareSystem v1 单一持有。本同步记录只保存影响判定与路由，不复制 Schema、错误码或板级值。

## 4. 后续每包同步门

每个硬件工作包开始和结束时读取软件 active anchor，并只对下列变化触发硬件影响复排：

1. Snapshot 或设备内容 manifest 的字节/原子性合同变化；
2. DeviceLink framing、事务、恢复、带宽或物理传输假设变化；
3. 目标音频 codec/profile、最大文件、解码并发或首音时间戳要求变化；
4. OID 事件字段、队列、drop/sequence/timestamp 或时延预算变化；
5. Rust BSP、C ABI、日志、flash/debug、内存或中断边界变化；
6. 设备端资产回收、存储 wear、掉电一致性或 A/B snapshot 策略变化；
7. 新增会影响电池、热、无线、按键、状态灯或结构的产品用例。

触发后，变化只进入相应 `target-binding` interface、board adapter、BOM revision、intake/test 或
ReleaseGate。稳定 topology 与软件纯内核继续复用。

## 5. 当前同步结论

- 软件最近完成的Asset Vault Recovery及当前启动的Authoring Product Shell没有产生新的芯片、引脚、电源、连接器、PCB、结构或采购输入；
- HardwareSystem 现有 18 条接口已经覆盖软件所需的目标差异入口；
- `BOARD_TARGET` 和全部板级实现字段继续保持 `UNRESOLVED/PENDING`；
- Contact Receipt 的 receipt-bound/recipient-entry 加固只提升采购证据闭包，对软件输入仍为 `NONE`；
- Lab registration 新增的 `serialSource`、参考标准 artifact 和采集 workspace 只提升测量证据入口；
  它没有新增设备协议、目标存储、OID 事件或 board adapter 字段，对软件输入仍为 `NONE`；
- Benchmark Seller Evidence v1 只提升 REF2 付款前的实物身份资料质量；当前 request 仍为
  `PREPARED_NOT_SENT`，raw/records/complete 均为0，对软件输入仍为 `NONE`；
- Shared HTTP POC只提升EDA工具运行复用；没有读取或改写工程，真实迁移仍待维护窗口，对产品接口输入为`NONE`；
- 双线可以继续独立实现，但每包通过上述同步门交换版本化证据，而不是共享未冻结实现细节。

## 6. `HW-EDA-SYSTEM-SKELETON-V1` 收口同步

- 硬件线把现有 12 blocks / 36 logical ports / 18 interfaces 投影为确定性层级、逻辑接口登记、SVG预览和未执行写入计划；内容继续由 `hardware-system-v1/topology.json` 单一持有。
- 新包没有新增或冻结 codec、storage、USB、OID transport、音频链、电源、连接器、结构、BOM 或板级字段；`targetBindingEffect/adapterEffect/bomRevisionEffect/releaseGateEffect` 均为 `NONE`。
- 当前 EDA 计划记录 `nativeSourceGenerated=false`、`nativeExportGenerated=false`，接口在 SVG 中只用图形折线，在未来 EDA 页中只进入文字登记；它不会把逻辑 `IF-*` 提升为物理网络。
- 硬件收口期间出现 `companion-authoring-product-shell-validation/report.json` 31/31 候选报告，5,818 bytes、SHA-256 `c7c8cb54918dafe74210b31268c500c14012557bafddcfc7a9fec3f5e341189a`；其 `boundaries.hardwareImpact=NONE`、`boardTarget=UNRESOLVED`、`deviceDelivery=OUT_OF_SCOPE_EVIDENCE_PENDING`。
- 软件 owner anchor 的本次只读快照仍把 `SW-AUTHORING-PRODUCT-SHELL-01A` 标为执行中，因此硬件线把31/31先记为 `PENDING_OWNER_CLOSEOUT`；无论候选还是正式收口，它都没有改变 HardwareSystem、target binding、board adapter、BOM、硬件测试或 EDA transport。
- 产品壳用 FILE/CAPTURE 共用 source registry 和窄 FamilyWorkspace capability，进一步支持“新增来源只进 adapter”的系统方向；硬件仍只需提供既有 `IF-OID-EVENT / IF-STORAGE / IF-USB-DATA / IF-AUDIO-SIGNAL / IF-CONTROL / IF-STATUS / IF-DIAGNOSTIC` 实测证据。

## 7. `HW-EVIDENCE-CAPTURE-ADAPTER-V1` 收口同步

- 适配器只复制外部原始字节、复算 bytes/SHA-256、保存显式媒体/时间/URL/route 元数据，并生成不可变 capture index；不修改 Vendor Contact、Benchmark Seller、Lab Registry 或 Vendor Response owner record。
- 统一合同封闭四条 lane 的 route 与 ownerFragment；Benchmark fragment 完全匹配 owner artifact 字段，Lab route 必须绑定当前 draft 的唯一 instrument/asset，Vendor Response route 只接受五元组、`M01–M08`、`A01–A10` 和 draft sample set。
- copy 采用 request-relative normalized source、普通文件链检查、staging、`COPYFILE_EXCL` 独占 promotion、destination readback、owner/request 前后 hash 和受控 rollback；check 为只读 canonical-index 复算。
- 当前 validator 66/66、selftest 46/46，5 个准备 workspace 只读 preflight 通过；index commit race 仅在本次 `writeFile` 成功后建立 rollback witness，报告只写 `build/hardware-evidence-capture-validation.json` 与 `build/hardware-evidence-capture-selftest.json`。
- 软件线 System TTS Source Adapter 41/41 继续是只读输入，`hardwareImpact=NONE`、`BOARD_TARGET=UNRESOLVED`；没有新增 codec、storage、USB、OID event、board adapter、BOM、硬件 test、ReleaseGate 或 EDA transport。
- 真实 MB1 外发、REF2 卖家原件、Lab 实物登记和目标板/OID/电源/存储/声学/结构/HIL 证据仍在外部待办；本适配器不把准备态提升为事实态。

## 8. 当前只读同步：HW-FIXTURE-METHOD-GAP-EVIDENCE-AUDIT-V1

本节覆盖本硬件审计包重新读取到的最新软件owner状态；前文各节保留为历史快照，不作为当前软件状态替代。

- 软件owner父锚点：`docs/codex/tasks/system-product-rd/active-task.md`，当前
  SHA-256 `3161603ce8d7e59134b6b0ec7b7339a7e2d27573aa1c94508ada29d2fcc1198a`；
  desktop child锚点 `docs/codex/tasks/desktop-authoring-ui-adapter/active-task.md`，
  SHA-256 `2264078407a2afefe78b09ab4fadd04ac14f676383b5d39fd2990946d4a5e006`。
- 接受的正式报告：`build/companion-authoring-task-recovery-validation/report.json`，22/22，作为
  audit-time report，SHA-256 `7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`。
- 当前明确硬件影响报告：`build/companion-tts-source-adapter-validation/report.json`，SHA-256
  `7d6cb6dd3b4163920af212d7a88e1f8c8cda6e9aeb3e428f499c7e755e1b7202`；
  `hardwareImpact=NONE`、`boardTarget=UNRESOLVED`、`sessionCoreModified=false`、
  `familyWorkspaceModified=false`、`productionProviderQualified=false`、`offlineReady=false`。
- 桌面 authoring adapter 已完成；当前软件下一路由为 `SW-FAMILY-WORKSPACE-LIFECYCLE-01`。本次只读检查未发现 codec、storage、USB、OID event、control/status、电源、声学或结构新要求。
- 本硬件包只增加 `hardware/evt0/method-gap-evidence-v1/` 的官方来源快照、严格 manifest/schema、验证器和测试；不修改软件源码、软件owner memory、稳定 lab method catalog、accepted fixture、topology、target-binding、TestResult、evidence-capture 或 ReleaseGate owner。实际 `hardwareImpact=NONE`。
- 三个方法缺口的结果：USB 与 control/status 仅冻结 target-neutral skeleton；storage power-loss durability 继续 `KEEP_PENDING_MORE_PRIMARY_EVIDENCE`。所有 target-specific 参数、物理阈值与真实 HIL/掉电结果继续 `PENDING`。
## Latest read-only synchronization: HW-FIXTURE-METHOD-GAP-EVIDENCE-AUDIT-V1 revision 1.1.0

- The software parent anchor was read-only at `docs/codex/tasks/system-product-rd/active-task.md`, current SHA-256 `3161603ce8d7e59134b6b0ec7b7339a7e2d27573aa1c94508ada29d2fcc1198a`; the desktop child anchor was `docs/codex/tasks/desktop-authoring-ui-adapter/active-task.md`, SHA-256 `2264078407a2afefe78b09ab4fadd04ac14f676383b5d39fd2990946d4a5e006`.
- The accepted formal report remains an audit-time input: `build/companion-authoring-task-recovery-validation/report.json`, 22/22, SHA-256 `7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`; current validation uses report semantics rather than requiring this historical hash or task name.
- The current explicit hardware-impact report is `build/companion-tts-source-adapter-validation/report.json`, SHA-256 `7d6cb6dd3b4163920af212d7a88e1f8c8cda6e9aeb3e428f499c7e755e1b7202`; its boundaries remain `hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`, `sessionCoreModified=false`, `familyWorkspaceModified=false`, `productionProviderQualified=false`, and `offlineReady=false`.
- No codec, storage, USB, OID-event, control/status, power, acoustic or mechanical requirement was added to the software line. The hardware impact is `NONE`.
- Method-gap revision 1.1.0 retains all protected dependency identities as audit-time provenance and checks current owner/fixture semantic contracts plus live software boundaries. Its selftest rejects 30/31 mutations and accepts only one benign current-identity drift case. No software source or software-owner memory was modified; target-binding, TestResult, evidence-capture and ReleaseGate owners remain unchanged.

## 9. Current read-only synchronization: HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1

- The desktop authoring adapter is complete; the software parent next route is
  `SW-FAMILY-WORKSPACE-LIFECYCLE-01`. Current `hardwareImpact=NONE` and
  `BOARD_TARGET=UNRESOLVED`; no USB, storage, OID, codec, control/status,
  diagnostic or device-install constant entered the software line.
- This hardware package freezes only the target-neutral USB-data and
  control/status-HIL contract skeletons. Both IDs remain `PROPOSED_ONLY`, the
  storage power-loss proposal remains outside the package and pending, and all
  adapter/run target, physical, firmware, software-scenario, calibration,
  qualification and threshold fields remain null or `PENDING_EVIDENCE`.
- No software source or software-owner memory was written. The package uses
  live boundary semantics rather than software task names or hashes.

## 10. Current read-only synchronization: method-contract ownership refinement

- The desktop authoring report is read from
  `build/companion-desktop-authoring-task-validation/report.json` as the
  accepted desktop report, not as a recovery report or a historical newest
  report. Its current semantic record is `93/93`,
  `hardwareImpact=NONE`, `boardTarget=UNRESOLVED`, SHA-256
  `bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`.
- Parent and child software anchors remain read-only at SHA-256
  `0efb93463bc6b2a405acaa8d9e50d8742f35d2a6ff426e9cd721e2e4b8bbb6a2` and
  `3d88156f5c97c100132c0d487dc7948ec613aa56e39b7698afcef0405814edd7`.
  The explicit hardware-impact report is
  `build/companion-tts-source-adapter-validation/report.json`, SHA-256
  `f3f9dad07c7c710fd6bd03553c03e062ac4ad135522839b2bf510d52819708f0`, with
  `hardwareImpact=NONE`, `boardTarget=UNRESOLVED`,
  `sessionCoreModified=false`, `familyWorkspaceModified=false`,
  `productionProviderQualified=false`, `offlineReady=false`.
- The refinement changes only hardware-owned contract seams: the method
  adapter is method-scoped, the accepted fixture adapter owns generic target
  facts, and run/TestResult/raw-artifact ownership is explicit. No software
  scenario, firmware lane, DeviceLink contract, or hardware requirement was
  added to the software line.
- The current evidence-capture profile still has only
  `VENDOR_CONTACT`, `BENCHMARK_SELLER`, `LAB_REGISTRY`, and `VENDOR_RESPONSE`.
A HIL/raw-test lane is absent; the contract records
  `PENDING_OWNER_EXTENSION` with null lane/capture IDs rather than claiming
  HIL capture readiness. Hardware impact remains `NONE`.

## 11. Current read-only synchronization: method-contract storage closure

- The final contract seam keeps target-stable HIL route mappings in the
  method adapter, moves physical `PIN_MAPPING` to the accepted fixture
  adapter, and stores USB/HIL run inputs in exact method-scoped pending/null/
  empty slots. `SESSION_ID`, `TEST_RESULT_ID`, `RAW_EVIDENCE_INDEX` and
  `RELEASE_GATE_RECEIPT` resolve only to the existing lab/session, TestResult,
  evidence-capture and ReleaseGate paths. No software scenario or firmware
  lane is asserted.
- Contract validation is `38/38`, SHA-256
  `c87519784da436460aae3d163b919faa33cddc150a2cc1b264b585c43b51b491`;
  contract selftest baseline is `38/38` with `42/43` mutations rejected
  (one benign software task/hash progression accepted), SHA-256
  `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.
- Fixture remains `117/117` with `40/40` rejected mutations, and method-gap
  evidence remains `26/26` with `30/31` rejected mutations. These packages
  retain `hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`, `PROPOSED_ONLY`
  methods and storage `KEEP_PENDING_MORE_PRIMARY_EVIDENCE`.

## 12. Integrated verification refresh (read-only software)

- The latest accepted desktop authoring report is `93/93`, SHA-256
  `bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`, with
  `hardwareImpact=NONE` and `boardTarget=UNRESOLVED`. Parent and desktop child
  anchors are read-only at SHA-256
  `0efb93463bc6b2a405acaa8d9e50d8742f35d2a6ff426e9cd721e2e4b8bbb6a2` and
  `3d88156f5c97c100132c0d487dc7948ec613aa56e39b7698afcef0405814edd7`.
  The explicit hardware-impact report is SHA-256
  `f3f9dad07c7c710fd6bd03553c03e062ac4ad135522839b2bf510d52819708f0` and
  retains all-NONE/unresolved boundaries. No software `validate:full` run is
  claimed.
- Current ignored report hashes are contract validation
  `ced7167a1a915f75a5b46baaf47856cacef7547e826bc9be7e9c7cf6deae5c7e`,
  contract selftest `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`,
  fixture validation `d9633130235f735ae61a5087184c6337a4414f65431801a33fefa9a9056e05c4`,
  fixture selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`,
  method-gap validation `bd7664f45025362c88f8846ad1de338058cdd51440983dabd76004ecb98254d7`,
  and method-gap selftest `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`.

## 13. Current read-only synchronization: HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1

- The desktop authoring adapter remains accepted at `93/93`; the software
  parent route is `SW-FAMILY-WORKSPACE-LIFECYCLE-01`. Live semantic boundaries
  remain `hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`,
  `sessionCoreModified=false`, `familyWorkspaceModified=false`,
  `productionProviderQualified=false`, and `offlineReady=false`.
- No software source or software-owner memory was written. No codec, storage,
  USB, OID, control/status, diagnostic, power, acoustic or mechanical
  requirement entered this hardware package. Software task names and hashes
  are audit-time observations only, not canonical package gates.
- The hardware-owned package defines one proposed `HIL_RAW_TEST` lane and a
  strict pending capture-index template for the two existing proposed method
  IDs. The current four-lane evidence-capture profile, TestResult schema,
  fixture adapter, target binding and ReleaseGate owners remain unchanged.
- `acceptedInEvidenceCaptureProfile=false`,
  `captureRouteState=PENDING_OWNER_EXTENSION`, `BOARD_TARGET=UNRESOLVED`, and
  all effects are `NONE`; the template contains no artifact, result, physical,
  target, calibration or qualification record.

- HIL lane closeout reports: validation 36/36 SHA-256 `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; selftest baseline 36/36 with 41/43 rejected mutations and two benign cases accepted, SHA-256 `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`.

- Integrated hardware reports at close: fixture validation 117/117 `eac8f8fd2faab8821113d60b2108b6a143f1036a5bdb144e2887a2f1e57bde01`, fixture selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`; method-gap validation 26/26 `1f323663bd81eec6d579a3c56fe27cf6652326ce2124c2203a6f729f6623fc8b`, selftest `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`; contract validation 38/38 `b30f263ed46382c7307058c3a4d114c2321b4e95b5aedf8940b5bf6f5f53459`, selftest `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.

- Final integrated report refresh: fixture validation 117/117 `eac8f8fd2faab8821113d60b2108b6a143f1036a5bdb144e2887a2f1e57bde01`; fixture selftest `9df0d71eb489deab08ff78753d4154f57299ceda0aeaed99f8360503aa2e201e`; method-gap validation 26/26 `1f323663bd81eec6d579a3c56fe27cf6652326ce2124c2203a6f729f6623fc8b`; method-gap selftest `b9d9f88cd61901006749b59b413fcd7609ac2d69f76d8d6b2640ac47b7e78a44`; contract validation 38/38 `b30f263ed46382c7307058c3a4d114c2321b4e95b5aedf8940b5bf6f5f53459`; contract selftest `2c3834a1d9d16406977ac66c141f36165b6246d283c2d40d7ac5c02826953252`.

## Maintenance-decoupling repair

- Removed root `package.json` from strict implementation identities. Package-owned schemas, template, README and two scripts remain byte/SHA locked.
- Added semantic npm wiring checks: exact validator/selftest commands and one ordered placement in `validate:hardware-rd` immediately after the fixture-method-contract pair.
- Targeted validator: 36/36; selftest baseline 36/36 with 41/43 rejected mutations and 2 benign cases (unrelated npm script addition and software route progression) accepted.
- Validation report SHA-256: `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; selftest report SHA-256: `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`.
