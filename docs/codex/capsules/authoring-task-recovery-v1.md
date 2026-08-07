# Capsule: authoring-task-recovery-v1

- Date: 2026-08-04
- Project: yimi-pen
- Memory ID: authoring-task-recovery-v1
- Memory class: durable-fact; acceptance-criterion; stable-behavior
- Scope: `system-product-rd/SW-AUTHORING-TASK-RECOVERY-01`; companion-app App-local authoring recovery only
- Aliases/keywords: Authoring Task Recovery, task journal, COMMITTING, exact replay, fresh review, `RESTART_SOURCE`, save/checkpoint
- Wake-up route: `index.md -> authoring-task-recovery-v1`
- Version: v1
- Phase/mode: scoped-build; package complete; overall `system-product-rd` remains active
- Module: `apps/companion-app/src/authoring`
- Question: what durable local facts let a user resume, retry or abandon authoring without inventing a repository outcome?
- Baseline: source/capture/TTS authoring flows already have FamilyRevision/CAS, asset-vault and product-shell evidence; this package adds the narrow reusable task journal/recovery contract and runner.

## Judgment

`SW-AUTHORING-TASK-RECOVERY-01` is complete and removed from pending. It provides target-neutral reusable primitives plus a save/checkpoint contract. The next selected package is `SW-DESKTOP-AUTHORING-UI-ADAPTER-01` at 70; its first action is evidence/read-only review of mature product UX flows, the current app-shell surface, OS permission/recovery UX and framework constraints. No UI framework is selected by guess. Desktop composition must prove every synchronous user mutation is persisted instead of relying on callers to remember ad hoc saves.

## User-visible recovery matrix

- `AWAITING_SOURCE`: `RESTART_SOURCE` when a source request exists, otherwise explicit `ABANDON`; return to `READY_TO_ACQUIRE` or finish.
- `READY_TO_ACQUIRE`, `AWAITING_PERMISSION`, `ACQUIRING_SOURCE`: pre-durable `RESTART_SOURCE`; rebuild the private source request/adapter and do not treat staging bytes as durable content.
- `AWAITING_METADATA`: `CONTINUE` editing the imported asset/publication fact.
- `PREPARING_COMMIT`: `CONTINUE` by resetting preparation to `READY_TO_COMMIT`.
- `READY_TO_COMMIT`: create a command when none is frozen; otherwise `REPLAY_FROZEN_COMMIT` with the same command.
- `COMMITTING`: non-abortable truth barrier; recover to replay-ready and invoke the exact frozen command.
- `READY_TO_REVIEW`: `CONTINUE` with the full committed revision and commit receipt.
- `REVIEWING`: `FRESH_REVIEW_RETRY`; discard the old attempt identity but retain the committed revision.
- `FAILED`: use only the recorded `resumePhase` (source restart, commit replay, fresh review or safe retry).

## Canonical invariants and limits

- Recovery record/state IDs are self-excluding JCS canonical SHA-256 values; `expectedStateId` must equal the snapshot state ID.
- `eventSequence` remains an event cursor covering the session revision; `attemptSequence` is an independent non-negative safe-integer attempt cursor.
- CAS checks the expected revision/current state/next state tuple. Journal writes use temp-file sync then rename, with stale temp cleanup, corruption quarantine and a corruption receipt; corrupt evidence blocks load/recovery/write.
- `COMMIT_PREPARED` durably freezes the complete command; `COMMITTING` has `abortable=false`. Cancel does not turn an unknown repository result into a false rollback. Replay uses the exact command and must not add a revision, outbox entry or head.
- Review retry binds `sessionId`, committed `familyRevisionId`, binding, clip, asset and asset SHA; it never commits a second FamilyRevision.
- Adapter/hardware ReleaseGate is explicit and target-neutral; unresolved hardware bindings stop recovery without mutating core session state. The reusable hardware fixture is hardware-only evidence and creates no software interface binding.
- Honest limits: no parent-directory fsync, no stale-lock automatic disposal or crash-proof cross-process lease, and no proof for volume corruption, sudden power loss, cross-device writers or cloud/SQLite transaction durability. `COMMITTING` is a semantic truth barrier, not a physical power-loss guarantee.

## Exact changed files and protection

- Owned source: `apps/companion-app/src/authoring/authoring-task-recovery-contract.mjs`, `local-authoring-task-journal.mjs`, `authoring-task-recovery.mjs`, `authoring-product-session.mjs`, `authoring-product-session-core.mjs`, `run-authoring-task-recovery-acceptance.mjs`.
- Owned docs/wiring: `docs/authoring-task-recovery-v1.md`, `apps/companion-app/package.json`, `package.json`, `apps/companion-app/README.md`, `README.md`, and the appended software-only section in `docs/research/next-work-package-ranking-2026-08-04.md`.
- Protected touches: `authoring-product-session.mjs` and `authoring-product-session-core.mjs` were the intentional narrow recovery integration touches; default behavior was regression-tested. `packages/*/src`, FamilyWorkspace, FamilyRevision/CAS, capture/prelisten, asset-vault recovery, compiler, admin-web/device-sim, hardware files and hardware memory were not edited.

## Validation evidence

- Recovery 22/22: `7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`.
- Product Shell 33/33: `e4dd6694ece3acfa2bde4ca80d80701c27c1143067eafe70620cd03776d88eeb`.
- TTS 41/41: the original package seal remains `d2488e26f3363e7b46d57c2475c524ce6c096c98cc8a3e754e2c77c1c967a5db`; the final dependency-bound aggregate regression report is `3421b0de9614162cb20c02d5320c162beaa84b7547f5ee62ff5ba6b83d0cdd5b` because it binds the intentionally changed protected authoring core/controller hashes. The earlier standalone closeout report was `04016c8479eb435c307418a2e8dbcbdae4e3f95d5e7dbee924884ede736293a0`.
- FamilyRepository: memory 16/16; atomic 16/16; atomic boundaries 13/13; repository boundaries 14/14; zero-side-effect memory/atomic 9/9 + 9/9; report `96433369a8bad64742c53699a259313e3fc738a2609315a3f9828312443b019f`.
- FamilyWorkspace 34/34: `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`.
- Asset-vault recovery 70/70: `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`.
- `npm run typecheck` and `npm run validate:books` passed (`demo-abc`, `jojo-bedtime-01`).
- Final `npm run validate:full` passed: architecture 677/677; HardwareSystem 425/425; product baseline 231/231; Rust firmware 12/12. Host identity `host-run:sha256:f6c0036566a637c71e8d8d5d9b60efe133742060ca960251951686be7948e5b4`; source set `files=487`, SHA-256 `548914196f25e4b777027afc11a44b8f5626e2b3888172145c636819e0b39ce0`; HardwareSystem validator topology identity `98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`.
- ReleaseDecision: `decisionId=decision:sha256:46d0320b9fe116c2020e1edee5c505a682daf834bdb96ddc5a66884124b921c2`; JSON SHA-256 `e056856496855c1b6ffc0b50bfef24f1cbc0ffe2694be6b22da86ff6b5c237ce`; evaluation report SHA-256 `0712308c3aedaf37b3c42c3a73400efffa6a20de16d3ae51a9205381930c2b0d`; 15 passed, 0 failed, 19 missing, `releaseReady=false`.

## Hardware synchronization

- Read-only start and close hashes are identical: `docs/codex/active-task.md` `0d0067d081e8bea3e07a8a2b7a4fda506308fc323cdd1d150703842e8af963da`; `docs/research/hardware-software-sync-2026-08-04.md` `ecaf18aa8763c3f8b254e3a1a131e7d989f515e9b0a63d23fceb070aced9e373`; topology `96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5`; target-binding `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`.
- Current facts remain `targetIdentity.state=UNRESOLVED`, 18/18 interface bindings `TARGET_EVIDENCE_PENDING`, `eda.readiness=SYSTEM_SKELETON_ONLY`; the fixture architecture is hardware-only evidence. Proven software impact is `hardwareImpact=NONE`; no hardware file or root hardware anchor was changed.

## Official facts, inference, unknown

- `docs/authoring-task-recovery-v1.md` separates direct official URLs already present in `build/luna-task-recovery-official.log` from inference and unknowns. Official pages support only visible product-flow facts; they do not prove this repository's implementation.
- Inference retained: visible source/import/review stages justify durable phase identities, a non-abortable commit barrier, exact replay and a fresh review attempt.
- Unknowns retained: interrupted temporary-file retention, authoritative copy, remote atomicity/discard, cross-device conflict semantics, UI cancel after remote write, and any fsync/power-loss guarantee.

## Orchestration metrics

- Role: Luna anchor; session id `019fcba7-1abf-74f1-bd9a-f6772693747c`.
- This closeout turn is a warm resume of the interrupted phase. Exact cold-start count, warm-resume count, cumulative-counter deltas, token counters and cached/uncached ratio are not exposed by the local session tools; no estimate is recorded.

## Run audit / next route

- No P0/P1 was found in the owned recovery slice. No stage/commit/push/clean/switch was run. Source/docs were frozen before `validate:full`; only the four software memory files were updated after it.
- Next: create a new active package route for `SW-DESKTOP-AUTHORING-UI-ADAPTER-01`; first step remains read-only evidence collection and a proof that synchronous user mutations persist through the save/checkpoint contract.
- Links: `docs/authoring-task-recovery-v1.md`, `docs/research/next-work-package-ranking-2026-08-04.md`, `apps/companion-app/src/authoring`, `build/release-gate-current/release-decision.json`.
