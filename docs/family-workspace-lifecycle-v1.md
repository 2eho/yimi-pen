# FamilyWorkspace Lifecycle v1

`FamilyWorkspace` 仍是 App-local 的组合根。生命周期 v1 把现有
`family-workspace.json` 身份 marker 与同目录的
`family-workspace-lifecycle.json` 侧车组合起来，只负责本地发现、打开、关闭和可逆归档；
内容、CAS、asset vault、导出和恢复继续由既有模块持有。

## 侧车合同

侧车必须是 UTF-8、严格 JSON、固定缩进和末尾换行的 canonical bytes，且只能含下列字段：

| 字段 | 约束 |
| --- | --- |
| `schemaVersion` | `1` |
| `profile` | `family-workspace-lifecycle-v1` |
| `workspaceId` | 等于 `family-workspace.json.repositoryId` |
| `workspaceDirectoryName` | allowed root 的安全 direct-child 名称 |
| `state` | `ACTIVE` 或 `ARCHIVED` |
| `createdAt` / `updatedAt` | strict RFC3339 |
| `lastOperationId` | 可重放的 printable Unicode operation token |
| `markerSha256` | marker canonical bytes 的小写 SHA-256 |
| `descriptorId` | `family-workspace-lifecycle:sha256:` 加上 descriptor（去掉 `descriptorId`）的 JCS-SHA256 |

读侧不修复、不写 `lastOpenedAt` 或显示名称。重复 key、额外 key、lone surrogate、非法 UTF-8、
非 canonical bytes、marker/目录身份不符、marker hash 不符、路径穿越、嵌套路径、symlink 和 staging
root 都不会进入 `list()` 的结果；缺 marker、缺 sidecar 或 invalid sidecar 的目录均被忽略，显式
`open/read` 才返回对应的 unmanaged/invalid 错误。

## 用例与端口

```text
FamilyWorkspaceLifecycle service
  -> WorkspaceDirectoryPort
       -> direct-child scan / marker validation
       -> atomic sidecar write-CAS
  -> FamilyWorkspaceFactoryPort
       -> existing createFamilyWorkspace composition root
  -> WorkspaceClock / operation-id input
```

实现位于 `apps/companion-app/src/family-workspace-lifecycle/`：

- `family-workspace-lifecycle-contract.mjs`：纯 descriptor 合同、JCS identity 和错误码；
- `family-workspace-lifecycle-filesystem-adapter.mjs`：只扫描 direct-child regular directories，
  create/write-CAS 先取得短生命周期的 same-directory `wx` lock，再做 definitive read/compare；
  侧车使用 exclusive temp → write → file sync → close → rename → reload/verify；lock 不等待、不回收，
  finally 只做 best-effort/token-checked cleanup；进程崩溃、句柄关闭失败或清理失败仍可能留下 stale lock，
  这是明确的 v1 风险。
- `family-workspace-lifecycle-service.mjs`：Promise single-flight、发布顺序、状态转换和 capability map；
- `run-family-workspace-lifecycle-acceptance.mjs`：确定性 acceptance/report runner。

archive/unarchive 命令必须带 `operationId` 与 `expectedDescriptorId`。相同 operationId/state 的重放
直接返回已持久化 descriptor；其他命令先比对 caller descriptor identity，再关闭 handle 或做 CAS。
文件 sync 是本包声明的 durability 边界；短 lock 只保护当前临界区，不是跨进程 writer lease，不等待、
不做 stale-owner reclamation；不宣称 parent-directory fsync、root replacement race 或突然掉电后的完整
持久化证明。

## 当前生命周期地图

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| create | 已实现 | 先完成既有 FamilyWorkspace 初始化，再发布侧车；失败目录保持 unmanaged/retryable |
| list | 已实现 | 只读 direct-child scan，按 `workspaceId`、目录名 ordinal 排序 |
| open / reopen | 已实现 | ACTIVE 才能 compose；ARCHIVED 在 content mutation 前拒绝；同进程旧 capability 不复用 |
| close | 已实现 | 只释放精确注册且 idle 的 capability；active operation 返回 `FAMILY_WORKSPACE_BUSY` |
| archive / unarchive | 已实现 | 侧车 metadata-only CAS，目标状态幂等；archive 可先关闭 idle lifecycle-owned handle |
| delete | 有意分开 | 永久删除不属于 v1；既有递归清理仅用于失败回滚 |
| export / import restore | 有意分开 | Family Export v1 负责内容迁移与 portable restore，不等同于 archive |
| backup / restore | 有意分开 | repository/asset-vault 既有 backup/restore 语义不被生命周期侧车复制 |
| schema migration | 范围外 | 需要独立版本迁移证据，本包不改变 FamilyRevision/FamilyRepository schema |
| device replacement / DeviceDelivery | 范围外 | 生命周期状态不代表设备安装、替换或传输完成 |
| cross-process writer lease | 范围外 | 短 same-directory lock 不延长为跨进程 lease；不等待、不回收 stale lock，崩溃残留需人工/独立恢复门 |
| offlineReady | 有意分开 | lifecycle `ACTIVE` 不提升编译、设备或离线就绪证据 |

## 为什么现在选这个包

证据审计记录在 `build/family-workspace-lifecycle-evidence-audit.md` 和
`build/family-workspace-lifecycle-repo-gap-audit.md`。在统一的 maturity/repository/engineering
尺度下，当前选择的 normalized benefit 为：

| 候选 | benefit | 当前结论 |
| --- | ---: | --- |
| workspace list/open/archive lifecycle | 66 | 选中；直接关闭 App-local registry gap，复用所有既有 content/CAS/asset 语义 |
| export/import backup + restore | 51 | 已有稳定 Family Export v1；新增生命周期收益较小 |
| schema migration | 43 | 没有已证实的当前 schema 缺口 |
| cross-process lease | 61 | 依赖更高的持久化/owner 证据，且超出当前单进程边界 |

这不是竞品内部实现的推断。Yoto、Tonies、tiptoi 和 LeapReader 的官方材料只支持成熟产品有
组织/回访/同步等用户可见阶段；仓库事实支持现有 FamilyWorkspace 缺少 list/close/archive，
而 FamilyRevision、FamilyRepository、asset-vault、authoring、export/restore 已有稳定证据。

## 验收与保护

Acceptance 覆盖空根/排序、marker 与 sidecar、unmanaged/nested/staging/symlink 排除、创建发布顺序、
same-process identity、composition drift、busy close、旧 capability 拒绝、distinct reopen/head、
archive raw-byte 不变、archived open、caller descriptor stale/replay、unarchive 幂等、相同 repositoryId
的 path-owned replicas、显式 closer port、路径/时钟/Unicode/Windows 名称合同、sidecar retry、短 lock
竞争、stale CAS、duplicate/noncanonical/identity descriptor、pre/post-rename fault truth、双 workspace
隔离、fresh-child discovery/open/close/reopen 和公共摘要隐私。existing FamilyWorkspace 34/34 继续保持。

稳定保护判断：不修改 FamilyRevision、FamilyRepository、CAS/replay、asset-vault、authoring/session/recovery/
TTS/capture/prelisten、compiler、admin-web、device-sim、DeviceLink、hardware、firmware、EDA、procurement
或 target bindings；唯一受控 seam 是 `family-workspace.mjs` 的 public-operation counter、closed flag 和
exact idle close/release。

## 回滚边界

回滚只需移除 lifecycle 新模块、文档、验收报告和各 workspace 的 lifecycle sidecar，并回退上述最小 registry
seam。archive/unarchive 只改变 sidecar metadata；不会删除、移动或重写 repository、vault、历史 revision、
export bytes。若 sidecar 发布失败，目录可重试但不会被 `list()` 采用。

## 与硬件同步

本包的硬件输入快照仍为 `BOARD_TARGET=UNRESOLVED`、18/18 `TARGET_EVIDENCE_PENDING`、
`hardwareImpact=NONE`。生命周期包不改变任何硬件、设备安装、codec、USB、OID 或 offlineReady 合同。
