# FamilyWorkspace Lifecycle v1 Capsule

## Anchor

- Task: `SW-FAMILY-WORKSPACE-LIFECYCLE-01`
- Scope: App-local `list/create/open/reopen/close/archive/unarchive`
- Current software boundary: single-process App-owned direct-child workspaces
- Hardware snapshot: `BOARD_TARGET=UNRESOLVED`, `18/18 TARGET_EVIDENCE_PENDING`, `hardwareImpact=NONE`, `offlineReady=false`

## Contract

Sidecar `family-workspace-lifecycle.json` has exactly ten v1 fields:
`schemaVersion`, `profile`, `workspaceId`, `workspaceDirectoryName`, `state`, `createdAt`, `updatedAt`,
`lastOperationId`, `markerSha256`, `descriptorId`. `workspaceId` equals the existing marker
`repositoryId`; `descriptorId` is JCS-SHA256 of the descriptor without itself. Read/list never repair or write.

## Implementation map

- `src/family-workspace-lifecycle/family-workspace-lifecycle-contract.mjs`: strict JSON/UTF-8, exact keys,
  Unicode/path/identity/timestamp validation and JCS descriptor identity.
- `src/family-workspace-lifecycle/family-workspace-lifecycle-filesystem-adapter.mjs`: direct-child scan,
  marker binding, canonical sidecar bytes, short same-directory `wx` lock around definitive CAS, atomic
  exclusive-temp writes and deterministic fault injection; stale locks remain an explicit v1 risk.
- `src/family-workspace-lifecycle/family-workspace-lifecycle-service.mjs`: Promise single-flight, path-owned
  handles (repositoryId may repeat across restored replicas), injected closer port, explicit descriptor identity /
  operation replay, create-after-initialization publication, archived-open rejection, idle close/archive,
  reversible CAS transitions and sanitized summaries.
- `src/family-workspace-lifecycle/run-family-workspace-lifecycle-acceptance.mjs`: deterministic report runner;
  child helper proves fresh-process discovery/open/close/reopen/head continuity only.
- `src/family-workspace/family-workspace.mjs`: minimal tracked operation counter/closed flag and exact idle
  `closeFamilyWorkspace` registry release seam; content/CAS/asset/export/restore logic unchanged.

## Acceptance snapshot

- Lifecycle runner: 28/28, report SHA `06ab29d813d3561b107ce242cd40084773870fc0078075fd1d21fd5353d7eabb`; generated report under `build/companion-family-workspace-lifecycle-validation/`.
- Existing FamilyWorkspace: 34/34, SHA `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`.
- Desktop baseline: 93/93, SHA `bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`.

## Repair closeout

- Replica-safe handles are keyed by canonical workspace directory identity, with `workspaceId` and descriptor identity retained as attributes; duplicate repository IDs from portable restores remain isolated.
- The service validates and uses an injected `workspaceCloser`, requires caller `expectedDescriptorId`/`operationId` for archive and unarchive, and applies replay/idempotency checks before handle closure or sidecar mutation.
- Descriptor create/CAS uses a short non-waiting same-directory exclusive `wx` lock. Existing locks return `FAMILY_WORKSPACE_LOCKED`; cleanup is best-effort/token-checked, so a crash, open-handle cleanup failure or stale lock can block later work. No lease, stale-owner reclamation, parent-directory fsync or power-loss guarantee is implied.
- Atomic fault handling distinguishes pre-rename preservation from post-rename canonical commit truth. Root/path/Unicode validation rejects relative roots, lone surrogates, traversal, trailing dot/space and Windows-reserved direct-child names while preserving valid Unicode.
- Fresh-child evidence opens an ACTIVE workspace, reads its head, closes, reopens a distinct capability, confirms the same head and emits sanitized identity/state facts only.
- Final checks: lifecycle 28/28; FamilyWorkspace 34/34; product shell 33/33; task recovery 22/22; desktop 93/93; TTS 41/41; asset-vault recovery 70/70; FamilyRepository conformance and family-build adapter passed; companion default aggregate, typecheck, books and clean post-hardware `validate:full` passed exactly once. Full counts: Architecture 717/717, HardwareSystem 425/425, Product baseline 231/231, Rust firmware 12/12; host-run `host-run:sha256:9e7feea8f79121d73a23d96a292cb01792a43abc4be91664bfa267d288598841`; source-set 531 files SHA `7a0e910dfd73a151da7f995e3100be7db02fb76781e4bb14228f52d4466a0657`; ReleaseDecision 15 pass/0 fail/19 missing, `releaseReady=false`, decision report SHA `5599c9c3107128226a99a0a7b19e6eb32a7223e0c16f21b4a7d462eedc030211`.
- Hardware snapshot at closeout: HIL validator `36/36`, SHA `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; selftest baseline `36/36`, `41/43` rejected and two benign accepted, SHA `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`; `BOARD_TARGET=UNRESOLVED`, `18/18 TARGET_EVIDENCE_PENDING`, target-binding SHA `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`, `hardwareImpact=NONE`, `offlineReady=false`; no accepted hardware delta changes this software contract. Lifecycle node syntax is `7/7`; UTF-8/Markdown/memory checks and `git diff --check` pass.

## Non-goals / rollback

No permanent delete, schema migration, cross-process writer lease, DeviceDelivery, UI framework, hardware binding or
offlineReady change. The short lock is non-waiting, has best-effort cleanup only, no stale-owner reclamation and makes
no parent-directory fsync or power-loss claim; a crash or cleanup failure may leave a stale lock that needs an explicit
recovery decision. Rollback removes only new lifecycle files/docs/report/sidecars and the minimal registry seam;
repository/vault/export bytes are not deleted or moved.

## Final cleanup and next package

The overbroad `.family-workspace-` directory-name rejection is removed; `my.family-workspace-project` remains a valid
direct child, while leading-dot, traversal, staging and Windows-reserved checks remain. The unused filesystem-adapter
`mkdir` import is removed. The fresh rerank report is `build/software-next-package-rerank-2026-08-05.md`, SHA
`98a5a20d93cb4cf5a8a1b3b9b920b9beadfb36bc069a9ca95d62502f0280f8ed`; selected next package is
`SW-PRODUCTION-AUTHORITY-QUALIFICATION-01`, not implemented in this turn.
