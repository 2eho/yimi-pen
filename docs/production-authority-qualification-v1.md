# Production authority qualification v1

**Status:** deterministic, framework-neutral qualification seam; the current
product remains explicitly non-production-qualified.
**Owner:** `SW-PRODUCTION-AUTHORITY-QUALIFICATION-01`
**Runner:** `npm run test:confirmation-provider-qualification`

## 1. Purpose and boundary

This package turns observed repository evidence into a machine-checkable,
content-addressed qualification report and a blocked release-candidate
binding projection. It consists of a pure contract/evaluator, an injected
evidence adapter, and a repository composition root. It does not select an
operating-system key store, account backend, cloud/KMS/HSM service, database,
renderer, device transport, provider, or hardware target.

The seam deliberately leaves
`RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED` missing, creates no
`EvidenceReceipt`, and does not mutate the current `ReleaseDecision`. It is a
replaceable boundary for a future provider verifier, not a provider
implementation.

## 2. Supported facts and forbidden inferences

| Supported fact read by v1 | Forbidden inference kept explicit |
|---|---|
| The confirmation-trust validation report is `confirmation-trust-validation-v1`, fixture-only, and its observed negative summary is 17 total, 17 passed, and 17 zero-side-effect. | Fixture proof, fixture public key, or a self-consistent host report is production authority. |
| The golden trust policy exposes a public Ed25519 `kid`, policy identity, and authority revision identity. | A production private key, account credential, family identity, or authority backend is present. |
| The replay schema and existing host tests identify replay states and fixture retry semantics. | Atomic JSON evidence proves product audit transactions, parent-directory fsync/power-loss durability, robust stale-lock recovery, or a product store. |
| The release catalog contains `RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED` as a production, non-synthetic gate. | This report is a production receipt or a configured gate-specific verifier. |
| The observed ReleaseDecision has 15 passed, 0 failed, 19 missing, and 19 blocking gates with `releaseReady=false`. | A qualification projection can override release readiness, physical gates, or release identity. |
| The read-only target snapshot has `BOARD_TARGET=UNRESOLVED` and 18/18 target-evidence-pending interfaces. | HIL, EDA, OID, USB, storage, audio, firmware, or board evidence is created by this package. |

## 3. Pure contract and stable identity

`tools/confirmation-trust/provider-qualification.mjs` contains no repository
paths, current artifact hashes, fixed evaluation timestamps, release-subject
revisions, or snapshot-specific counts. It owns stable profiles, capability
rules, level semantics, canonical identities, semantic cross-validation,
promotion barriers, and public redaction rules.

The current reference profile is
`confirmation-provider-qualification-reference-v1`. The name
`production-confirmation-provider-qualification-v1` is reserved for a future
configured production verifier and is not selected by this package.

Stable qualification identity is built from provider revision, the observed
confirmation-trust report/profile and negative summary, public trust-policy
identities, replay-schema identity, and capability rules. Release timestamps,
release decision IDs/counts, target state, target pending counts, and their
artifact hashes are excluded from that identity. `environmentId` follows the
same stable evidence boundary.

The release-candidate binding is separate. Its identity binds the exact
release subject, catalog/version, decision ID and artifact hash, sorted blocker
set, and a read-only target snapshot (profile, hash, unresolved state, and
pending/total observation). A release or target change therefore changes the
binding while preserving the provider qualification identity.

## 4. Qualification levels

Level results are derived from verified capability evidence and stable rules;
lower evidence never promotes a higher level.

| Level | Current status | Meaning |
|---|---|---|
| `L0` | `PASS` | Fixture confirmation contract, public trust-policy identity, replay-schema identity, and the observed all-pass negative summary are machine-checkable. |
| `L1` | `PARTIAL` | Depends on verified product transaction durability. Product audit transaction, parent-directory fsync/power-loss durability, robust stale-lock/multiprocess recovery, and a product replay store remain unproven. |
| `L2` | `MISSING` | Depends only on verified production key custody and key lifecycle; neither is connected. |
| `L3` | `MISSING` | Depends on verified family authority and authentication evidence; neither is connected. |
| `L4` | `BLOCKED` | Requires L1 durability, L2 custody, L3 authority, a provider gate verifier, environment binding, and a non-synthetic production receipt. Release and target blockers are represented by the separate binding projection, not used as provider-level evidence. |

The highest fully passed level is `currentLevel=L0`; the evaluated partial
frontier is recorded as `assessedThroughLevel=L1`. Every current result keeps
`fixtureOnly=true`, `syntheticEvidence=true`, `productionEligible=false`,
`gateEligible=false`, `productionGateClosed=true`, and
`productionReceiptCreated=false`.

The reference manifest has no production-capability artifacts. Self-declared
`evidence.capabilities` objects, including all-true boolean sets, are rejected
fail-closed; they never promote a level or eligibility flag. Only a future
adapter with explicit semantic verification can add production capability
evidence. Target resolution and release readiness affect blocker details in
the binding projection, not the provider qualification level.

## 5. Ports, adapter, and composition root

`tools/confirmation-trust/provider-qualification-evidence-adapter.mjs`
exposes:

```js
createProviderQualificationEvidenceAdapter({ manifest, readArtifact })
```

The manifest is composition data: a caller supplies stable evidence keys,
roles, and repository-relative paths. `readArtifact(path)` is the only I/O
port. The adapter re-reads actual bytes, computes SHA-256, rejects empty or
non-UTF-8 input, and parses strict JSON (including duplicate-key rejection).
It does not compare dynamic release or target artifacts with a frozen prior
hash. Missing, malformed, tampered, duplicate, stale, or mismatched evidence
is rejected before report generation.

The pure evaluator then verifies cross-bindings: canonical decision and
catalog identities, shared catalog and release subject, evaluation decision
binding, gate-set partitions and derived counts, production-gate membership,
fixture boundary, negative-summary rule (`total > 0`, `passed === total`,
`zeroSideEffect === total`), and unresolved target structure/state.

The runner owns the current repository manifest and writes only:

- `build/confirmation-provider-qualification/report.json`
- `build/confirmation-provider-qualification/release-candidate-binding.json`
- `build/luna-production-authority-level-repair/test-report.json`

Future provider, custody, account, product-transaction, or gate-verifier
adapters can supply the same evidence shape without changing the protected
confirmation-trust contracts, provider/replay core, compiler, release
evaluator, or hardware modules.

## 6. Current report and blocked binding

The generated report explicitly records:

- fixture/synthetic boundary and the missing
  `RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED` gate;
- observed current ReleaseDecision identity, subject, 15/0/19/19 counts, and
  `releaseReady=false`;
- `BOARD_TARGET=UNRESOLVED`, `18/18 TARGET_EVIDENCE_PENDING`,
  `hardwareImpact=NONE`, and `offlineReady=false`;
- the L0–L4 matrix, `currentLevel=L0`, `assessedThroughLevel=L1`, and exact
  unsupported durability, custody, authority, verifier, and target evidence;
- actual artifact roles, repository-relative references, byte sizes and
  hashes, with public-only redaction;
- the `NEG-22-production-confirmation-self-report` negative-control identity;
- no production receipt and no hardware artifact.

The binding projection remains:

```text
state=BLOCKED
fixtureOnly=true
syntheticEvidence=true
productionEligible=false
gateEligible=false
sealed=false
productionAuthorized=false
providerQualificationReceiptId=null
```

No file is created below `hardware/evt0/release-evidence/`.

## 7. Determinism, negative checks, and restart boundary

The targeted runner has a named 84-check set. It covers deterministic repeat,
exact current observations, level non-promotion, fixture/synthetic barriers,
release and target binding, dynamic release timestamp/decision identity,
non-production gate-count changes, target pending-count changes, malformed or
tampered artifacts, duplicate keys, wrong profiles/counts, stale or mismatched
release/evaluation/subject data, forged readiness flags, rejected self-declared
capability booleans, missing verifier and
custody evidence, secret/path leakage, blocked-binding promotion, output
parseability, and receipt/hardware absence.

Dynamic release or target observations alter the binding and report observation
without changing the stable provider qualification identity. All checks run in
memory first; canonical outputs are written only after every check passes, so
failed inputs leave an existing report unchanged or leave no report.

Restart, power-loss, multiprocess stale-lock recovery, and product audit
transaction semantics remain explicit `L1` gaps. No evidence is manufactured
to promote them.

## 8. Secret boundary and rollback

The report may expose public `kid`, policy IDs, authority revision IDs, release
IDs, artifact hashes, counts, and redacted capability references. Token,
cookie, authorization, username, hostname, private-key, seed, recovery,
account-export, and internal-handle fields or values are rejected.

A future adapter owns secret handles, signing, rotation, revocation,
authentication, and secure deletion. Rollback is bounded: remove the two
qualification output files/directories or disable the root targeted script.
There is no database migration, key rotation, receipt revocation, release
mutation, or stable-contract change.

## 9. Integration boundary and hardware impact

`test:confirmation-provider-qualification` is part of the root
`validate:contracts` sequence immediately after `test:confirmation-trust`.
The sealed `tools/release-gates/run-product-rd.mjs` remains byte-for-byte at
its protected catalog binding; full product-R&D integration is a later
catalog-owner decision. This repair therefore does not refresh catalog
semantic bindings or alter ReleaseGate logic.

`hardwareImpact=NONE` is an asserted output. The package reads the current
target-binding snapshot only, preserves `UNRESOLVED` and the observed pending
count, and introduces no board/OID/USB/storage/audio/firmware constant,
transport rule, device artifact, or EDA/procurement claim.

## 10. Evidence required before production qualification

Separate future work must supply a real family authority revision and
authentication event, controlled key custody and lifecycle, product-durable
replay/audit transactions, provider deployment identity, a configured
gate-specific verifier, and a non-synthetic receipt for the exact current
release subject. Existing per-build `BuildAuthorization` and independent
hardware/physical gates remain separate requirements.
