# Asset Vault Recovery v1

> 状态：单进程 App-owned workspace 的进程中断恢复已实现；child-process 验收 70/70。  
> 实现：`apps/companion-app/src/asset-vault/`  
> 上位约束：[Asset Vault Maintenance v1](./asset-vault-maintenance-v1.md) · [FamilyWorkspace v1](./family-workspace-v1.md)

## 1. 证据与边界

旧维护事务在内存中记录 `moved` 与 `purged`。进程若在文件 rename/remove 已完成而数组尚未更新时退出，
`.maintenance` 会留下隔离对象，下一次操作只能观察到冲突，缺少可复算的 operation/plan/candidate 身份。

恢复顺序依据以下一手接口语义：

- [Node.js `fsPromises.rename`](https://nodejs.org/download/release/v22.23.1/docs/api/fs.html#fspromisesrenameoldpath-newpath)；
- [Node.js `FileHandle.sync`](https://nodejs.org/download/release/v22.23.1/docs/api/fs.html#filehandlesync)；
- [POSIX `rename()`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)；
- [Linux `fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html)；
- [Windows `MoveFileEx`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexa) 与
  [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)。

本包证明等待完成的文件系统调用之后，进程终止并重新启动时可按 namespace 状态恢复。文件本身执行
`sync()` 后再 rename journal；父目录同步、控制器缓存、真实掉电和可移动介质耐久仍是单独证据门。

## 2. 持久化布局与合同

```text
asset-vault/
  .maintenance/
    op-<sha256(operationId)>/
      journal.json
      journal.next.json       # 原子发布中的临时槽；稳定态不存在
      quarantine/
        <sha256>.wav
```

`asset-vault-maintenance-journal-v1` 使用 JCS identity，并严格绑定：

- `operationId` 与 operation 目录 hash；
- 重验后的 `planId`、`referenceStateSha256`、`inventoryId`；
- workspace 固定的 `limits`；
- 严格排序的全部 candidate：`relativePath/sha256/bytes/modifiedAt/versionToken`；
- `phase=QUARANTINING|PURGING` 与 `committedPurgeCount`。

Journal 字节必须正好等于 canonical JSON 加一个换行；重复键、额外空白、额外字段、ID漂移、路径漂移、
candidate token漂移和资源策略漂移均进入恢复阻断。首个资产 rename 发生前，完整 journal 已发布。

## 3. 正常事务顺序

1. 在引用稳定租约内重算 repository backup、inventory 与 plan；
2. 复核 candidate version token；
3. 写 `journal.next.json`、执行 file sync、rename 为 `journal.json`；
4. 逐项 `source → quarantine`，每项重新复算 bytes/SHA-256；
5. 发布 `phase=PURGING, committedPurgeCount=0`；
6. 每次 physical remove 成功后发布递增的连续前缀；
7. 全部完成后清除 quarantine、journal、operation 与空 maintenance 根；
8. 返回原有 maintenance result，成功 API 语义保持。

## 4. 启动恢复状态机

FamilyWorkspace 在 repository 初始化、capture adapter 构造和 capability 暴露之前，先执行
`recoverInterruptedMaintenance({ limits })`。因此 import、authoring、maintenance 与 export 看到的 vault 已经归一化。

| Journal/磁盘状态 | 恢复动作 | 回执 |
|---|---|---|
| maintenance 根不存在 | 只读通过 | `NO_PENDING_OPERATION` |
| pre-journal 空 operation | 清理受控空目录 | `EMPTY_OPERATION_CLEANED` |
| `QUARANTINING`，candidate 位于 source 或 quarantine | 逐字节校验后回迁 quarantine 对象 | `ROLLED_BACK_BEFORE_PURGE` |
| `PURGING`，连续双缺失前缀 + source/quarantine 后缀 | 保留已删除前缀，回迁仍隔离对象 | `PARTIAL_PURGE_RECOVERED` |
| 最后一次 remove 已完成、checkpoint 落后1项 | 以物理状态补齐连续前缀并清理 | `PARTIAL_PURGE_RECOVERED` |
| 双存、非连续缺口、未知文件、journal/path/hash/mtime异常 | 保留现场并返回明确错误码 | recovery blocked |

恢复回执绑定 journal、已删除前缀、当前启动实际回迁项、回收字节数和恢复后 inventory ID，且设置
`requiresFreshPlan=true`。旧 apply 不自动续跑；调用方重新 inventory→plan→apply。

## 5. 固定 workspace 策略

`createFamilyWorkspace()` 现在要求显式 `maintenanceLimits`。同一 workspace 的 plan、apply、journal 与 startup
recovery 共用该策略；调用方传入不同策略会收到 `FAMILY_WORKSPACE_LIMIT_INVALID`。这避免 UI 页面、后台任务和
恢复路径分别选择资源边界。

## 6. 验收

```powershell
npm run test:companion-asset-vault-recovery
```

当前结果：

- 70/70；
- 连续两次报告字节一致；
- report SHA-256：`65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`；
- 报告：`build/companion-asset-vault-recovery-validation/report.json`。

六个真实 child-process 终止点覆盖：journal 后/首个 move 前、首个 move 后、purge 前、首个 remove 后/
checkpoint 前、已 checkpoint 前缀后、最后 remove 后/最终 checkpoint 前。每个场景均由新的 Node 进程经
FamilyWorkspace 重开，复核 recovery receipt、fresh inventory/plan、第二次启动幂等和最终 fresh apply。

五类负向覆盖 canonical journal 篡改、quarantine 字节篡改、非连续删除前缀、未知 operation entry 和
source/quarantine 双存；现场均保留。

## 7. 保持的后续门

- 跨进程 writer 与 OS lock；
- root replacement/TOCTOU；
- 父目录 fsync 与平台专用 durable replace；
- 真实断电、控制器缓存和目标介质；
- recovery receipt 的长期审计归档；
- 设备端内容存储与 GC。

`BOARD_TARGET=UNRESOLVED`，硬件线尚无 codec/storage/USB/OID event/board adapter 新绑定，本包
`hardwareImpact=NONE`。
