# Active Task

- Updated: 2026-08-05
- Status: complete
- Package: `SW-DESKTOP-AUTHORING-UI-ADAPTER-01`
- Package phase: App-local implementation, independent review repair and targeted closeout complete; framework-neutral durable task service/view contract remains frozen for bounded delivery
- Parent route: `system-product-rd`
- Project: yimi-pen
- Owner: desktop-authoring-ui-adapter-v1
- Mode: scoped-build
- User goal: 只负责益米点读笔软件系统研发；以成熟早教产品的一手资料和可复算工程证据推进，并让新应用壳复用稳定合同、纯内核、用例端口、适配器与组合根。
- Responsibility boundary: 本任务只审计桌面创作 UI adapter 所需的软件接缝。硬件、EDA、采购、结构、供电、声学、板卡和 OID 只读同步；业务源码、稳定产品壳、硬件工件和其他 owner 记忆保持原状。
- Evidence report: `build/desktop-authoring-ui-evidence-audit.md`

## Implementation boundary

- Progress boundary: `DesktopAuthoringTaskService` owns journal/ports, fresh and resumed canonical task identity, synchronous mutation persistence (including adapter-private `sourceRequest`), async checkpoint verification, CAS abandon, canonical command-payload single-flight, live CAS conflict projection, permission guidance, TTS auto-metadata seam and composition-level adapter bindings; `DesktopAuthoringTaskView` is the only JSON-safe renderer boundary.
- Stable-module protection judgment: no protected source touch is required by the reproduced seam gap; implementation is confined to `apps/companion-app/src/desktop-authoring/`, its deterministic runner, and minimal package/readme wiring. Existing authoring/session/recovery/TTS/FamilyWorkspace/asset-vault behavior remains unchanged and is regression-gated.
- Hardware input: `hardwareImpact=NONE`; `BOARD_TARGET=UNRESOLVED`; no board, USB, storage, OID, codec, diagnostic, or device-install constants enter this boundary.
- Next exact step: child package is closed at 93/93 plus required regressions, typecheck/books and the companion default aggregate; one final `validate:full` remains for Sol after the concurrent hardware writer is idle. Parent `system-product-rd` remains active and the rendering framework stays unfrozen.

## Current judgment

当前仓库已有 framework-neutral `AuthoringProductSession`、canonical task recovery journal、
FamilyWorkspace capability、FILE/CAPTURE/SYSTEM_TTS source adapter 和确定性验收，但还没有真实桌面产品壳：

- `apps/companion-app` 是 Node ESM 的 App-local 组合根、CLI 与验收 runner；唯一运行时依赖是 `@yimi-pen/audio`。
- `apps/admin-web` 是受保护的研发内容查看器，使用原生 HTML/CSS/JS + Node HTTP，不是家庭创作产品壳。
- `apps/device-sim` 是 CLI/WebSocket 仿真器，不是家庭创作产品壳。
- 仓库依赖中没有 Electron、Tauri、React、Vue 或 Svelte；当前证据不支持先冻结 UI framework。

本包已建立 App-local、framework-neutral 的 durable task service / UI adapter，UI 只消费投影并调用 Promise
命令。每个同步 user mutation 在返回前完成 journal CAS 持久化；FILE/CAPTURE/TTS、FamilyRevision、review
与 recovery 继续走现有单一路径。真实桌面 host、OS permission adapter、跨进程 writer lease、packaged artifact
与 DeviceDelivery 仍是后续独立证据门。

## Closed contract gaps

1. `selectSource()`、`submitMetadata()`、`retry()` now persist through the App-local service, including private `sourceRequest`.
2. Every public UI command returns a Promise even for malformed input or overlap failure; valid duplicate calls use a canonical
   command-payload fingerprint and exact Promise identity, while different payloads return BUSY without private payload material.
3. ACTIVE recovery `ABANDON` projects `ACTION_REQUIRED` with `ABANDON_TASK`; CAS abandon is exposed, while `ABANDONED` remains
   terminal/read-only.
4. Live journal CAS conflicts return a canonical read-only `CONFLICT` view from the newer disk record with zero persisted stale mutation.
5. Runtime adapter availability is the service composition binding; durable task requirements are never satisfied by an instance-local
   per-task binding map. Restart therefore exposes adapter mismatch instead of hiding it.
6. Permission `DENIED`/`UNAVAILABLE` projects deterministic settings guidance with no native-prompt claim and no raw OS payload.
7. The desktop composition seam proves TTS selection/auto-metadata durability and fresh review retry over the same durable revision;
   full provider qualification remains owned by the existing TTS adapter runner.
8. Task-list retention and product sorting remain explicitly `UNKNOWN`; journal transport order is not a product fact.
9. `getView()`、`listTasks()` 与 `abandon()` now reclassify persisted records against the current explicit composition bindings and Family head without read-time mutation; restarted `COMMITTING`/`REPLAY_FROZEN_COMMIT` abandon is held by the commit truth barrier.
10. Renderer metadata and committed-revision summaries are explicit field whitelists; the acceptance runner proves restart mismatch/head conflict reads and read-only abandon identity.

11. Cached controller identity is checked against the canonical journal record before a command or idempotent existing-live create; drift discards the stale handle and reopens the canonical writer record.
12. A restarted `COMMITTING` view keeps `recoveryDecision=REPLAY_FROZEN_COMMIT` and `commands.canAbandon=false`; abandon performs one bounded final Family-head recheck before CAS and returns `BASE_HEAD_CHANGED` conflict without a journal write when that head moves.

已覆盖的异步边界保持：permission/source、commit preparation、`COMMITTING` truth barrier、review、cancel 和恢复 transition
均有 checkpoint/CAS 证据；journal corruption 与 adapter mismatch 继续 fail closed。

## Stable module protection

- Protected: `authoring-product-session-core.mjs`、`authoring-product-session.mjs`、
  `authoring-task-recovery-contract.mjs`、`authoring-task-recovery.mjs`、FamilyWorkspace、FamilyRevision/CAS、
  TTS/capture/prelisten、asset-vault recovery、compiler、admin-web、device-sim 和 `packages/*/src`。
- Evidence phase touched none of the protected modules.
- Preferred implementation location: a new App-local `apps/companion-app/src/desktop-authoring/` boundary plus its isolated
  acceptance runner and documentation.
- A protected touch is considered only after a deterministic reproduction proves the new adapter cannot retain exact private
  recovery context through existing ports; before such a touch, report necessity, impact, unchanged surfaces and aggregate regressions.

## Closed UI-facing contract

The package closes these UI-facing guarantees before selecting a rendering framework:

1. Every UI command returns only after its resulting `(recordId, journalRevision, stateId)` is canonical and CAS-persisted.
2. The UI never calls the raw session controller or local journal directly.
3. Source selection persists both the public selection and adapter-private `sourceRequest`; raw paths/device names stay outside the view model.
4. External effects keep start/result checkpoints; duplicate clicks are single-flight by canonical command payload.
5. `COMMITTING` projects a non-cancellable “confirming saved result” state; exact replay retains the frozen command.
6. Review retry creates a fresh attempt over the existing durable revision.
7. Recovery action-required, conflict, adapter mismatch, terminal and journal corruption project explicit states with zero core mutation.
8. Permission `DENIED`/`UNAVAILABLE` projects OS guidance without inventing that a desktop app can always trigger a native prompt.
9. `buildAuthorized` and `offlineReady` remain separate from session completion.

## Hardware read-only closeout snapshot (2026-08-05)

- `docs/codex/active-task.md` SHA-256: `b129493a620a891268dc2d6b363e2675ca1c2518c37abf5a9e6c95b0aa187718`
- `docs/research/hardware-software-sync-2026-08-04.md` SHA-256: `de5c88effa90c63849eddfa98f22d70fff8099fe562a8b64644e9da727f1fcac`
- `hardware/evt0/hardware-system-v1/topology.json` SHA-256: `96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5`
- `hardware/evt0/hardware-system-v1/target-binding.json` SHA-256: `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`
- `hardware/evt0/method-gap-evidence-v1/manifest.json` SHA-256: `3b081ab765ae870e1fbe6589ff9eb1f35cc25f6fd805ec4f7560bec3b146873b`
- `BOARD_TARGET=UNRESOLVED`; 18/18 interface bindings are `TARGET_EVIDENCE_PENDING`.
- Semantic software impact: `NONE`. No new OID event, codec, storage, USB, control/status, diagnostic/BSP or DeviceDelivery binding is proven.

Closeout reread at `2026-08-04T20:48:11Z` found no software-relevant hardware delta; `BOARD_TARGET=UNRESOLVED` and
18/18 interface bindings remain `TARGET_EVIDENCE_PENDING`. The hardware method-contract Luna process was still active at this
single observation, and the one final verification process check after the 2026-08-05 software gates still found concurrent
hardware Luna activity, so no `validate:full` rerun was started; the current evidence still records `hardwareImpact=NONE`.

## Official mature-product evidence retained

- Yoto separates recording, pause, explicit save, listen-back/rename, upload, playlist creation and later card linking with completion feedback.
- Tonies separates device-local saved recordings, assignment/upload, successful completion and Toniebox synchronization; it explicitly states
  that saved recordings are local to the recording device.
- tiptoi Manager and LeapReader Connect expose content discovery/download/install and explicit completion/disconnect stages; these are future
  DeviceDelivery evidence, not current authoring completion.
- Microsoft documents Windows microphone access as device/app/desktop-app settings; the product UI therefore needs permission status and
  settings guidance behind a platform adapter.

Exact official URLs and repo file/line evidence are recorded in `build/desktop-authoring-ui-evidence-audit.md`.

## Validation and closeout

- Evidence checks: current manifests/source/acceptance runners inspected; hardware snapshot recomputed; UTF-8/mojibake,
  Markdown link/table/fence and `git diff --check` gates pass.
- Source tests: desktop authoring 93/93; recovery 22/22; product shell 33/33; TTS 41/41; FamilyWorkspace 34/34;
  asset-vault recovery 70/70; companion default `npm test` includes the desktop runner and passes; all three desktop modules pass `node --check`; typecheck and books pass.
- Full gate: the prior sealed `npm run validate:full` pass succeeded before this review repair with Architecture 691/691, HardwareSystem 425/425,
  Product baseline 231/231, Rust firmware 12/12, host `host-run:sha256:34f718bbb3d1f6cad4005479e02c248f7768c93116b0bf347fddd8d28d6b17fe`,
  source set 506 files / `3086b0abe8a10bfb4cfddd85ef366f79d0a2316bb6c3742fdba0f9d61ab71e13`,
  ReleaseDecision 15 pass / 0 fail / 19 missing, `releaseReady=false`; rerun is deferred to Sol until the concurrent hardware writer is idle.
- Goal state: parent `system-product-rd` remains active.

## Requirements

- RQ-UI-001: every synchronous UI mutation is journaled before the command resolves; no caller-owned ad hoc save rule.
- RQ-UI-002: rendering framework and OS shell remain replaceable adapters over one durable task service and one view-model projection.
- RQ-UI-003: mature-product facts, engineering inference and current repository proof remain explicitly separated.
- RQ-UI-004: hardware changes enter only through versioned adapter bindings or ReleaseGate evidence; current impact is `NONE`.
- RQ-UI-005: stable core/controller/recovery behavior remains protected until a reproduced seam gap proves a minimal touch necessary.

## Orchestration metrics

- Role: Luna anchor.
- Anchor start: native V2 cold start for this task line.
- Exact token/cache counters and cumulative deltas are not exposed by the collaboration surface; no estimate is recorded.
