# Active Task

- Package: `SW-FAMILY-WORKSPACE-LIFECYCLE-01`
- Status: `complete`
- Updated: 2026-08-05
- Project: `yimi-pen`
- Owner: software FamilyWorkspace lifecycle line; hardware is read-only input
- Mode: scoped-build
- Current turn: final acceptance cleanup, integrated validation, memory closeout, and evidence-only next-package rerank
- Parent route: `docs/codex/tasks/system-product-rd/active-task.md`
- Evidence reports: `build/family-workspace-lifecycle-evidence-audit.md`, `build/family-workspace-lifecycle-repo-gap-audit.md`

## Objective

Close the highest-value current FamilyWorkspace lifecycle gap without changing stable content semantics: provide deterministic local workspace discovery, active open/reopen, idle close, and reversible archive/unarchive around the existing App-local `createFamilyWorkspace()` composition root.

## Selected scope

- Add a framework-neutral App-local lifecycle contract/use case and per-workspace canonical JSON lifecycle descriptor.
- Implement `list`, `create`, `open/reopen`, `close`, `archive`, and `unarchive` at the composition boundary.
- Keep `family-workspace.json` as the existing identity marker; bind `workspaceId` to its `repositoryId`.
- Keep archive metadata-only and reversible; preserve repository state, outbox, historical assets, vault bytes and export bytes.
- Reuse the existing FamilyWorkspace public capabilities and existing Family Export v1 / portable restore path.

## Explicit non-goals

- No permanent user-data delete API; existing recursive cleanup remains private failure cleanup only.
- No cross-process writer lease, stale-owner reclamation, parent-directory fsync, root replacement race, or sudden-power-loss claim.
- No FamilyRevision/FamilyRepository schema change, SQLite adapter, cloud/account sync, or migration runner.
- No export-format change, DeviceLink/device replacement, target storage, codec, USB, OID, firmware or `offlineReady` behavior.
- No UI framework, OS permission prompt, cloud authority or second application package.

## Read-only evidence baseline

- FamilyWorkspace report: 34/34, SHA-256 `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`.
- Desktop authoring report: 93/93, SHA-256 `bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`.
- Existing `OPEN_WORKSPACES` is an in-memory path registry; public capability has no list/archive/close operation (`apps/companion-app/src/family-workspace/family-workspace.mjs:32-41,399-456,465-514`).
- Existing queue/asset/export/restore composition is proven and protected (`apps/companion-app/src/family-workspace/family-workspace.mjs:274-397,517-681`; report above).
- Atomic JSON open/commit/backup/restore/reopen and best-effort lock are already owned by `tools/family-repository/atomic-json-adapter.mjs`; do not duplicate them.
- Mature-product official evidence supports visible organization/revisit/sync stages but does not prove competitor internals; full fact table is in the evidence audit.

## Proposed contract boundary

```text
FamilyWorkspaceLifecycle use case
  -> WorkspaceLifecyclePort
       -> WorkspaceDirectoryPort (safe direct-child scan + sidecar atomic write)
       -> WorkspaceClock/IdPort (deterministic test inputs)
       -> FamilyWorkspaceFactoryPort (existing create/open/portable restore)
  -> companion composition root
       -> Atomic JSON lifecycle-sidecar adapter
       -> existing FamilyWorkspace capability adapter
```

Frozen sidecar: `family-workspace-lifecycle.json`, profile `family-workspace-lifecycle-v1`, with exactly `schemaVersion`, `profile`, `workspaceId`, `workspaceDirectoryName`, `state=ACTIVE|ARCHIVED`, `createdAt`, `updatedAt`, `lastOperationId`, `markerSha256`, and `descriptorId`. There is no display metadata in v1. Commands carry `operationId` and expected descriptor identity; reads do not repair or transition.

## Deterministic acceptance

1. Empty root and deterministic sorted list.
2. Valid marker inclusion; symlink/nested/staging/unmarked exclusion.
3. Create publication after repository initialization; failed publication leaves no adopted workspace.
4. Same-process idempotent open and composition drift rejection.
5. New-process list/open/reopen preserves identity, head and lifecycle state.
6. Archived open fails closed; archive/unarchive are idempotent and metadata-only.
7. Close refuses or bounded-waits while import/maintenance/export/restore is active, then releases only an idle handle.
8. Sidecar temp-write/rename fault, duplicate keys, stale descriptor CAS, marker mismatch and traversal fail with zero content mutation.
9. Two-workspace isolation.
10. Existing FamilyWorkspace/FamilyRepository/export/restore reports remain byte-stable; owned report records `hardwareImpact=NONE`, `BOARD_TARGET=UNRESOLVED`, `offlineReady=false`.

## Stable-module protection

Read-only: `packages/*/src`, FamilyRevision/CAS/replay, FamilyRepository core/Atomic JSON behavior, authoring/session/recovery/TTS/capture/prelisten, asset-vault maintenance/recovery, compiler, admin-web/device-sim, DeviceLink, hardware, EDA, procurement and all target bindings. Any existing factory touch requires a reproduced failure, exact invariant, minimal diff and protected regression rerun.

## Rollback

Git diff plus removal of only new lifecycle contract/adapter/runner/docs and per-workspace sidecars. Before descriptor rename the prior descriptor remains authoritative; after archive unarchive reverses the metadata state. No repository/vault/export bytes are moved or deleted.

## Hardware synchronization snapshot

- Completed HIL owner-extension evidence is read-only input: validator `36/36`, SHA-256 `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; selftest baseline `36/36`, `41/43` rejected and two benign accepted, SHA-256 `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`.
- `hardware/evt0/hardware-system-v1/target-binding.json` remains `targetIdentity.state=UNRESOLVED`, 18 interface bindings, all 18 `TARGET_EVIDENCE_PENDING`, SHA-256 `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`.
- Root hardware owner evidence and latest software report retain `hardwareImpact=NONE`, `offlineReady=false`; no accepted board, storage, codec, USB, OID or device-install delta changes this contract. Keep `BOARD_TARGET=UNRESOLVED` until owner evidence proves otherwise.

## Implementation progress

- Initial deterministic close/reopen regression is covered by the lifecycle runner before/against the registry seam.
- Owned implementation files are limited to `apps/companion-app/src/family-workspace-lifecycle/`, the approved FamilyWorkspace seam,
  companion package/README, the root lifecycle test script, lifecycle docs/capsule, active task, and lifecycle build report.

## Repair implementation closeout

- Status: `complete`; semantic review repairs are implemented without changing protected content/CAS, asset-vault, authoring, export/restore, hardware, firmware, EDA, procurement or target-binding inputs.
- Lifecycle acceptance: `28/28`, report SHA-256 `06ab29d813d3561b107ce242cd40084773870fc0078075fd1d21fd5353d7eabb`. Cleanup acceptance adds the valid direct-child name `my.family-workspace-project`; the overbroad `.family-workspace-` rejection and unused `mkdir` import are removed.
- Existing FamilyWorkspace: `34/34`, report SHA-256 `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`.
- Authoring product shell: `33/33`, SHA `e4dd6694ece3acfa2bde4ca80d80701c27c1143067eafe70620cd03776d88eeb`;
  authoring task recovery: `22/22`, SHA `7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`;
  desktop authoring: `93/93`, SHA `bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`;
  system TTS source: `41/41`, SHA `0721882510a282647d50316e6c410f49e110d3943839ab4c2b0c56567293cb52`;
  asset-vault recovery: `70/70`, SHA `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`.
  FamilyRepository conformance SHA `96433369a8bad64742c53699a259313e3fc738a2609315a3f9828312443b019f`,
  Family build projection SHA `5edf4e3c45c0c276fd9b5a4a09c1f9f3e236ef92aef0bf0ecdb5b62ab6715aa9`;
  companion default aggregate, typecheck and `validate:books` passed; the clean post-hardware `npm run validate:full`
  passed exactly once: Architecture `717/717`, HardwareSystem `425/425`, Product baseline `231/231`, Rust firmware
  `12/12`, host-run `host-run:sha256:9e7feea8f79121d73a23d96a292cb01792a43abc4be91664bfa267d288598841`,
  source-set `531` files / `7a0e910dfd73a151da7f995e3100be7db02fb76781e4bb14228f52d4466a0657`, ReleaseDecision
  `15 pass/0 fail/19 missing`, `releaseReady=false`, decision report SHA `5599c9c3107128226a99a0a7b19e6eb32a7223e0c16f21b4a7d462eedc030211`.
- Node syntax checks passed for all seven changed/new lifecycle/seam modules; `git diff --check` passed.
- Hardware closeout read: HIL validator `36/36`, SHA-256 `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; HIL selftest baseline `36/36`, `41/43` rejected and two benign accepted, SHA-256 `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`; `BOARD_TARGET=UNRESOLVED`, `18/18 TARGET_EVIDENCE_PENDING`, target-binding SHA-256 `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`, `hardwareImpact=NONE`, `offlineReady=false`.
- Protected/hardware touch audit: zero writes outside the approved FamilyWorkspace seam and lifecycle-owned files;
  package.json/root script and lifecycle docs are the only additional owned edits. Rollback is removal of lifecycle
  files/sidecars plus the minimal registry seam; repository/vault/export bytes remain.
- Repair boundaries retained: path-owned replica handles, explicit closer port, caller descriptor replay identity,
  short non-waiting `wx` lock with best-effort cleanup only, commit-truth fault semantics, strict root/path/Unicode
  contracts, and fresh-process discovery/open/reopen evidence. Crash or cleanup failure can leave a stale lock; no
  lease, stale-owner reclamation, parent-directory fsync or power-loss claim is made. Cross-process writer ownership
  remains out of scope.

## Next exact implementation assignment for this Luna anchor

`SW-PRODUCTION-AUTHORITY-QUALIFICATION-01` is the selected next software package from the fresh evidence rerank in `build/software-next-package-rerank-2026-08-05.md` (report SHA-256 `98a5a20d93cb4cf5a8a1b3b9b920b9beadfb36bc069a9ca95d62502f0280f8ed`). This turn does not implement it. Preserve the lifecycle stable-module and hardware read-only boundaries; parent/shared memory closeout remains owned by Sol.

