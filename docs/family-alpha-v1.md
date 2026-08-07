# Family Alpha v1：家庭内容到设备快照

> 状态：主机端设计夹具（`design-fixture`）  
> 适用范围：WP-05 最小家庭闭环  
> 上位设计：[系统构思](./system-concept.md)  
> 机器合同：[FamilyRevision / BuildPlan / BuildAuthorization](../hardware/evt0/family-repository-v1/) · [Confirmation Trust v1](../hardware/evt0/confirmation-trust-v1/) · [Family Alpha v1](../hardware/evt0/family-alpha-v1/) · [Snapshot v1](../hardware/evt0/snapshot-v1/) · [DeviceLink v1](../hardware/evt0/device-link-v1/)
> 设计说明：[Confirmation Trust v1](./confirmation-trust-v1.md) · [高复用、低维护架构](./reuse-maintainability.md)

## 1. 目的与边界

Family Alpha v1 把系统构思中的首个家庭闭环收敛为一条可重复验证的发布链：

```text
FamilyRevision + confirmation-free BuildPlan + resolved assets
→ CompileDraftProjection（当前 draft 兼容输入）
→ preview
→ 一次性 challenge
→ 完整 presentation transcript
→ confirmation
→ Ed25519 proof 验证并原子消费 challenge
→ BuildAuthorization
→ 授权后的候选 compile
→ Snapshot v1
→ DeviceLink stage / verify / activate
→ 笔端离线点读
```

本阶段冻结的是**编辑域到发布域的主机端合同**，不是目标笔的实物验收结果。当前黄金夹具用于验证输入、确认、哈希投影和 Snapshot 生成；最后两段的真实 USB 传输、目标板存储和离线播放仍由板级证据门关闭。

`BuildRequest v1` 只保留为旧黄金输入和旧调用方的兼容合同，不再定义主流程。它把未来才产生的
confirmation 放进构建输入，存在循环依赖；新的 `BuildPlan` 在预听前保持 confirmation-free，逐构建
信任结果只由后续 `BuildAuthorization` 表达。`BuildRequest v1` 的 release 路径已封闭，不接受调用方
自报的单 receipt 作为生产放行。

## 2. 每一步的可验证语义

### 2.1 Draft：编译投影兼容输入

`draft.json` 把家长可编辑信息与一次目标构建所需的映射、codec 和路径投影到同一个
Alpha 输入。它只服务现有编译器兼容层；长期家庭事实源使用 target-neutral
`FamilyRevision`，由 confirmation-free `BuildPlan` 提供 target/profile/map/asset catalog 和期望投影，
预听完成后再以 `BuildAuthorization` 绑定这一个 `buildPlanId / buildSubjectSha256`。生产候选还必须绑定
完整 `ReleaseDecision`；`BuildRequest v1` 的单 receipt 字段只作兼容占位，不参与新的生产授权链。
机器合同与逐字节适配回归已经落在
[`hardware/evt0/family-repository-v1/`](../hardware/evt0/family-repository-v1/)，边界见
[高复用、低维护架构](./reuse-maintainability.md)。`sourceProducer` 记录投影来源工具；
它属于 draft 身份的一部分，不冒充编译器。编译器在形成预览前检查：

- JSON Schema 与额外字段；
- Alpha draft 最多 24 个 binding，与当前 24 码产品切片对齐；这不是目标板容量结论；
- `bindingId`、`logicalOid`、`actionId` 和全局 `clipId` 唯一性；
- `replace`、`queue`、`random_one` 的 clip 数量语义；
- 输入文件经 `realpath` 后仍位于仓库及 draft 根目录、且是普通非符号链接文件；
- 当前音频基线 `WAV_PCM16_16K_MONO`：精确 44-byte canonical header、一个 16-byte `fmt ` 后紧接一个 `data`；
- RIFF/data 长度、byte rate、block align 与文件长度一致，拒绝 metadata chunk 和 trailing bytes；
- 逻辑码/物理码状态一致性；
- Family Alpha 编译器当前只签发 `design-fixture`，`release-candidate` 等待通过的机器可读 ReleaseDecision 后再开放。

Draft 不直接写入设备，也不直接作为 FamilyRepository 聚合保存；物理码、board/firmware、
目标 codec 和文件路径不会回写 FamilyRevision。

### 2.2 Preview receipt：把预听对象固定下来

编译器读取 draft 和音频字节，生成 `family-alpha-preview-v1` receipt：

- `sourceSha256` 固定规范化后的完整 draft；
- `presentationPolicyVersion` 固定此次展示/确认合同；
- receipt 明文携带监护人应看到的 `logicalOid`、`label`、类型、播放策略、冷却时间和 revision；
- 每个 clip 按播放顺序携带 `clipId`、transcript、来源、媒体/语言/codec、精确字节数、SHA-256 和时长；
- 每个 binding 的 `contentSha256` 覆盖其编辑内容及 clip 哈希；
- `previewId` 覆盖展示策略、`sourceSha256` 和有序的全部 binding/clip 展示证据；
- `status` 固定为 `AWAITING_GUARDIAN_CONFIRMATION`。

Receipt 是“这次预听对应哪些内容和音频字节”的机器证据。真实产品还要由界面实际播放这些音频并记录用户动作；单独生成 receipt 不等同于已经完成预听。

### 2.3 Challenge → presentation → confirmation → proof

主流程不把一份裸 confirmation 当作授权。受信 provider 先为单一
`BuildPlan / preview / authorityRevisionId` 签发带 128-bit nonce 的一次性 challenge；家长端随后记录：

1. 打开该 `previewId`；
2. 按 preview 的 binding/clip 数组顺序完成全部 required clip 播放；
3. 最后执行显式确认。

presentation transcript 与 confirmation 必须同时绑定当前 `buildPlanId / buildSubjectSha256`、
`previewId / sourceSha256`、展示策略、确认标识、监护角色和时间。confirmation 仍固定
`decision: confirmed`、`scope: all-bindings`；只要标签、transcript、策略、顺序、映射、target 或音频
字节发生变化，就会形成新的 BuildSubject 或 preview，旧 proof 不再适用。

provider 使用固定的 `Ed25519+JCS-prefix-v1` profile 对完整 claims 签名；verifier 只从本地 trust policy
的 JWK keyring 取公钥，检查 provider、purpose、audience、key/authority 时间窗、presentation 完整性和
confirmation 语义哈希，并在同一事务中消费 challenge、写入 operation journal 和 verification result。
成功结果再确定性生成只授权该 BuildSubject 的 `BuildAuthorization`。重复同一操作返回首次持久化结果，
同一 challenge 的不同 proof 只有一个赢家。合同和边界见
[`Confirmation Trust v1`](./confirmation-trust-v1.md)。

黄金 trust policy、proof 与 authorization 使用 `fixtureOnly: true` 和 RFC 8032 公共测试密钥，只证明
自动化合同。真实家庭构建需要生产 provider、真实但假名化的 authority revision 和非 fixture
`BuildAuthorization`；黄金身份、时间、测试密钥和确认内容不作为真实用户凭证。

兼容 Alpha 编译报告仍以 RFC 8785/JCS 规范化 confirmation 后计算 `confirmationSha256`，并把语义哈希
写入 Snapshot `evidenceRefs`；原文件字节仅以 `confirmationFileSha256` 留作主机诊断。该兼容投影不替代
上述逐构建 proof/authorization 链。

### 2.4 Compile：从编辑域投影到执行域

主流程在 `BuildAuthorization` 与当前 `BuildPlan / BuildSubject` 精确匹配且未过期后，才把内容投影为
Snapshot v1。现有 Family Alpha runner 的 draft + confirmation 入口继续作为 design-fixture 兼容回归，
不升级为生产授权入口：

`apps/companion-app` 已成为首个真实组合根：它从重开后的 FamilyRevision 派生 provisional BuildPlan，
由共享 adapter 最终化 projection/BuildSubject，再经 live fixture provider 生成 BuildAuthorization；
授权门全部通过后才调用下表的兼容 compiler。原17项授权编译子集与6项授权负例继续证明该 host 接缝；
加入完整导出/恢复后，组合根总计26项 gate。产品 authority、真实播放 UI 与 release-candidate
仍分别由后续证据门持有。

| 输出 | 内容 |
|---|---|
| `logical-index.json` | 逻辑/物理 OID 到 `actionId` 的索引 |
| `actions.json` | 播放策略、clip 顺序和最小 clip catalog |
| `audio/*.wav` | 已确认、可直接播放的最终音频 |
| `manifest.json` | revision、target、逐文件大小/SHA-256、容量、确认文件哈希和安装语义 |

Manifest 的 `producer` 由编译器常量写入；draft 的 `sourceProducer` 不会替代它。编译报告另带按 LF 规范化的编译器源码 SHA-256、confirmation 语义/文件双哈希和各输出哈希。

`requiredBytes` 包含 manifest 与全部 payload 的实际字节，当前回归也要求它等于
DeviceLink `totalBytes`；目标文件系统与 A/B 槽的额外预留仍由板级存储证据给出。

写入过程使用独占 `.compile-lock`，先在编译器自有 staging 目录形成并复核完整树，再以目录 rename 发布；失败时清理 staging 和 lock，已有输出保持不变。Alpha 编译与 preview 文件都只接受仓库 `build/` 下的新路径，preview 采用 no-overwrite 发布，现有文件不会被覆盖。

### 2.5 Snapshot → DeviceLink

Snapshot 是 DeviceLink 的输入，不是直接覆盖活动内容的文件集合。DeviceLink v1 的顺序为：

```text
stage.begin
→ manifest-first 顺序持久化
→ 分块写入清单文件
→ verify
→ activate（再次执行 active CAS）
```

失败、断连或不完整事务遵循 DeviceLink 的重放、恢复、abort/rollback 和上一良好快照语义。当前这些语义已有主机 transcript；实际 USB framing、重连、存储同步、掉电窗口和 A/B head 原子性继续留在目标板 HIL。

当前黄金编译结果是 `design:` ID，DeviceLink 的发布 Schema 只接受 `sha256:` ID，因此
不会进入 stage。回归只投影并核对 manifest-first、总字节数和文件数，然后验证这个预期
拒绝；ReleaseDecision 与物理门关闭后才形成可安装的发布事务。

## 3. 数据最小化边界

设备 Snapshot 只保留点读执行所需的数据：OID/action 投影、播放策略、最终确认音频和校验元数据。

以下编辑域或家庭域信息不进入 Snapshot：

- 原始录音样本、被舍弃的 take 和 VoiceProfile 训练样本；
- voice model 或模型引用；
- 家庭照片；
- 云服务凭据；
- `label`、`transcript`、`sourceKind` 等编辑/预览信息。

`family-recording` 的**最终确认 WAV clip**会作为播放资产进入 Snapshot；这与把原始录音样本或音色训练材料装入设备是两件事。

黄金回归遍历设备侧 `manifest.json`、`actions.json` 和 `logical-index.json` 全部 JSON，
同时执行字段白名单、`evidenceRefs` 值格式白名单和家庭源私密值扫描；向 manifest
`evidenceRefs` 注入普通 label/单字中文 label，以及向 manifest 注入私密字段的三类
自检都必须被隐私门检出。

## 4. 当前黄金切片

黄金夹具位于 [`hardware/evt0/family-alpha-v1/golden/`](../hardware/evt0/family-alpha-v1/golden/)，当前固定：

- 6 个 binding、10 个 120 ms WAV 测试 clip；
- 逻辑 OID `YIMI-EVT0-013` 至 `YIMI-EVT0-018`；
- 同时覆盖 `family-recording`、`system-tts`、`replace`、`queue` 和 `random_one`；
- `fixtureOnly: true`、`releaseState: design-fixture`；
- 所有 `physicalCode: null`，`physicalMapStatus: unassigned`；
- `boardTarget: UNFROZEN`、`firmwareMin: UNFROZEN`。

这些 WAV 是确定性测试声，不是家庭录音产品素材。013–018 是逻辑码，不代表已生成、印刷或读取的真实 OID 物理码。

主机回归入口：

```powershell
npm run test:family-alpha-compiler
```

当前黄金 preview 逐字节匹配、两次独立编译树确定性一致，27/27 负向场景通过且 27/27 保持失败零副作用。报告写入忽略提交的 `build/family-alpha-validation/report.json`；它只声明主机设计合同结果并引用统一 ReleaseGateCatalog，不再自行判定发布。唯一当前判定在 `build/release-gate-current/release-decision.json`。报告同时投影 manifest-first DeviceLink begin 参数，并验证发布合同按预期拒绝当前 `design:` Snapshot ID。

新的 Family build adapter 同时锁定 confirmation-free `BuildPlan` 与旧 `BuildRequest v1` 兼容投影：
BuildPlan 到 Alpha draft 逐字节一致，23/23 负向场景通过且 23/23 保持失败零副作用。其中明确覆盖
BuildRequest v1 自报 release receipt 被封闭、BuildPlan 身份漂移，以及把 confirmation 塞回 BuildPlan
造成循环的拒绝。Confirmation Trust v1 另有 17/17 负向场景与 17/17 零副作用结果，覆盖签名、
BuildSubject/preview/presentation/confirmation 绑定、过期、key 状态、authority 和 replay 冲突。

上述新增门不改写 Family Alpha 编译器既有基线；Family Alpha 仍保持 27/27，三个计数分别属于
build adapter、confirmation trust 和 Alpha compiler，不能相互替代。

家庭事实源、confirmation-free BuildPlan 与逐构建 BuildAuthorization 的存储边界已在
[`hardware/evt0/family-repository-v1/`](../hardware/evt0/family-repository-v1/) 与
[`tools/family-repository/`](../tools/family-repository/) 落地。Memory 与 Atomic JSON 使用同一
16 步 transcript 验证 revision/CAS、operation 重放、backup/restore、reopen 和 outbox；额外
机器场景覆盖 repository/family scope、逐 binding revision、严格时间线、live-state 身份、
epoch cursor、恢复响应丢失重放、格式归一化、并发单赢家和 rename 前故障。Atomic JSON
定位为开发/黄金 adapter；产品端存储、父目录 fsync、进程崩溃和目标介质耐久继续由独立 adapter 证据门持有。
正常 restore 采用 append-only revision store，只移动 active head；较新的 revision 实体仍可按
ID 加载，避免家庭内容回滚同时变成不可逆删除。

[`Family Export v1`](../hardware/evt0/family-export-v1/) 已把 repository backup 与所有历史 revision
引用资产组合为内容寻址目录包。companion acceptance 在干净目录执行 portable restore，复算相同
revision、资产与 preview，并让恢复副本使用不同 outbox epoch；同 assetId 历史换字节、路径哈希错配、
额外文件、资源超限和资产篡改均有失败零目标副作用场景。它仍是主机目录证据，不替代真实录音 UI
或介质掉电恢复。

## 5. 发布真值与开放证据门

Family Alpha v1 当前属于**主机/design fixture**。生产确认有两个互不替代的层级：

| 层级 | 工件 | 作用 |
|---|---|---|
| 产品级 provider qualification | `RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED` receipt | 证明当前产品 release 所部署的 provider profile、生产 keyring、authority resolver 与 atomic replay store 合格 |
| 逐构建授权 | `BuildAuthorization` | 证明一个受信监护权威完成了这一个 BuildPlan/preview 的预听和确认 |

产品级 qualification 不是可以跨 BuildPlan 复用的“已确认”布尔值；逐构建 `BuildAuthorization` 也不证明
provider 对整个产品 release 已完成部署和审计。生产候选必须同时满足产品 ReleaseDecision 和当前
BuildSubject 的非 fixture BuildAuthorization。

当前 ReleaseGateCatalog 有 34 个 gate、15 个 host adapter 和 19 个物理/生产 gate；release-gate
conformance 的 22/22 负向场景均保持失败零副作用。最新密封 `validate:full` 结果为
15 项 host PASS、0 FAIL、19 项 physical/production missing，因而 `releaseReady` 仍为 false；host PASS
不会替代缺失的实物或生产 evidence。

以下项目仍保持开放：

1. 为当前 product release 生成经 gate-specific verifier 检查、非 synthetic 且 artifact 完整的 provider qualification；
2. 在家庭协调层接入真实 authority revision，并为每个 BuildPlan 生成和消费非 fixture BuildAuthorization；
3. 冻结 `BOARD_TARGET`、固件最低版本与同 revision 硬件身份；
4. 获取 OID 码工具，将 013–018 逻辑码分配为唯一 `physicalCode`；
5. 依据目标解码器、声学和存储实测冻结设备 codec/profile；
6. 在真实 USB 通道上完成 manifest-first、断连续传和重连；
7. 在目标存储上验证 `storage_sync`、掉电、A/B 激活与回滚；
8. 用两块同 revision 板和原始记录完成 OID、音频、C/Rust trace 与整机物理验收。

这些门关闭前，编译结果保持 `design:` Snapshot ID；统一 ReleaseDecision 保持 `releaseReady=false`，
该工件不作为制造或装机发布包。

## 6. 后续接入原则

- 家长端只走 `BuildPlan → preview → challenge/presentation/confirmation/proof → BuildAuthorization → compile`，不绕过逐构建授权生成设备包；
- 任何编辑、target、映射、codec 或音频变化都生成新的 BuildSubject/preview，并使旧 BuildAuthorization 失配；
- `BuildRequest v1` 只由兼容 adapter 读取，不再向它增加新的生产语义或第二条 release 管线；
- 真实 trust policy、proof、authorization 与黄金 fixture 分库保存；产品级 provider qualification 和逐构建授权分别验证、缺一不可；
- production receipts 与通过的 ReleaseDecision 落地前，Family Alpha 编译器继续只签发 `design-fixture`；
- 证据门关闭后产生的 `sha256:` 发布 Snapshot 经 DeviceLink 安装，不增加另一条直接复制并覆盖 active 的路径；当前 `design:` fixture 只做主机投影并由 DeviceLink 发布 Schema 拒绝；
- 物理目标冻结后，用证据更新 target、physical map 和 codec，不从当前逻辑 fixture 反推硬件事实。
