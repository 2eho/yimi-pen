# Capsule: asset-vault-recovery-v1

- Date: 2026-08-04
- Project: yimi-pen
- Memory ID: asset-vault-recovery-v1
- Memory class: durable-fact
- Scope: companion主机asset-vault maintenance在受控进程中断后的持久化journal与startup recovery
- Owner: `apps/companion-app/src/asset-vault/`；`apps/companion-app/src/family-workspace/`只拥有固定策略和启动组合接线
- Evidence basis: Node v22 `rename`/`FileHandle.sync`、POSIX `rename`、Linux `fsync(2)`与Windows `MoveFileEx`/`FlushFileBuffers`的一手接口语义；结论只覆盖已等待文件系统调用后的namespace恢复，不外推真实掉电耐久。
- Journal contract: `.maintenance/op-<sha256(operationId)>/journal.json`使用canonical JCS bytes，绑定operation、plan、reference state、inventory、固定limits与严格有序`relativePath/sha256/bytes/modifiedAt/versionToken`候选；phase为`QUARANTINING|PURGING`，purge逐项持久记录连续已删前缀。
- Recovery invariant: QUARANTINING只回迁验证过的quarantine对象；PURGING只接受journal checkpoint或其后1项的物理连续缺失前缀，保留已删前缀并恢复后缀；双存、非连续缺口、未知条目、非canonical journal、path/hash/mtime异常均保留现场并失败闭合。
- Composition: `createFamilyWorkspace()`要求显式`maintenanceLimits`，在repository/capture/capability初始化前恢复；plan/apply/journal/recovery共用策略。恢复后只返回identity-bound receipt并要求fresh inventory/plan，不续跑旧apply。
- Evidence: 6个真实child-process退出窗口、二次启动幂等、fresh-plan/apply收敛与5类负例共70/70；报告`build/companion-asset-vault-recovery-validation/report.json`，SHA-256 `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`；原maintenance 21/21与workspace 34/34身份保持；主审无P0/P1。
- Protected modules: 只改App-local vault contract/adapter/use-case、FamilyWorkspace启动接线、runner、脚本/架构策略/文档；FamilyRepository/Export/Compiler、`packages/*/src`、Snapshot/DeviceLink及硬件保持。
- Boundaries: cross-process writer/OS lock、root replacement/TOCTOU、parent-directory fsync/durable replace、恢复回执持久审计、真实断电/控制器/可移动介质和设备端内容GC保持独立证据门。
- Hardware sync: `BOARD_TARGET=UNRESOLVED`，HardwareSystem 425/425且18条binding待证据；Shared HTTP POC 31/31+20/20且live保护态零变化；Benchmark Seller 20/20+9/9但外部原件仍为0。无codec/storage/USB/OID event/board adapter新绑定，`hardwareImpact=NONE`。
- Failed/avoided paths: 不凭目录冲突猜恢复状态；不续跑旧plan；不把journal放入FamilyRevision；不把host恢复当设备存储或掉电证据；不为单一消费者提前建立跨App存储框架。
- Next exact step: `SW-AUTHORING-PRODUCT-SHELL-01A`；以成熟产品官方任务流为依据，先冻结framework-neutral source/permission/metadata/prelisten/confirmation会话合同与失败矩阵，再复用FamilyWorkspace capability。

## Run Audit - 2026-08-04

- Verdict: scoped package green；整体软件目标继续active。
- Rerank: product shell 86 > workspace lifecycle 66 > cross-process writer lease 61 > production authority 60 > device install composition 59。
- Final validation: aggregate、contracts、typecheck/books、memory checks与`validate:full`均通过；sealed身份由`build/`权威工件持有。
