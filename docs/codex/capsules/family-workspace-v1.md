# Capsule: family-workspace-v1

- Date: 2026-08-04
- Project: yimi-pen
- Memory ID: family-workspace-v1
- Memory class: durable-fact
- Scope: companion App 内 FamilyRepository、canonical asset vault、source ports 与引用维护的唯一组合根
- Owner: `apps/companion-app/src/family-workspace/`；稳定 Family/Export/Compiler/Authoring/Prelisten 合同保持各自 owner
- Architecture: `createFamilyWorkspace()` 私有创建真实 Atomic JSON repository、content-addressed WAV vault、一个 `FamilyAssetReferenceCoordinator` 与 file/capture import ports；公开面仅有 read/authoring/maintenance/transfer capability。
- Coordination invariant: import、revision mutation、maintenance apply、complete export 与 portable restore 共用同一 coordinator；验收以阻塞 probe 和 maintenance lease 复现顺序，关闭 GC lease 期间重导入同 digest 的删除竞态。
- Export adoption: Family Export v1 继续保留 `assets/<sha>.bin`；workspace restore 先由既有 inspector 复算精确闭包，再在受控 staging 中 probe/import 为 `asset-vault/assets/sha256/<sha>.wav`，最后 portable restore 并验证 distinct replica epoch。
- Evidence: 真实 Atomic JSON、10个 golden WAV、capture cleanup、伪造 receipt、同进程 singleton、未标记目录隔离、staging/publish failure cleanup 与 retry 共34/34；报告 SHA-256 `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`；独立复审无 P0/P1。
- Protected modules: 本包只新增 App-local `family-workspace/`、脚本接线、架构策略和文档；`packages/*/src`、FamilyRepository/Export/Compiler/Authoring/Prelisten、admin-web/device-sim 与硬件文件保持原有语义。
- Recovery extension: 组合接线已完成；恢复合同、证据身份与剩余门只读路由到`asset-vault-recovery-v1`。
- Boundaries: 当前证据覆盖单进程App-owned目录与受控purge进程退出；多进程writer、根替换race、父目录fsync、恢复审计、真实介质掉电与多库close生命周期保持独立包。
- Hardware sync: `BOARD_TARGET=UNRESOLVED`；HardwareSystem 425/425且18条 target binding待实物证据。Benchmark Seller Evidence 为20/20合同与9/9准备自检，request仍为 `PREPARED_NOT_SENT`，raw/records/complete为0；没有 codec/storage/USB/OID event/board adapter 新绑定，本包影响 `NONE`。
- Next exact step: `SW-AUTHORING-PRODUCT-SHELL-01A`，先组合source/permission/metadata/prelisten/confirmation会话内核，再按真实消费者评估多库生命周期。

## Run Audit - 2026-08-04

- Verdict: scoped package green；整体软件目标继续 active。
- Tests: FamilyWorkspace 34/34，report SHA-256 `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`；独立审查、architecture 与 aggregate 回归通过，最终 sealed full 由本轮收口运行生成。
- Rerank: product shell以86分第一；完整候选表路由到软件active anchor。
