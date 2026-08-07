# Family Authoring v1 Capsule

- Updated: 2026-08-04
- Owner: `apps/companion-app/src/authoring/`; stable FamilyRevision/Repository/BuildPlan/prelisten contracts remain external owners.
- Flow: file/DirectShow source adapter → capture lifecycle/import receipt → immutable base revision command → target-neutral clip replacement → repository CAS/replay → app-local catalog/workspace → shared BuildPlan projection → authored preview → verified natural-end prelisten → explicit action → proof/provider → BuildAuthorization → authorized design Snapshot.
- Deterministic evidence: authoring 15/15 `f4387f2666b8dc57d80ae42bed7e7d8f87e63d61e444c37d2d54edece26f5fec`; verified-prelisten 5/5 `77c589de21123829fdaef5c65be3932069d7be28328a0ae094cbf7def56ac009`; capture-authoring 12/12 `5eb3a3e70e4960b69ec40b3901d1529a4f7a3f5a3b1ec42ee447ec4d6a0a1d03`.
- Host evidence: `build/companion-real-authored-flow/report.json`, selected-file 10/10, SHA-256 `cc162a4a4b637d3ed03e1fa82e465a599b4ae37284ab47d2692757f60c216458`; revision `sha256:04c75f6e8eff76661588a6120e9ae72ae2d6d162a3e7d1cd4694288c6bf2983e`, Snapshot `design:919e21f231511cfa47d2d78398aa0dff48c50c5dfbdeb52751d479a6bd5ccbe6`.
- Proven: no path/codec leak into revision; one binding revision increment; replay/stale negatives; all assets byte-verified and decoded; 10/10 pinned ffplay natural exits; explicit action is post-playback; provider authorization binds authored revision/plan; compiled replacement bytes equal imported bytes.
- Reuse decision: static and authored preview are the second executable consumers of identical orchestration, so `verified-prelisten-use-case.mjs` now owns only the shared order; local materialization duplication moved to `local-authoring-workspace.mjs`. This remains App-local and does not count as a second product/storage consumer.
- Boundary: runner action is not audibility or guardian identity; actual DirectShow device/permission/run, product shell, authenticated guardian, production authority, target audio/install and acoustic witness remain open.
- Atomicity: content-addressed asset publishes before metadata CAS. A stale CAS may leave an unreferenced immutable object; it cannot leave a partial revision. Orphan retention/GC stays a vault maintenance adapter.
- Failed/avoided paths: no path in FamilyRevision; no second projector; no SQLite; no shared application package before a second real consumer; no cross-filesystem transaction claim.
- Next: `SW-ASSET-VAULT-MAINTENANCE-01` 已完成，详见 `asset-vault-maintenance-v1`；当前进入统一 FamilyWorkspace composition，确保 authoring/restore 与 maintenance 共用 reference coordinator。

## Run Audit - 2026-08-04 - SW-FAMILY-AUTHORING-01B

- Verdict: green for the scoped 01B software package; broader software goal remains active.
- Next exact step: `SW-AUTHORING-CAPTURE-ADAPTER-01`.
- ExecutionPolicy / active anchor: lite-anchor / `docs/codex/tasks/system-product-rd/active-task.md`.
- Touched modules / protected not touched: companion App use-case/adapters/runners and software docs; `packages/*/src`, provider, compiler, contracts and hardware inputs preserved.
- Route drift / repeated failed path: avoided a second projector/player/proof algorithm and avoided extracting a cross-App package from one product root.
- Artifact discipline: both machine reports exist and are readable; hashes recorded above.
- Encoding check: apply_patch UTF-8 writes；中文sentinel、replacement字符与常见mojibake扫描通过。
- Memory hygiene: explicit software-only/evidence/reuse requirements remain hard task guards; routine run chronology stays out of session-log.
- Tests/evidence: companion aggregate PASS; architecture 547/547; typecheck/books; real-prelisten 10/10 and real-authored 10/10.
- Memory writes / owner route: this capsule + system-product-rd anchor; `family-authoring-v1` index route.
- Upgrade candidate / decision: project-memory; no skill change.

## Run Audit - 2026-08-04 - SW-AUTHORING-CAPTURE-ADAPTER-01

- Verdict: green for the scoped capture package; broader software goal remains active.
- Protected scope: new App-local capture use-case/DirectShow adapter plus one source branch in the existing authored composition root; stable packages/contracts/compiler/provider and hardware inputs preserved.
- Tests/evidence: capture 12/12 deterministic; companion aggregate PASS; architecture 568/568; selected-file real-authored remains 10/10.
- Failure evidence retained: cancel/timeout/bad receipt/import failure clean temporary sources; cleanup failure is explicit, blocks revision commit and may leave one immutable orphan for the next vault-maintenance package.
- Next exact step: `SW-ASSET-VAULT-MAINTENANCE-01`.
