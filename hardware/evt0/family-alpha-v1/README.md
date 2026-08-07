# Family Alpha v1 合同与黄金夹具

此目录冻结 WP-05 的 Alpha 编译投影输入、预览回执和监护人确认结构。`draft` 是当前
编译器兼容投影，不是未来 FamilyRepository 持久模型；FamilyRevision/BuildRequest 拆分见
[`docs/reuse-maintainability.md`](../../../docs/reuse-maintainability.md)。它服务于主机端设计验证，当前不表示目标板、真实 OID 或 USB 安装已经通过。

端到端语义见 [`docs/family-alpha-v1.md`](../../../docs/family-alpha-v1.md)。

## 目录

| 工件 | 用途 |
|---|---|
| [`draft.schema.json`](./draft.schema.json) | Alpha `CompileDraftProjection` 的 Draft 2020-12 Schema |
| [`preview.schema.json`](./preview.schema.json) | 绑定 draft 与音频字节的 preview receipt Schema |
| [`confirmation.schema.json`](./confirmation.schema.json) | 监护人对精确 preview/source 进行确认的 Schema |
| [`golden/draft.json`](./golden/draft.json) | 6 个 binding / 10 个 clip 的设计态输入 |
| [`golden/expected-preview.json`](./golden/expected-preview.json) | 由黄金输入确定生成的预览回执 |
| [`golden/confirmation.json`](./golden/confirmation.json) | `fixtureOnly: true` 的合约测试确认记录 |
| [`golden/assets/`](./golden/assets/) | 确定性 PCM16/16 kHz/mono WAV 测试资产 |

黄金 WAV 由 [`tools/family-alpha-compiler/golden-assets.mjs`](../../../tools/family-alpha-compiler/golden-assets.mjs) 确定生成；主回归逐字节复算 10 个文件。需要重建时运行 `npm run generate:family-alpha-assets`。

编译实现位于 [`tools/family-alpha-compiler`](../../../tools/family-alpha-compiler/)。输出服从 [`Snapshot v1`](../snapshot-v1/)，安装语义服从 [`DeviceLink v1`](../device-link-v1/)。

## 冻结流程

```text
draft.json
→ schema / semantic / WAV / path validation
→ preview receipt
→ 监护人预听确认 previewId + sourceSha256
→ compile（重新计算 preview 并比较确认）
→ Snapshot v1
→ DeviceLink stage / verify / activate
```

`sourceSha256` 固定完整 draft；preview receipt 通过 `presentationPolicyVersion` 冻结展示合同，并携带 `logicalOid`、标签、transcript、播放策略及有序 clip 信息。每个 clip 的 SHA-256 进入 binding 内容哈希，全部有序展示证据再进入 `previewId`。因此确认同时约束编辑内容、展示顺序和实际音频字节，旧确认不会随内容变化继续匹配。

编译时对 confirmation 的 JCS 规范语义计算 SHA-256，并把它写入编译报告与 Snapshot evidence reference；原文件字节哈希只留主机报告诊断。`confirmationId` 与语义哈希共同提供确认追溯，LF/CRLF 表示差异不改写 Snapshot 身份。

## 黄金夹具真值

| 项 | 当前值 |
|---|---|
| 状态 | `design-fixture` |
| `fixtureOnly` | `true` |
| binding / clip | 6 / 10 |
| 逻辑 OID | `YIMI-EVT0-013` … `YIMI-EVT0-018` |
| 物理映射 | `physicalMapStatus: unassigned`，全部 `physicalCode: null` |
| 目标板 / 最低固件 | `UNFROZEN` / `UNFROZEN` |
| codec 夹具 | `WAV_PCM16_16K_MONO` |

黄金 WAV 是短时确定性测试声；`family-recording` 与 `system-tts` 在这里是来源语义覆盖，不是实际家庭素材或在线服务调用证据。

`golden/confirmation.json` 仅用于测试。真实家庭/生产确认记录应由当次预听交互产生，使用 `fixtureOnly: false`，并绑定当次的 `previewId` 与 `sourceSha256`；黄金确认标识、时间和哈希不作为用户确认。生产确认还需要家庭协调层定义可审计的 trust contract；当前编译器拒绝非 fixture 确认，不以调用方自报布尔值替代该信任证据。

Draft 使用 `sourceProducer` 描述编辑来源；Snapshot manifest 的 `producer` 由 Family Alpha 编译器常量写入，两者不混用。

## 主机回归

```powershell
npm run test:family-alpha-compiler
```

当前结果：黄金 preview 对象及字节精确匹配，两次独立编译输出树一致，27/27 负向场景通过且 27/27 失败零副作用。报告位于忽略提交的 `build/family-alpha-validation/report.json`，只引用统一 ReleaseGateCatalog；唯一发布状态由 `build/release-gate-current/release-decision.json` 派生。DeviceLink 投影保持 manifest-first，发布 Schema 按预期拒绝 `design:` ID。

WAV 夹具只接受 canonical RIFF/WAVE：44-byte header、单一 16-byte `fmt `、紧接单一 `data`、PCM16/16 kHz/mono，声明长度与实际文件完全一致；metadata chunk 和 trailing bytes 会被拒绝。

## Snapshot 数据边界

编译后的 Snapshot 包含逻辑索引、动作、最终确认 WAV、文件哈希和安装元数据。它排除：

- 原始录音/训练样本与废弃 take；
- voice model；
- 家庭照片；
- 云凭据；
- 标签、transcript、`sourceKind` 等编辑域字段。

最终确认的家庭录音 clip 是设备播放资产，因此会进入 `audio/`；原始素材和音色资产继续留在家庭域。

## 当前开放项

- 013–018 尚是逻辑码，真实码生成、印刷、两批次/两光头读取证据待补；
- `BOARD_TARGET`、设备 codec/profile 和固件最低版本待板级证据冻结；
- Family Alpha 当前只签发 `design-fixture`；`release-candidate` 等待机器可读 release-gate receipt；
- 真实确认等待家庭协调层 trust provider；
- 当前只覆盖主机/design fixture；真实 USB、重连、目标存储持久化、掉电、激活/回滚和离线播放待 HIL；
- Alpha 编译/preview 输出只落在仓库 `build/` 下；此合同目录不是装机发布目录。
