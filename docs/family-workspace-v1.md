# FamilyWorkspace v1

> 状态：App-local 产品组合根已实现；真实文件系统验收 34/34。  
> 实现：`apps/companion-app/src/family-workspace/`  
> 上位约束：[高复用、低维护架构](./reuse-maintainability.md) · [Family Authoring v1](./family-authoring-v1.md) · [Asset Vault Maintenance v1](./asset-vault-maintenance-v1.md)

## 1. 为什么现在收敛组合根

现有软件已经分别证明：

- Atomic JSON FamilyRepository 的 revision/CAS、backup、portable restore 和 outbox；
- canonical WAV 文件/录音导入与 Family authoring；
- Family Export v1 的全部历史资产闭包；
- asset-vault dry-run、稳定引用租约和条件 orphan 回收。

这些能力若由每个页面或 runner 分别构造 repository、vault 和 coordinator，同一进程里就可能出现两条互不知情的队列：一条提交新引用，另一条按旧引用删除资产。`FamilyWorkspace v1` 把这个风险收敛为一个产品入口，不新增领域合同，也不复制已有用例。

## 2. 固定布局与唯一实例

```text
WORKSPACE_ROOT/
  family-workspace.json
  repository/
    repository.format
    state.json
  asset-vault/
    assets/sha256/<sha256>.wav
  capture-staging/
```

调用方给出允许根、workspace 目录、`repositoryId`、canonical WAV probe、固定 `maintenanceLimits` 和可选 capture adapter factory。factory 私有创建：

1. `AtomicJsonFamilyRepository`；
2. `createLocalContentAddressedAudioVault`；
3. `createFamilyAssetReferenceCoordinator`；
4. file import 与 capture→import 端口。

在 repository/capture/capability 初始化之前，factory 先执行 asset-vault startup recovery；descriptor 持有
本次 recovery receipt。plan、apply、journal 与重启恢复共用同一 `maintenanceLimits`，策略漂移会被拒绝。

同一进程、同一路径和同一配置重复打开时返回同一个 capability object；配置发生变化时返回 `FAMILY_WORKSPACE_ALREADY_OPEN`。因此一个 App 生命周期内只有一条引用/资产互斥队列。跨进程 writer 仍由后续持久化锁/lease包负责。

已有但缺少 `family-workspace.json` 的目录不会被自动认领，避免把 Family Export v1 的平铺恢复目录误当 canonical workspace。

## 3. Capability API

公开对象仅包含以下能力：

```text
descriptor
read.open / loadHead / loadRevision / readOutbox
authoring.importFile / captureAndImport
authoring.commitInitialRevision / commitImportedClipReplacement
maintenance.plan / apply
transfer.exportComplete
```

公开表面不含 `repository`、`coordinator`、`vault`、根路径、通用 `commit` 或自选 `referencePort/vaultPort`。UI 和未来产品壳只能提交语义化命令及接收 DTO/receipt。

## 4. 同一协调队列的不变量

以下操作共用 factory 私有创建的一个 `FamilyAssetReferenceCoordinator`：

| 操作 | 协调方式 | 原因 |
|---|---|---|
| 文件导入 | `withReferenceMutation` | GC lease 期间重导入同 digest 会排队，形成“先删、后重新发布”的确定顺序 |
| capture→import | capture 临时源在外，发布到 vault 的 import 在队列内 | 临时文件由 CapturePort 清理；vault 发布与维护串行 |
| 初始 revision | `withReferenceMutation` | 先逐字节核对全部引用资产，再提交初始 head |
| clip replacement | `withReferenceMutation` | 在队列内重算 canonical path、bytes、SHA-256 和 codec 后再 CAS |
| maintenance apply | `withStableReferenceSnapshot` | lease 内复算 backup/inventory/plan，再条件删除 |
| complete export | `withStableReferenceSnapshot` | backup 与全部历史资产读取处于同一引用状态 |
| portable repository restore | `withReferenceMutation` | 空仓库恢复与其资产发布使用同一顺序 |

这使“导入成功后又被同一轮 GC 删除”的旧竞态成为机器回归项。验收同时证明 maintenance 先取得 lease 时，file import 和 authoring mutation排在其后；GC 删除旧对象后，排队的 import 才重新发布内容。

## 5. Family Export v1 的 canonical adoption

两个稳定布局保持各自含义：

```text
Family Export v1: assets/<sha256>.bin
FamilyWorkspace v1: asset-vault/assets/sha256/<sha256>.wav
```

`restoreFamilyWorkspaceFromCompleteExport()` 不改变旧导出或旧恢复函数。它执行：

1. 调用现有 `inspectCompleteFamilyExport()` 复算 manifest、backup、精确文件闭包和全部资产字节；
2. 在允许根的随机 staging workspace 中，把每个唯一 digest 重新 probe 为 `WAV_PCM16_16K_MONO`；
3. 以既有 `importCanonicalWav()` 发布到 workspace canonical vault；
4. 经同一 coordinator 调用 Atomic repository `restorePortable()`；
5. 核对 head 后原子 rename；
6. 以新 composition root 重开并验证 distinct replica epoch。

因此 Family Export 仍是通用 `.bin` 传输合同，FamilyWorkspace adoption 则明确限定为当前 canonical WAV 产品 profile。staging 中途失败会按受控路径清理；rename 后 capture adapter 配置失败也会先验证 workspace marker/真实路径，再清理已发布目标，随后可用相同目标重试。

## 6. 验收证据

命令：

```powershell
npm run test:companion-family-workspace
```

当前结果：

- 34/34；
- report SHA-256：`094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`；
- 报告：`build/companion-family-workspace-validation/report.json`。

覆盖：真实 Atomic JSON 目录、10个基准资产、幂等 import、capture 清理、伪造 receipt、初始 revision、两次 authoring、同一队列双向等待、maintenance delete/reimport 顺序、旧 plan 失效、完整导出、同进程唯一实例、未标记目录隔离、canonical portable adoption、distinct epoch、staging 清理、发布后配置失败原子性与重试。

## 7. 复用收益与边界

- 新文件/TTS/录音来源只新增 CapturePort 或 source adapter，后续 import/authoring/GC/export 保持同一路径；
- 新产品 UI 通过 [`Authoring Product Shell v1`](./authoring-product-shell-v1.md) 只调用 capability API；
  33/33验收已证明FILE/CAPTURE、内容寻址权限receipt、adapter异常代码归类、command factory单飞、冻结command、精确重放、stale conflict和bound review receipt都不暴露
  repository/vault事务对象；
- 第二个独立产品壳出现前继续留在 companion App 内，暂不建立跨 App application package；
- 持久化 purge journal 与进程重启恢复已由 [`Asset Vault Recovery v1`](./asset-vault-recovery-v1.md) 收口；跨进程 lease、父目录 fsync、真实介质掉电、产品数据库迁移和设备端 GC 保持独立证据门；
- `BOARD_TARGET=UNRESOLVED`，当前硬件线没有 codec、storage、USB、OID event 或 board adapter 新绑定，本包硬件增量影响为 `NONE`。
