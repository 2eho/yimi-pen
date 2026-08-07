# Production Authority Qualification v1 Capsule

## Objective and closeout

`SW-PRODUCTION-AUTHORITY-QUALIFICATION-01` provides a framework-neutral, provider-neutral qualification contract, injected evidence adapter, deterministic report, and blocked release-candidate binding. It does not choose a provider, OS key store, account backend, database, renderer, device transport, or hardware target. The child package is `integrated-clean/complete`; parent `system-product-rd` remains active.

## Evidence basis

- Targeted qualification: `84/84` before and after the single full validation.
- Stable provider qualification ID: `qualification:sha256:5713eab48f5c6e801cbdd9c9a9817da99fe2738193626fea08c3869906dafa69`.
- Stable environment ID: `environment:sha256:df6cb37a25a8c70e20f130967b1060fa907b550a7bf51107be635e9a2bf3b1d6`.
- Pre-full binding ID: `binding:sha256:4d447c9f3e288e706934764103616fdf4218cb376ec3809986f034763eaf36a5`.
- Post-full binding ID: `binding:sha256:ae39275c4bb41e50b7e3fd81271be56d5e34d7dfbbdeff0621fedd4023346542`.
- Pre-full/post-full report SHA-256: `855f5f949c09e0baa679e5e52788f3070a05c1a98f118bf2f1c79eb04220cbde` / `8fae036cd07e833e16ba26b02719d16e8a07ddab796c6fafd289c5a225f1471d`.
- Post-full binding/test-report SHA-256: `dd95817889f41238e95574cee5c0342e130055bd588f54dee25ce6afbe012364` / `67b1efceb3ab0122c03553d46b2986df875e89153e3f6090e5c353ded6b6ac63`.
- Post-full observation time: `2026-08-05T02:06:40.119Z`; the refreshed decision ID and report/source-set hashes are accepted without changing provider qualification identity.
- Confirmation trust: `17/17` negative checks, zero-side-effect `17/17`, report SHA-256 `e5dbed3b527e7703a06654ab9927254f0a24ead65ce309a3f47b61c16d7a1fdc`.
- Required `npm run validate:full`: exactly once, Architecture `717/717`, HardwareSystem `425/425`, Product baseline `231/231`, Rust firmware `12/12`; host-run `host-run:sha256:eeab585d4048654e18607b12bf75b40b03d651924f48cb086d28ea0d88ee80e4`; source set `535` files SHA-256 `bbfeb88ec75189a8c6b5f003d6e00f80862e4cfcb650b2369db6080e2fae1530`.
- Full ReleaseDecision: decision SHA-256 `16c333b05a755b9c9d661cbdb169650939932d0716450205776a3c113188fa4e`, report SHA-256 `bacc003910476089367e3aea69689818d57a618e87afe669c23b6cd8ffa70593`, `15 passed / 0 failed / 19 missing`, `releaseReady=false`.
- Protected ReleaseGate conformance after the post-full targeted run: `22/22`, zero-side-effect `22/22`, report SHA-256 `9637fab1d788bd7da17f850d562b5d1a3feec0c0d570fa5279c9caac054c0c0d`; NEG-22 remains enforced.

## Architecture and stable protections

- Pure core: `tools/confirmation-trust/provider-qualification.mjs` owns stable profiles, canonical identities, L0-L4 rules, cross-validation, redaction, and promotion barriers only. It does not own repository paths, dynamic artifact hashes, timestamps, release counts, or target state.
- Adapter/composition: `tools/confirmation-trust/provider-qualification-evidence-adapter.mjs` and `tools/confirmation-trust/run-provider-qualification.mjs` own the repository-relative manifest, injected readers, byte hashing, strict JSON parsing, dynamic release/target observations, deterministic report, and blocked binding projection.
- `L0=PASS` covers verified fixture host proof, public-key identity, and replay identity. `L1=PARTIAL` exposes product audit transaction, parent-directory fsync, power-loss, stale-lock, multiprocess recovery, and product replay-store gaps. `L2=MISSING` requires both production key custody and key lifecycle. `L3=MISSING` requires family authority/authentication evidence. `L4=BLOCKED` requires L1/L2/L3 plus provider verifier, environment binding, and a non-synthetic production receipt; target resolution is not a provider-level substitute.
- Raw `evidence.capabilities=true` objects are rejected; capability status is derived from verified adapter evidence. Fixture/synthetic evidence, missing verifier/key custody/authority, and `releaseReady=false` remain non-production and non-gate eligible.
- Protected bytes and semantics: `tools/release-gates/run-product-rd.mjs` SHA-256 `544adcbfa19cc2c4a11e8cddce15efa484722ef17494c1b0661e44fd48b807e6`; confirmation contracts, provider/replay core, compiler, catalog/evidence schemas, ReleaseDecision evaluator, target binding, hardware, firmware, EDA, and procurement were not edited.

## Rejected paths and rollback

- No provider, OS, key store, account backend, database, renderer, device transport, hardware target, production credential, private material, EvidenceReceipt, or hardware release artifact was added.
- No catalog refresh or full product-R&D runner integration was attempted; the root `validate:contracts` sequence remains the targeted integration boundary.
- Rollback is the package-owned source/docs/memory diff plus ignored generated evidence under `build/confirmation-provider-qualification/`, `build/luna-production-authority-level-repair/`, and `build/luna-production-authority-integrated-closeout/`. No staging, commit, push, or goal completion occurred.

## Hardware synchronization

Read-only hardware state is unchanged from package start. The hardware owner anchor `docs/codex/active-task.md` currently hashes to `4dc67542f60258d57090d30146a6bce73a90578539f7f395c6cea5106dfb3254`; `hardware/evt0/hardware-system-v1/target-binding.json` remains SHA-256 `ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202`, `BOARD_TARGET=UNRESOLVED`, `18/18 TARGET_EVIDENCE_PENDING`, `hardwareImpact=NONE`, and `offlineReady=false`. HIL raw-evidence validator SHA-256 `51f36cb346452b7db963324cc719b75d836f313ed3310d6e3c83215694d9b58b` remains `36/36`; selftest SHA-256 `c1eed685c414a63cb1fe1c41eea0b139373cdbec59fed97f14988de21f30827f` remains baseline `36/36`, `41/43` rejected and two benign accepted. No physical facts are inferred from these generated reports.

## Remaining gaps and next candidates

`RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED` remains missing. The current L1 gap is durable product transaction/audit/recovery evidence; L2 needs custody plus lifecycle; L3 needs real family authority/authentication; L4 needs all independent provider-side evidence and a non-synthetic receipt. Target and hardware blockers remain in the separate binding projection.

The fresh rerank selects `SW-PRODUCTION-AUTHORITY-TRANSACTION-ADAPTER-01` as the next package. It is limited to a reusable transaction/audit/recovery port and evidence adapter; no database, vendor, OS, hardware, or transport choice is implied. Renderer, cross-process lease, install composition, OS key-store, and remote/family authority remain separate evidence packages.
