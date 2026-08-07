# HW-REUSABLE-TEST-FIXTURE-ARCHITECTURE-V1：硬件可复用测试夹具证据审计

> 日期：2026-08-04
>
> 范围：只审计现有项目事实，并给出可实施的版本化架构建议；本子任务交付文档，schema/代码进入后续独立工作包。
>
> 关键状态：`BOARD_TARGET=UNRESOLVED`；18/18 interface binding=`TARGET_EVIDENCE_PENDING`；`eda.readiness=SYSTEM_SKELETON_ONLY`。

## 1. 审计结论

1. 项目已经拥有三层可复用证据基础：
   - `lab-v1` 的六个仪器槽位、七类实物资产、登记/校准/自检原件要求；
   - 九个带 procedure、recordFields、仪器引用和来源引用的 lab method；
   - `TestResult v1`、ReleaseGate catalog、以及 `HW-EVIDENCE-CAPTURE-ADAPTER-V1` 的原始字节、SHA-256、状态和防提升规则。
2. 当前缺口不是“再建一套 lab/session/evidence-capture owner”，而是缺少一条独立版本化接缝：
   `stable fixture backplane capability -> target adapter -> existing session/TestResult/raw evidence`。
3. `topology.json` 已定义稳定逻辑接口，`target-binding.json` 已定义目标证据门，但二者之间没有 `FIXTURE_PROFILE_ID/REV`、`TARGET_ADAPTER_ID/REV`、物理夹具实例身份、校准原件引用和 session/raw 绑定合同。
4. 推荐最小集合为 **7 个 operational capability family + 1 个 cross-cutting evidence envelope，共 8 项**。七个 operational family 覆盖现有 18 条 interface；其中 USB data、存储掉电耐久、控制/状态的独立 method coverage 仍有明确缺口，空引用仍标为缺口，不计入已完成能力。
5. 任何电压、电流、pin、connector、pogo 位置和机械尺寸均保持 `PENDING/UNRESOLVED`。稳定夹具只描述抽象能力、槽位、证据引用和状态；精确值只能由完整五元组及原始证据驱动的 target adapter 持有。

## 2. 已读取输入与交叉映射

| 输入 | 本次审计用途 | 关键机器事实 |
|---|---|---|
| [`docs/codex/active-task.md`](../codex/active-task.md) | 硬件 owner 边界、当前包、稳定模块保护、下一步排序 | `HW-EVIDENCE-CAPTURE-ADAPTER-V1` 已收口；真实 raw/response/physical records 仍为零；MB1 真实发送是最高外部动作 |
| [`docs/codex/current-context.md`](../codex/current-context.md) | 双线只读同步与软件输入快照 | `BOARD_TARGET=UNRESOLVED`；HardwareSystem 425/425；软件影响保持 `NONE` |
| [`docs/codex/index.md`](../codex/index.md) | 当前 task route、已有 owner 索引和证据目录 | 硬件线与软件线隔离写入、同步读取；Lab/Evidence Capture owner 已存在 |
| [`docs/codex/tasks/system-product-rd/active-task.md`](../codex/tasks/system-product-rd/active-task.md) | 只读同步软件线最新正式增量 | System TTS Source Adapter 41/41，`hardwareImpact=NONE` |
| [`docs/hardware-gen1-p0.md`](../hardware-gen1-p0.md) | EVT-0 等价性、目标五元组、物理/功能/可靠性门 | 目标主板、OID 头、固件、存储、电源、音频和结构必须由证据锁定 |
| [`docs/hardware-system-architecture.md`](../hardware-system-architecture.md) | 稳定拓扑、18 条接口、target adapter 和 EDA 入口 | 逻辑边界已冻结；芯片级器件、pin、connector、物理网络和 layout 仍在门后 |
| [`hardware/evt0/hardware-system-v1/topology.json`](../../hardware/evt0/hardware-system-v1/topology.json) | 12 block、36 logical port、18 interface 的唯一事实源 | `topologyId` 已版本化；稳定拓扑保持目标无关，目标实现留在 binding/adapter |
| [`hardware/evt0/hardware-system-v1/target-binding.json`](../../hardware/evt0/hardware-system-v1/target-binding.json) | 18 条 interface 的 observation/test/gate 影响映射 | 18/18=`TARGET_EVIDENCE_PENDING`；target identity=`UNRESOLVED`；EDA=`SYSTEM_SKELETON_ONLY` |
| [`hardware/evt0/lab-v1/method-catalog.json`](../../hardware/evt0/lab-v1/method-catalog.json) | 九个可复用测试方法和仪器槽位引用 | `LAB-SETUP-001` 到 `TARGET-BATTERY-001` 共 9 个 method；缺项保持 `PENDING` |
| [`hardware/evt0/lab-v1/registration-capture-plan.json`](../../hardware/evt0/lab-v1/registration-capture-plan.json) | 仪器槽位、实物资产、身份与资格原件边界 | 6 个槽位、7 类资产；`qualificationEffect=NONE_PREPARATION_ONLY` |
| [`hardware/evt0/lab-v1/session.template.json`](../../hardware/evt0/lab-v1/session.template.json) | 现有测量会话入口和 owner 边界 | 只有 `TEMPLATE/PENDING` 模板；含目标五元组、环境、仪器、methodResults、rawArtifactRoot 和 artifacts |
| [`hardware/evt0/test-result-v1/schema.json`](../../hardware/evt0/test-result-v1/schema.json) | 原始点读/时延结果合同 | 15 个必填顶层字段；`PENDING/SYNTHETIC/MEASURED` 状态与 raw/sample/queue/stage 约束完整 |
| [`hardware/evt0/release-gates-v1/catalog.json`](../../hardware/evt0/release-gates-v1/catalog.json) | ReleaseGate 证据类别、producer、artifact role 和 synthetic 边界 | catalog 共 34 个 gate；物理 gate 的 `allowSyntheticEvidence=false` |
| [`hardware/evt0/evidence-capture-v1/profile.json`](../../hardware/evt0/evidence-capture-v1/profile.json) | 外部原始字节采集和 owner route 边界 | 4 条 lane；复制、readback、hash、immutable index 和 rollback 已有合同，效果全部为采集/只读 |
| [`hardware/evt0/purchase-plan.csv`](../../hardware/evt0/purchase-plan.csv) | 目标套件、实验室资产、到货验收和 purchase gate | MB1 需要两套同五元组；LAB1–LAB6 是现有六槽位来源；目标件和接口精确值均等待锁定 |

## 3. 现有合同已经覆盖什么

### 3.1 仪器与校准原件合同：已存在

`registration-capture-plan.json` 给出稳定槽位：

`PSU-01`、`DMM-01`、`MECH-01`、`MACRO-01`、`USBPWR-01`、`SPL-01`。

其中 `MECH-01` 明确包含两类实物资产，因而总资产类别为七类。每个槽位均有：

- 身份照片、制造商型号、制造商序列号或拍照留证的本地资产 tag；
- 校准证书或可追溯自检、参考标准原件和原始读数；
- `purchasePlanItemId` 与角色；
- `qualificationEffect=NONE_PREPARATION_ONLY`，准备层不会把仪器登记提升为目标或发布证据。

这已经构成可复用的 **instrument identity / qualification input contract**。缺少的是一个能把这些槽位绑定到稳定夹具 profile 和每次 session 的夹具实例合同。

### 3.2 九个 lab method：已存在，但覆盖粒度不均

| methodRef | 主要作用 | instrumentSlotRefs | 当前准备状态 |
|---|---|---|---|
| `LAB-SETUP-001` | 仪器登记与台架自检 | `PSU-01,DMM-01,MECH-01,MACRO-01,USBPWR-01,SPL-01` | `READY_NOW` |
| `MECH-INTAKE-001` | 整机包络、质量和接口观察 | `MECH-01,MACRO-01` | `READY_NOW` |
| `OID-OPTICS-INTAKE-001` | OID 头、工作边界和印刷样观察 | `MECH-01,MACRO-01` | `READY_NOW` |
| `USB-POWER-INTAKE-001` | USB 供电/充电工况原始记录 | `USBPWR-01,DMM-01` | `READY_NOW` |
| `AUD-REFERENCE-001` | 竞品声学相对基线 | `SPL-01,USBPWR-01` | `READY_NOW` |
| `PWR-BOARD-BOOT-001` | 目标板限流上电、启动和故障记录 | `PSU-01,DMM-01,USBPWR-01` | `WAIT_BOARD_LOCK` |
| `OID-FUNCTION-001` | 24 码、离线和负样功能记录 | `MACRO-01,DMM-01` | `WAIT_BOARD_LOCK` |
| `TARGET-ACOUSTIC-001` | 目标扬声器/声腔声学门 | `SPL-01,USBPWR-01` | `RELEASE_GATE` |
| `TARGET-BATTERY-001` | 电芯、充电、低电和续航门 | `USBPWR-01,DMM-01` | `RELEASE_GATE` |

方法目录的证据规则要求仪器身份、方法标识、原始文件和可复算过程；`lab-v1/README.md` 进一步要求环境、连接状态、原始相对路径、字节数、SHA-256、原始值、单位、计算过程和判定结果。现状可证明“方法合同存在”，但尚未证明“方法正在一个版本化夹具实例上执行”。

### 3.3 原始数据与结果合同：已存在，但属于其他 owner

1. `TestResult v1` 是点读时延结果 owner，不是通用夹具 owner。其约束包括：
   - `specimen` 中的 board/head/firmware/OID tool/print identity；
   - `method` 中的 procedure、clock domain、同步方法、仪器和环境；
   - `rawArtifacts` 的路径、大小、SHA-256；
   - sample 的阶段点、序列号、丢事件计数和 queue evidence；
   - `PENDING` 不得有样本，`SYNTHETIC` 必须 `fixtureOnly=true`，`MEASURED` 必须 `fixtureOnly=false`。
2. `release-gates-v1/catalog.json` 共 34 个 gate；硬件 interface 映射实际使用 14 个独立 gate，另有 target identity 的 `RG-BOARD-SUPPLY-VERIFIED`。物理 gate 拒绝 synthetic evidence，并要求明确 artifact role 和 producer。
3. `evidence-capture-v1/profile.json` 的四条 lane 负责外部普通文件复制、destination readback、owner/request hash、不可变 capture index 和受控 rollback。其效果为 `EVIDENCE_CAPTURE_ONLY`、`NONE` 或只读，不提升 target binding、BOM、ReleaseGate、purchase 或 owner record 状态。

因此，原始数据合同已经有多个强 owner；新夹具架构应当产生引用和绑定，不应复制 `TestResult`、`lab session` 或 `evidence-capture` 的字段语义。

## 4. 独立版本化接缝的缺口证明

### 4.1 现有链路与缺口

```text
topology.json
  -> target-binding.json (18 interface / observation / test / ReleaseGate refs)
  -> lab method + instrument registry
  -> session.template.json / TestResult v1 / raw evidence

缺少：
stable fixture profile/revision
  -> physical fixture instance + calibration originals
  -> target adapter revision
  -> session/raw evidence binding
```

### 4.2 逐文件证据

| 已有 owner | 它已经证明的事实 | 它没有持有的夹具事实 |
|---|---|---|
| `topology.json` | 12 个逻辑 block、36 个 port、18 条稳定 interface、方向和语义 | 背板能力版本、夹具槽位、实际夹具实例、校准原件 |
| `target-binding.json` | 目标 identity 选择器、18 条 interface 的 observation/test/gate 影响、EDA 门 | `fixtureProfileRef`、`fixtureInstanceRef`、`adapterRef`、连接拓扑、夹具自检 receipt |
| `method-catalog.json` | 九个 method、记录字段、仪器引用、准备/锁定/发布阶段 | 一个 method 在哪一版夹具、哪一件夹具实物上执行 |
| `registration-capture-plan.json` | 仪器六槽位、七类资产及身份/资格原件 | DUT/夹具背板实例和 target adapter 的身份 |
| `session.template.json` | 一次 session 的目标 identity、环境、仪器、methodResults、raw 根和 artifacts 入口 | fixture profile/revision、adapter profile/revision、physical instance、calibration reference、session schema/validator |
| `test-result-v1/schema.json` | 点读时延的 specimen、method、raw、sample、clock、queue 和 acceptance 合同 | 通用夹具能力、夹具自检、适配器兼容性和机械/电气连接映射 |
| `release-gates-v1/catalog.json` | gate ID、证据级别、producer、artifact role、synthetic 规则 | gate 与具体夹具 profile/adapter/instance 的双向绑定 |
| `evidence-capture-v1/profile.json` | 外部文件归档、hash、immutable index、owner route 和非提升效果 | 物理夹具的能力声明、校准资格、DUT adapter 兼容性 |

### 4.3 缺口判定

当前文件集合中没有独立的 `fixture profile/schema`、`target adapter schema/template`、`fixture instance/selftest` 或将它们接入 session/raw evidence 的稳定引用合同。`session.template.json` 的 `status=TEMPLATE`、目标五元组全为 `null`、`instrumentIds=[]`、`methodResults=[]`、`artifacts=[]`、`disposition=PENDING`，说明它是空入口而非夹具合同。

由此可证明：

- 仪器、方法和原始数据合同已经存在；
- 稳定拓扑与目标绑定合同已经存在；
- `stable fixture backplane -> target adapter -> session/raw evidence` 的独立版本化合同仍缺失；
- 现有 ReleaseGate 和 evidence-capture owner 的强度尚不足以自动补足这条缺口，因为它们只接受引用/receipt，并不拥有夹具能力或夹具实例身份。

## 5. 最小稳定夹具 capability 集

### 5.1 设计规则

- `fixture profile` 只描述 target-neutral capability、抽象槽位、证据状态和 raw artifact policy。
- `target adapter` 负责把抽象 capability 映射到具体板/OID/结构；它的精确电气和机械字段等待完整五元组、书面资料、两套同版实物和原始证据。
- `fixture instance` 负责真实背板、真实 adapter、夹具/校准原件、序列号/tag、照片、校准/自检和状态；实物证据与逻辑 profile 分离。
- `methodRefs=[]` 或 `instrumentSlotRefs=[]` 是有意暴露的覆盖缺口，不代表自动通过。
- capability 表中的 ReleaseGate 是依赖/影响映射；fixture selftest 本身不会把物理 gate 变成 PASS。

### 5.2 推荐 8 项 capability

| capabilityRef | 状态与 target-neutral 边界 | interfaceRefs | methodRefs | instrumentSlotRefs | releaseGateRefs |
|---|---|---|---|---|---|
| `CAP-FIXTURE-EVIDENCE-ANCHOR` | `RECOMMENDED`；稳定夹具 profile/instance 身份、方法/仪器/原始文件引用、运行 ID 和状态封套；不拥有目标器件事实 | `IF-DIAGNOSTIC`（仅作横切 evidence anchor） | `LAB-SETUP-001` | `PSU-01,DMM-01,MECH-01,MACRO-01,USBPWR-01,SPL-01` | `RG-HOST-EVT0-INTAKE-CONTRACT-PASSED` |
| `CAP-OPTICAL-PRESENTATION-DATUM` | `RECOMMENDED`；可重复的码页呈现、头部安装基准和观察过程；工作边界、角度、光学件和机械尺寸保持 `PENDING/UNRESOLVED` | `IF-OID-OPTICAL`; `IF-HEAD-MECHANICAL` | `MECH-INTAKE-001`; `OID-OPTICS-INTAKE-001` | `MECH-01`; `MACRO-01` | `RG-OID-CODE-TOOL-FROZEN`; `RG-OID-PHYSICAL-MAP-ASSIGNED`; `RG-OID-TWO-HEAD-TWO-PRINT-MATRIX-PASSED`; `RG-BOARD-TARGET-FROZEN`; `RG-TARGET-FORM-RELIABILITY-PASSED` |
| `CAP-OID-EVENT-TIMING-OBSERVATION` | `RECOMMENDED`；启动/停止、事件接收、序列、丢事件、clock/synchronization 和 raw trace 入口；传输介质、电平、pin、connector、pogo 位置保持 `PENDING/UNRESOLVED` | `IF-OID-EVENT` | `PWR-BOARD-BOOT-001`; `OID-FUNCTION-001` | `PSU-01`; `DMM-01`; `USBPWR-01`; `MACRO-01` | `RG-BOARD-TARGET-FROZEN`; `RG-OID-TWO-HEAD-TWO-PRINT-MATRIX-PASSED`; `RG-POINT-READ-LATENCY-PASSED` |
| `CAP-POWER-SAFE-INJECTION` | `RECOMMENDED`；抽象的受控供电、限流、充电/电池状态采集和原始时间序列入口；所有电压、电流、极性、pin、connector 和负载边界保持 `PENDING/UNRESOLVED` | `IF-USB-POWER`; `IF-BATTERY-POWER`; `IF-BOARD-POWER`; `IF-AUDIO-POWER` | `USB-POWER-INTAKE-001`; `PWR-BOARD-BOOT-001`; `TARGET-BATTERY-001` | `PSU-01`; `DMM-01`; `USBPWR-01` | `RG-BOARD-SUPPLY-VERIFIED`; `RG-TARGET-STORAGE-DURABILITY-PASSED`; `RG-TARGET-AUDIO-PROFILE-VERIFIED`; `RG-TARGET-FORM-RELIABILITY-PASSED` |
| `CAP-CONTENT-STORAGE-OFFLINE` | `PARTIAL_COVERAGE`；离线状态、存储引用和掉电/恢复 raw artifact 的挂接能力；存储拓扑、文件系统、容量、无线状态和掉电设置保持 `PENDING/UNRESOLVED`；现有 method 对存储掉电耐久没有独立条目 | `IF-STORAGE`; `IF-WIRELESS` | `OID-FUNCTION-001`（离线功能部分覆盖） | `DMM-01`; `MACRO-01` | `RG-TARGET-STORAGE-DURABILITY-PASSED`; `RG-OFFLINE-POINT-READ-PASSED` |
| `CAP-USB-DATA-TRANSPORT` | `PENDING_METHOD_COVERAGE`；主机数据边界、事务/stream raw trace 和目标形态访问引用；数据模式、framing、pin、connector、pogo 位置和机械尺寸保持 `PENDING/UNRESOLVED`；现有九个 method 没有独立 USB data transport procedure 或仪器槽位 | `IF-USB-DATA`; `IF-USB-MECHANICAL` | `[]`（现有 method gap） | `[]`（现有 instrument-slot gap） | `RG-DEVICELINK-PHYSICAL-TRANSPORT-PASSED`; `RG-BOARD-TARGET-FROZEN`; `RG-TARGET-FORM-RELIABILITY-PASSED` |
| `CAP-AUDIO-ACOUSTIC-OBSERVATION` | `RECOMMENDED`；音频请求/可观察起点/声学输出的 raw evidence 入口和固定观察条件引用；扬声器、声腔、观测距离、位置、结构尺寸和输出参数保持 `PENDING/UNRESOLVED` | `IF-AUDIO-SIGNAL`; `IF-AUDIO-ACOUSTIC` | `AUD-REFERENCE-001`; `TARGET-ACOUSTIC-001` | `SPL-01`; `USBPWR-01` | `RG-POINT-READ-LATENCY-PASSED`; `RG-TARGET-AUDIO-PROFILE-VERIFIED`; `RG-TARGET-FORM-RELIABILITY-PASSED` |
| `CAP-CONTROL-STATUS-DIAGNOSTIC-HIL` | `PARTIAL_COVERAGE`；控制/状态事件、build/flash/log、ABI、队列和 HIL raw evidence 的统一挂接；控制 pin、电气行为、指示器位置、connector、pogo 和机械尺寸保持 `PENDING/UNRESOLVED`；现有 method 对控制/状态没有独立 procedure | `IF-CONTROL`; `IF-STATUS`; `IF-DIAGNOSTIC`; `IF-BOARD-MECHANICAL`; `IF-USER-IO-MECHANICAL` | `LAB-SETUP-001`; `PWR-BOARD-BOOT-001`; `OID-FUNCTION-001`（仅基础启动/功能证据） | `PSU-01`; `DMM-01`; `MACRO-01`; `USBPWR-01` | `RG-C-RUST-DIFFERENTIAL-PASSED`; `RG-PLATFORM-ABI-HIL-PASSED`; `RG-TARGET-TOOLCHAIN-SEALED`; `RG-TWO-BOARD-PORT-HIL-PASSED`; `RG-TARGET-FORM-RELIABILITY-PASSED` |

### 5.3 覆盖检查

- 七个 operational capability 的 `interfaceRefs` 合计覆盖 18 条 interface，各 interface 至少出现一次。
- `CAP-FIXTURE-EVIDENCE-ANCHOR` 对 `IF-DIAGNOSTIC` 是横切引用；`IF-DIAGNOSTIC` 的唯一语义 owner 保持原位。
- `IF-STORAGE`、`IF-USB-DATA`、`IF-CONTROL`、`IF-STATUS` 的抽象边界已经由 topology/binding 命名；其中 transport、存储掉电、控制/状态的专用 method 仍需回到既有 `method-catalog` owner 追加，而非在 fixture package 复制一套 method catalog。
- 现有六个 instrument slot 已全部进入 capability 映射；没有为逻辑分析仪、示波器、麦克风或 pogo 模块凭空增加槽位。新增资产须先经过 `registration-capture-plan` 和 instrument registry owner。

## 6. 三层边界：能力、target adapter、物理实物

| 层 | 事实性质 | 建议 owner | 必备引用 | 当前状态 |
|---|---|---|---|---|
| 稳定夹具能力 `fixture profile` | target-neutral 的 capability ID、抽象槽位、状态机、raw policy、兼容的 topology/interface refs | 新的 `test-fixture-v1` profile owner | `topologyRef`、capability refs、method catalog ref、instrument slot refs、selftest policy | 可现在设计；不填目标电气/机械值 |
| 板/OID/结构 target adapter | 某一完整五元组及其板/OID/结构映射；包含 exact observation/test/gate 和受影响 capability | 新的 `target adapter` owner；未来由 `target-binding` 消费引用 | `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION`、书面资料、两套同版 intake、raw artifact hash、adapter revision | `PENDING/UNRESOLVED`；五元组与证据齐全前保持空模板 |
| 物理夹具实物/校准原件 | 背板、adapter、安装件、校准标准、参考原件、照片、tag/serial、状态和有效期 | fixture instance/qualification owner；仪器资料仍由 lab registry owner 持有 | instance identity、profile/adapter refs、校准/自检 raw artifacts、fixture selftest receipt | 当前无实物记录；不得把逻辑 profile 当实物 |
| session/raw evidence 接缝 | 一次运行引用哪个 profile、instance、adapter、instrument registry、method catalog、raw index 和计算结果 | 复用现有 lab session、TestResult、evidence-capture owner | fixture binding fragment、session ID、raw artifact manifest、TestResult/ReleaseGate refs | 接缝缺失；应新增引用合同而非复制现有字段 |

### 6.1 目标 adapter 的最小门

`adapter` 只有在以下证据集合齐全后才可从 `PENDING` 进入目标候选状态：

1. 两套同版 `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION` 的 accepted intake；
2. 对应的书面供货证据和原始资料 hash；
3. `RG-BOARD-TARGET-FROZEN`、`RG-BOARD-SUPPLY-VERIFIED`、`RG-OID-CODE-TOOL-FROZEN` 等入口 gate 的实际 receipt；
4. 与 adapter 覆盖的 interface 相匹配的 observation/test raw artifacts；
5. adapter 自身的 version、兼容性声明、变更原因和受影响 gate 列表。

在上述门前，`voltage/current`、pin map、connector identity、pogo location、working datum、mounting datum、clearance 和其他 mechanical dimension 字段统一为 `PENDING` 或 `UNRESOLVED`。

## 7. 可实施文件建议

建议新建一个独立的 `hardware/evt0/test-fixture-v1/` owner，最小文件集如下；本次仅提出结构，不落地 schema/代码：

| 建议文件 | owner 内容 | 与现有 owner 的边界 |
|---|---|---|
| `profile.schema.json` + `profile.json` | `FIXTURE_PROFILE_ID/REV`、profile status、topologyRef、8 项 capability、抽象 instrument slot refs、calibration policy、raw artifact policy、兼容性和废弃关系 | 不复制 topology interface 语义；不复制 method catalog、session、TestResult 或 evidence-capture 字段 |
| `adapter.schema.json` + `adapter.template.json` | `TARGET_ADAPTER_ID/REV`、profileRef、target identity 五元组、interface/capability coverage、exact target fields 的状态、observation/test/gate refs、adapter artifacts 和 blocker | 不在 `BOARD_TARGET` 未解析时填入芯片、pin、电气数值、connector、pogo 或机械尺寸；未来只被 target-binding/intake 消费 |
| `instance.schema.json` + `instance.template.json` | 物理背板/adapter 实例 tag、profile/adapter refs、物理照片、校准/自检原件 refs、状态、有效期、维护/变更记录和 selftest receipt | 不复制 lab instrument identity；仪器仍由 `lab-v1` registry 持有 |
| `selftest.schema.json` + `selftest.template.json` | 检查 profile/instance 完整性、槽位存在性、原件 hash、参考标准、版本兼容、raw readback 和 `PENDING/PASS/FAIL`；自测结果只证明夹具资格 | 不关闭物理 ReleaseGate，不制造 target evidence，不把 synthetic 变成 measured |
| `validator` / `selftest` | 只读校验 profile、adapter、instance、引用存在性、hash、状态单调性、18 interface 覆盖和空值门；生成可引用 receipt | 复用现有 lab、TestResult、ReleaseGate 和 evidence-capture validator；不建立平行发布判定 |
| `README.md` | 三层生命周期、状态转移、文件引用、人工实物步骤、回滚和“哪些字段永远等待 target evidence”的说明 | 只说明边界，不成为第二套接口、方法或发布门目录 |

### 7.1 推荐的数据流

```text
fixture profile/revision
  + physical fixture instance/selftest receipt
  + qualified instrument registry ref
  + target adapter/revision (PENDING until five-tuple evidence)
        |
        v
existing lab session owner
  + fixtureBindingRef
  + adapterBindingRef
  + method/instrument/environment refs
  + raw artifact index
        |
        +--> existing TestResult v1 for point-read latency
        +--> existing evidence-capture-v1 for externally supplied raw bytes
        +--> existing ReleaseGate receipts/decision
```

建议的 `fixtureBindingRef` 只包含 profile/instance/selftest/adapter 引用和 hash；具体的 session、TestResult、raw artifact、ReleaseGate 字段继续由原 owner 产生。这样换板时主要替换 adapter/instance 引用，换仪器时主要替换 registry/qualification 引用，稳定 capability 和原始结果合同保持复用。

### 7.2 未来 validator/selftest 的最小负向门

- profile 引用不存在的 topology/interface/method/slot 时拒绝；
- 18 条 interface 覆盖不完整或出现未声明的 interface 时拒绝；
- adapter 的五元组不完整、重复、与 intake selector 不一致时保持 `PENDING`；
- voltage/current/pin/connector/pogo/mechanical 字段在 target evidence 前出现具体值时拒绝晋级；
- instance 缺物理身份、校准/自检原件、raw bytes 或 SHA-256 时保持 `PENDING`；
- 未 qualified 的仪器 registry、跨 workspace raw path、hash readback 漂移时保持 `PENDING`；
- fixture selftest receipt 被直接拿去关闭物理 ReleaseGate 时拒绝；
- `SYNTHETIC`/`fixtureOnly` 结果进入 physical/production gate 时拒绝；
- adapter/profile revision 改变但未关联受影响 interface/method/gate 时拒绝。

## 8. 软件线只读同步

已读取软件 owner 的正式锚点和 `current-context`：System TTS Source Adapter 报告 **41/41**，其硬件影响明确为 `hardwareImpact=NONE`；软件锚点记录的报告 SHA-256 为 `d2488e26f3363e7b46d57c2475c524ce6c096c98cc8a3e754e2c77c1c967a5db`。

本次审计没有发现新的 codec、storage、USB、OID event、board adapter、BOM、硬件 test、ReleaseGate 或 EDA transport 增量。软件源码、软件 owner 记忆和运行时保持现状；未来只有在 adapter evidence 形成后，才通过既有 `IF-OID-EVENT`、`IF-STORAGE`、`IF-USB-DATA`、`IF-AUDIO-SIGNAL`、`IF-DIAGNOSTIC` 和 ReleaseGate 引用交换影响。

## 9. 30/20/20/10/10/10 收益评分

评分维度固定为：关键路径解锁 30、证据就绪度 20、实物闭环距离 20、复用收益 10、时间/成本 10、返工风险 10。评分是当前决策输入，不是证据状态。

| 工作包 | 关键路径 30 | 证据就绪 20 | 实物闭环 20 | 复用 10 | 时间/成本 10 | 返工风险 10 | 总分 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `HW-REUSABLE-TEST-FIXTURE-ARCHITECTURE-V1`（本包） | 24 | 20 | 8 | 10 | 10 | 10 | **82** |
| `HW-MB1-SEND-AND-FREEZE`（下一候选） | 30 | 19 | 20 | 10 | 8 | 9 | **96** |

`HW-MB1-SEND-AND-FREEZE` 总分更高，因为它直接取得两套同版目标实物、书面资料和真实 intake；但它依赖人工外发、供应商回件、付款/物流和到货验收，属于真实外部动作。当前审计包的 82 分来自：现有 topology、method、instrument、TestResult、ReleaseGate 和 raw capture 已经在本地，文档型合同可以先把重复手工接缝收敛为 profile/adapter/instance 引用；它是当前最高收益的 **自治包**，但它并不代替 MB1 外发、实物到货、夹具制作、校准或 HIL。

## 10. 官方一手资料的原则支持

网络可访问时只选官方/一手资料；以下资料只支持“模块化测试能力与目标专用夹具/适配边界分层”的一般原则，不替代本项目文件、实物、校准或 ReleaseGate 证据：

- [NI Modular Instruments documentation](https://www.ni.com/docs/en-US/bundle/labview/page/modular-instruments.html)，访问日期：2026-08-04。用于支持把模块化仪器能力作为可复用系统资源组织，再由测试对象边界消费；本项目仍以 `registration-capture-plan.json` 和 lab registry 为事实源。
- [Keysight, Fixture Reusability Consideration: From In-line to Offline](https://www.keysight.com/us/en/assets/3122-1472/application-notes/Fixture-Reusability-Consideration-From-In-line-to-Offline.pdf)，访问日期：2026-08-04。用于支持把 fixture 的复用和 target-specific connection/fixture variation 分层；本项目不从该资料推导任何电压、电流、pin、connector、pogo 或机械尺寸。

## 11. 验收边界与残余风险

### 已确认

- 18 条稳定 interface、9 个 lab method、6 个 instrument slot/7 类资产、TestResult v1、ReleaseGate catalog 和 Evidence Capture profile 均已读取并交叉映射。
- 稳定夹具能力、target adapter、物理夹具/校准原件三层已分开；8 项推荐 capability 的 interface/method/instrument/gate 引用已列出。
- 所有 target-specific 电气、连接、pogo 和机械字段保持 `PENDING/UNRESOLVED`。
- 软件最新正式增量仍为 TTS 41/41、`hardwareImpact=NONE`。

### 残余风险

1. 当前没有真实 qualified lab registry、物理背板、校准原件、target adapter、accepted MB1 或 physical session record；现状仍是准备层。
2. `IF-USB-DATA` 缺少独立 method 和 instrument slot；存储掉电耐久、控制/状态也缺少独立 procedure，需要由既有 `method-catalog` owner 后续补齐。
3. `session.template.json` 仍缺通用 session schema 和 fixture binding seam；`TestResult v1` 的承载范围仅为点读时延，通用夹具生命周期另设 seam。
4. `target-binding` 仍没有 adapter/profile/instance 引用；在五元组、供应证据、两套同版实物和相关 raw artifacts 到位前，EDA 与目标具体实现继续保持锁定。
5. 本文档只能降低未来证据串线和重复维护成本；实际外发、采购、夹具加工、仪器登记、校准、HIL 和 ReleaseGate 收口仍需真实原件与原始数据。

## 12. 验证记录

- 文件编码：以 UTF-8 严格解码通过。
- Markdown 表格：表头/分隔线/列数检查通过。
- 本地链接：逐项检查输入文件和建议引用的本地路径；官方 URL 保留为外部一手资料链接。
- `git diff --check -- docs/research/hardware-reusable-test-fixture-evidence-audit-2026-08-04.md`：通过。
- Git stage/commit：未执行；本次写入路径限定为本文件。
