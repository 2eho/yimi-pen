# Capsule: desktop-authoring-ui-adapter-v1

- Date: 2026-08-05
- Project: yimi-pen
- Memory ID: desktop-authoring-ui-adapter-v1
- Memory class: durable-fact; acceptance-criterion; stable-behavior
- Scope: `system-product-rd/SW-DESKTOP-AUTHORING-UI-ADAPTER-01`
- Wake-up route: `index.md -> desktop-authoring-ui-adapter-v1`
- Phase/mode: scoped-build; child package complete after independent review repair; parent `system-product-rd` remains active
- Rendering policy: framework-neutral; Electron/Tauri and UI framework selection remain unfrozen

## Judgment

The App-local `DesktopAuthoringTaskService` / `DesktopAuthoringTaskView` boundary now has an explicit composition
binding contract, restart-aware read classification, durable synchronous mutations and a JSON-safe renderer projection.
No protected authoring/recovery/TTS/FamilyWorkspace/asset-vault core was changed by this repair.

## Closed repair contracts

- Service construction rejects omitted `adapterBindings` and normalizes the explicit v1 binding set through the recovery contract.
- `getView()`, `listTasks()` and `abandon()` classify persisted records against current adapter bindings and current Family head without read-time transition writes; the fresh in-memory `AWAITING_SOURCE` override remains scoped to a live `fresh` handle.
- Active `ABANDON` remains `ACTION_REQUIRED` with CAS abandon; `ABANDONED` remains terminal/read-only; restarted `COMMITTING`/`REPLAY_FROZEN_COMMIT` is held by the commit truth barrier.
- Canonical command/payload single-flight preserves exact Promise identity for duplicates, rejects different payload overlap as BUSY without payload material, and returns Promise objects for malformed input and overlap failures.
- Synchronous CAS conflicts return or attach a canonical newer-writer conflict view with `coreMutation=NONE`; disk identity remains the newer record.
- Cached controller identity is compared with the canonical journal record before commands and existing-live idempotent create; drift discards stale state and reopens the canonical record. Abandon performs one bounded final Family-head recheck immediately before CAS and projects `BASE_HEAD_CHANGED` without writing when the head moves.
- `COMMITTING`/`REPLAY_FROZEN_COMMIT` keeps its recovery decision visible while `commands.canAbandon=false`; the commit truth barrier remains the source of command truth.
- Renderer target, metadata, committed revision, permission, failure, attention and command projections use explicit whitelists; source requests, paths, device/OS data, staging, tokens and repository/workspace objects stay private.
- Permission `DENIED`/`UNAVAILABLE` exposes deterministic settings guidance without a native-prompt claim; TTS auto-metadata and review interruption retry retain their existing durable seams.
- Task-list retention/sorting remains `UNKNOWN`; content revision saved, authorization, offline readiness, device install and hardware impact remain independent.

## Owned implementation and evidence

- Source: `apps/companion-app/src/desktop-authoring/desktop-authoring-task-service.mjs`,
  `desktop-authoring-task-view.mjs`, `run-desktop-authoring-task-acceptance.mjs`.
- Wiring/docs: `apps/companion-app/package.json`, `apps/companion-app/README.md`,
  `docs/desktop-authoring-ui-adapter-v1.md`, this capsule and the child active-task anchor.
- Acceptance: Desktop Authoring `93/93`, report SHA-256 `bc28adad4b4a27ade9ef573fc1a27abf8ddc8422a4d4e30e0e5a846bd92b9b24`.
- Regression evidence: Recovery `22/22` (`7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059`),
  Product Shell `33/33` (`e4dd6694ece3acfa2bde4ca80d80701c27c1143067eafe70620cd03776d88eeb`),
  TTS `41/41` (`f3f9dad07c7c710fd6bd03553c03e062ac4ad135522839b2bf510d52819708f0`),
  FamilyWorkspace `34/34` (`094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`),
  Asset Vault Recovery `70/70` (`65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`).
- `npm test -w @yimi-pen/companion-app`, `npm run typecheck`, `npm run validate:books` and all three desktop `node --check` gates pass.
- The earlier sealed `validate:full` result remains historical evidence; one post-repair full run is deferred to Sol while the hardware writer is active.

## Hardware read-only synchronization (observed 2026-08-04T20:48:11Z)

- `BOARD_TARGET=UNRESOLVED`; target-binding has `18/18` `TARGET_EVIDENCE_PENDING` interface bindings; accepted software impact is `hardwareImpact=NONE`.
- Inputs reread without modification: `docs/codex/active-task.md` SHA-256 `b129493a620a891268dc2d6b363e2675ca1c2518c37abf5a9e6c95b0aa187718`,
  `docs/research/hardware-software-sync-2026-08-04.md` SHA-256 `de5c88effa90c63849eddfa98f22d70fff8099fe562a8b64644e9da727f1fcac`,
  topology SHA-256 `96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5`,
  target-binding SHA-256 `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`,
  method-gap manifest SHA-256 `3b081ab765ae870e1fbe6589ff9eb1f35cc25f6fd805ec4f7560bec3b146873b`.
- These are one read-only observation; concurrent hardware churn is not chased. No board, OID, USB, storage, audio, power,
  diagnostic/BSP or DeviceDelivery binding enters this software package. The hardware method-contract Luna process was still
  active at this observation, and the one final verification process check after the 2026-08-05 software gates still found
  concurrent hardware Luna activity, so the post-repair full gate remains scheduled for Sol rather than being run here.

## Next route and limits

- Parent `system-product-rd` remains active; after Sol schedules the deferred full gate, software rerank proceeds to
  `SW-FAMILY-WORKSPACE-LIFECYCLE-01`.
- Real desktop host, native OS permission adapter, cross-process writer lease, packaged artifact, real provider qualification
  and DeviceDelivery remain independent evidence gates; this package is not release-ready.
