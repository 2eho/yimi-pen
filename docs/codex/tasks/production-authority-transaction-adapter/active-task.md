# SW-PRODUCTION-AUTHORITY-TRANSACTION-ADAPTER-01

- **Status:** implementation-in-progress; pre-write gate passed; parent `system-product-rd` remains active
- **Created:** 2026-08-05
- **Owner:** production-authority-transaction-adapter child task
- **Phase:** bounded runtime implementation and targeted validation
- **Fresh pre-write inputs:** repo audit `032ef8a379c2240bb7da66a513b55fd3a032bc264a2c5598810b5247500b62e0`; hardware audit `2be85ae6a03647ac10fdbe14048ef7c60b74eb5b02d3c5ff2c1c16027c86b8e7`; primary `a628a8806964fd846674006a3d120b9f04b455e239bb22a732490335e40a4820`; design `52e8d4c537ff0638fe4e1179f364ef140f9f68ece3e44510c86c192d061a1813`; target `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`; HIL `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b`; HIL selftest `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f`; ReleaseDecision `16c333b05a755b9c9d661cbdb169650939932d0716450205776a3c113188fa4e`; report `bacc003910476089367e3aea69689818d57a618e87afe669c23b6cd8ffa70593`. All matched the accepted identities before runtime source edits.

## Objective

Freeze the smallest provider/framework/OS/hardware-neutral product transaction, replay, audit, recovery, receipt, and durability-evidence seam justified by the repository and current primary evidence. The later implementation must be a narrow transaction/audit/recovery port plus an injected evidence adapter and deterministic fault runner. It must not choose a database, vendor, OS key store, renderer, transport, board, or physical durability method.

## Evidence snapshot

| Input | SHA-256 | Current boundary |
|---|---|---|
| `build/transaction-adapter-evidence/repo-audit.md` | `032ef8a379c2240bb7da66a513b55fd3a032bc264a2c5598810b5247500b62e0` | Six L1 gaps; existing pure cores/adapters are reusable but not product-qualified durability. |
| `build/transaction-adapter-evidence/hardware-input-audit.md` | `2be85ae6a03647ac10fdbe14048ef7c60b74eb5b02d3c5ff2c1c16027c86b8e7` | `hardwareImpact=NONE`, unresolved target, software boundary unchanged. |
| `build/transaction-adapter-evidence/primary-evidence-audit.md` | `a628a8806964fd846674006a3d120b9f04b455e239bb22a732490335e40a4820` | Evidence worker exited; final bytes accepted. Perform ordinary fresh hash verification immediately before runtime implementation. |
| `hardware/evt0/hardware-system-v1/target-binding.json` | `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202` | `BOARD_TARGET=UNRESOLVED`, 18/18 pending. |
| `build/hardware-hil-raw-evidence-capture-validation.json` | `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b` | HIL validator 36/36; proposed/pending lane, no physical promotion. |
| `build/hardware-hil-raw-evidence-capture-selftest.json` | `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f` | Baseline 36/36, 41/43 rejected, two benign accepted. |
| `build/release-gate-current/release-decision.json` | `16c333b05a755b9c9d661cbdb169650939932d0716450205776a3c113188fa4e` | 15 passed / 0 failed / 19 missing, `releaseReady=false`. |
| `build/release-gate-current/report.json` | `bacc003910476089367e3aea69689818d57a618e87afe669c23b6cd8ffa70593` | Current release observation; `RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED` remains missing. |

Design artifact: `build/transaction-adapter-evidence/design-audit.md`, SHA-256 `52e8d4c537ff0638fe4e1179f364ef140f9f68ece3e44510c86c192d061a1813`.

## Protected modules

Confirmation trust core/provider/replay, FamilyRepository, authoring recovery/session, asset-vault, FamilyWorkspace/lifecycle, `packages/*/src`, compiler, admin-web/device-sim, and all hardware/firmware/EDA/procurement/catalog/ReleaseGate/release-evidence files remain read-only. The later package must use new isolated files and composition-root wiring rather than opportunistic refactors.

## Frozen later implementation scope

- Pure contract for intent, replay envelope, observations, audit linkage, receipt identity, capability outcomes, checkpoint ordering, restart classification, and recovery states.
- Orchestration/use-case that invokes domain transitions only through injected callbacks/ports; the package imports zero confirmation, FamilyRepository, authoring, vault, FamilyWorkspace, compiler, app, hardware, firmware, catalog, or ReleaseGate modules.
- Injected adapter capability/evidence boundary for file/clock/fault operations. OS calls remain inside adapters; `lockOwnership` is observation-only (`NOT_SUPPORTED`, `UNKNOWN`, or fixture/model).
- Package-owned fixture composition root and deterministic runner with crash/fault schedules, zero-mutation checks, conflict/corruption cases, neutral audit linkage, fixture receipt evidence, and canonical report output. Real application/FamilyWorkspace integration is a later package.
- Exact next runtime file family: `tools/product-transaction/transaction-contract.mjs`, `transaction-orchestrator.mjs`, `transaction-evidence-adapter.mjs`, `fixture-composition-root.mjs`, and `run-transaction-adapter.mjs`. The package imports zero stable domain modules; callbacks/ports are supplied by the fixture root or a later composition root. No FamilyWorkspace integration is included.

## Verification gates for the later implementation

Run ordinary fresh hashes for all three transaction-adapter audits and cited target/HIL/release inputs immediately before implementation; then run node syntax, pure contract, adapter fault, restart/recovery, confirmation, FamilyRepository, UTF-8/Markdown/secret/path, and `git diff --check` gates in the documented order. `validate:full` is a later integration decision, not a design-phase action.

## Non-goals

No universal transaction engine, database, vendor, Electron/Tauri choice, OS key-store, remote authority, device install implementation, board constant, USB/OID/audio/offline-ready claim, physical power-loss claim, universal audit-log/retention store, or production receipt is included. `lockOwnership` is observation-only (`NOT_SUPPORTED`, `UNKNOWN`, or fixture/model); acquisition, renewal, stale-owner recovery, killed-owner handling, and multiprocess algorithms are routed to `SW-CROSS-PROCESS-WRITER-LEASE-01`.
