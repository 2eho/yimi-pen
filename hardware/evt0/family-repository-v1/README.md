# FamilyRevision / BuildRequest v1

此目录关闭架构门 `FAMILY_REVISION_BUILD_REQUEST_SPLIT`，把长期家庭事实与一次目标构建
彻底分开，并冻结 FamilyRepository 聚合、backup 和 adapter-neutral transcript。当前阶段仍是
主机合同；Atomic JSON 是开发/黄金适配器，产品存储与目标耐久保留独立证据门。

## 合同所有权

| 工件 | 所有内容 |
|---|---|
| [`family-revision.schema.json`](./family-revision.schema.json) | target-neutral、不可变的家庭 revision |
| [`build-request.schema.json`](./build-request.schema.json) | 一次构建解析后的 target/map/codec/asset/confirmation 输入 |
| [`golden/family-revision.json`](./golden/family-revision.json) | 6 binding / 10 clip 的家庭事实真值 |
| [`golden/build-request.json`](./golden/build-request.json) | 对应 Alpha 设计构建请求 |
| [`repository-format.schema.json`](./repository-format.schema.json) | Atomic JSON repository 身份 marker |
| [`repository-state.schema.json`](./repository-state.schema.json) | revision chain、scope、outbox cursor、operation journal 与 live-state 身份 |
| [`repository-backup.schema.json`](./repository-backup.schema.json) | 可导入/导出的语义 backup 与身份 |
| [`repository-conformance.json`](./repository-conformance.json) | 所有存储 adapter 共用的 16 步 transcript |

`FamilyRevision` 保存逻辑 OID、编辑内容、稳定 `assetId`、资产字节数/SHA-256 和逐 binding
revision。它不保存 board、firmware、物理码、文件路径、codec 或发布状态。

`BuildRequest` 保存：

- 精确 `familyRevisionId` 与 confirmation 身份；
- target profile、物理映射 revision、codec profile；
- 解析后的最小 asset catalog；
- fixture/release 模式与 release receipt 引用；
- 预期 `CompileDraftProjection` 语义哈希。

## 身份与投影

`revisionId` 是移除自身字段后对整个 FamilyRevision 做 RFC 8785/JCS 规范化所得的
`sha256:` 身份。bindings 必须按 `logicalOid` 严格排序；`actionId` 不形成第二事实字段，
而由 `binding-<suffix> → action-<suffix>` 确定投影。

```text
FamilyRevision
  + BuildRequest
  + AssetReader port
  → CompileDraftProjection（family-alpha-draft-v1）
  → preview / confirmation recheck
  → Snapshot
```

适配器位于 [`tools/family-build-adapter`](../../../tools/family-build-adapter/)。黄金结果要求：

- 当前 Alpha draft 逐字节一致；
- revision 身份、confirmation 与 preview 身份一致；
- 10 个 resolved asset 的 bytes/SHA-256 一致；
- FamilyRevision target-neutral 键扫描通过；
- 20/20 负向场景及 20/20 零副作用通过。

## 当前边界

- Adapter v1 只接受 source codec 与 snapshot codec 相同；转码属于后续显式 `TranscodePlan`，
  不在投影时静默发生。
- `release-candidate` Schema 需要 assigned map 与 receipt；现有 Family Alpha 编译器仍保持
  design-fixture 路线。
- 内存与 Atomic JSON repository 已共同消费同一聚合 conformance suite；实现位于
  [`tools/family-repository`](../../../tools/family-repository/)。
- repository 以 `repositoryId` 和首次提交的 `familyLibraryId` 固定 scope；跨 scope backup
  被拒绝，restore/recovery 事件携带 backup 与损坏字节摘要。
- revision store 是 append-only graph；正常 restore 合并缺失实体并只移动 active head，
  所以后续 revision 仍可按 ID 审计或另行恢复，不以回滚动作删除历史内容。
- outbox cursor 是 `(epoch, sequence)`；backup recovery 创建新 epoch，避免旧 sequence 游标
  把恢复后的事件误认为已经消费。
- bindingRevision、revision/command 时间线、live-state 完整性和 operation/outbox 对齐均由
  共享语义 core 验证；build adapter 复用同一个 FamilyRevision 合同实现。
- Atomic JSON 的显式初始化、CAS、fault-before-rename、并发单赢家、格式归一化和 backup
  恢复已进入主机门。进程崩溃、父目录 fsync、stale-lock 自动处置和目标介质掉电属于后续
  adapter/实物证据；SQLite 在产品端出现第二个真实消费者后接入同一 suite。
