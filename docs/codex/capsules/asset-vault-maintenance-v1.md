# Capsule: asset-vault-maintenance-v1

- Date: 2026-08-04
- Project: yimi-pen
- Memory ID: asset-vault-maintenance-v1
- Memory class: durable-fact
- Scope: companion 主机内容寻址资产的全历史保护、dry-run、显式保留期与条件 orphan 回收
- Owner: `apps/companion-app/src/asset-vault/`；FamilyRepository/Export/Authoring/Compiler 稳定合同保持外部 owner
- Evidence derivation: canonical import 在 revision CAS 前发布不可变 WAV，取消/陈旧 CAS 可留下 orphan；Family Export 的 `collectReferencedFamilyAssets` 已证明全部历史 revision 的唯一引用闭包，因此维护用例直接复用它而不复制遍历。
- Flow: verified RepositoryBackup → all-history digest marks + byte-verified local inventory → immutable plan → stable reference lease + fresh backup/inventory → exact plan identity → conditional quarantine/purge。
- Safety invariants: 引用/缺失/篡改/异常条目形成 blocker；老 orphan 才可删除，年轻 orphan 保留；新引用、bytes/mtime 或 inventory 变化使 plan stale；所有 reference mutation 必须经同一个 `FamilyAssetReferenceCoordinator`。
- Evidence: 真实文件与故障注入 21/21；11个历史 digest 全部保护；报告 SHA-256 `c56e2acd468518334d8fb299ceb7d99aa0c4135f6c65b1ee810e067dc9b164df`，连续两次字节一致；提交前 quarantine 故障全回滚，捕获到的部分 purge 明确回执、恢复剩余对象并可重规划；companion aggregate 与 `validate:contracts` 通过，架构585/585。
- Recovery closeout: `SW-ASSET-VAULT-RECOVERY-01A` 已用canonical journal把plan/reference/inventory/limits/候选持久绑定，并由FamilyWorkspace启动归一化；6个child-process退出窗口与5类负例共70/70，SHA-256 `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`。
- Boundaries: 当前证明单进程App-owned目录及受控进程退出恢复；跨进程writer、持续I/O故障的运维入口/未恢复路径、父目录fsync、不可信根替换/流式资源门、持久审计、设备介质和设备端GC保持独立门。
- Hardware sync: `BOARD_TARGET=UNRESOLVED`、HardwareSystem 425/425、18条 target binding 待证据；本包不改变 codec/OID/USB/storage 接口，增量影响 `NONE`。
- Failed/avoided paths: 不按 current head 做 mark；不让每个 source adapter 自带清理；不把路径/GC 状态写入 FamilyRevision；不新增平行合同或提前提取跨 App package。
- Composition closeout: `SW-FAMILY-WORKSPACE-COMPOSITION-01` 已完成，App-local factory 私有创建 Atomic JSON repository、vault、coordinator 与 source ports；34/34 报告 SHA-256 为 `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`。
- Next exact step: `SW-AUTHORING-PRODUCT-SHELL-01A`；复用已归一化FamilyWorkspace capability构建framework-neutral authoring会话内核。

## Run Audit - 2026-08-04

- Verdict: scoped package green；整体软件目标继续 active。
- Protected scope: 只新增 companion App-local 文件和文档/脚本接线；`packages/*/src`、稳定 Family/Export/Compiler/authoring/prelisten 与硬件文件保持。
- Tests: asset-vault 21/21；companion aggregate PASS；contracts PASS；architecture 585/585；typecheck/books PASS。
- Open evidence retained: cross-process locking、parent-directory durability、persistent recovery audit、真实掉电与device storage GC。
