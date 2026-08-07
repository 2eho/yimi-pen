# Fixture method contract: USB data and control/status HIL v1

`HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1` freezes two reusable,
target-neutral method skeletons. It does **not** accept a lab method, allocate
an instrument, bind a board, create physical evidence, or close a ReleaseGate.
The package remains revision `1.0.0`, `PROPOSED_CONTRACT_COMPLETE`, with
`BOARD_TARGET=UNRESOLVED` and all effects `NONE`.

## Corrected ownership seam

The layers are intentionally single-owner:

```text
stable target-neutral contract
  -> method-specific adapter (only METHOD_ADAPTER pending mappings)
  -> run binding + existing fixture adapter
  -> lab session / TestResult raw-artifact owner
  -> evidence-capture owner / ReleaseGate owner
```

The accepted fixture adapter remains the sole owner of the board/head/firmware
five-tuple, generic electrical/mechanical target facts, physical adapter
identity/readiness, serial, calibration and qualification. The new method
adapter is method-scoped; it has no target tuple, generic target fields,
instrument IDs, session/result/evidence/release IDs, software scenarios, or
firmware implementation-lane identities.

Each contract carries a closed `fieldOwnership` map. Every field named by its
four source-derived phases resolves exactly once to `METHOD_ADAPTER`,
`RUN_BINDING`, `EXISTING_FIXTURE_ADAPTER`, or `OWNER_REFERENCE`, and the
validator proves that the ownership union equals the phase-field union. The
method adapter contains only method-scoped pending mappings: USB transport
fields, or control/status timing/route mappings (`STIMULUS_LEVELS`,
`TRACE_CLOCK`, `FLASH_ROUTE`, `LOG_ROUTE`). Physical `PIN_MAPPING`,
`CONNECTOR`, and `FIRMWARE_VERSION` resolve to the accepted fixture adapter
paths (`targetDependent.pinMappings`, `targetDependent.connectorMappings`,
and `targetIdentity.fullFiveTuple.FW_VERSION`).

The run template has exact method-scoped pending/null/empty input slots. USB
uses `CABLE_OR_FIXTURE_ID` and `PAYLOAD_SET`; control/status HIL uses
`FAULT_MODEL`, `EXPECTED_SEQUENCE`, `MEASUREMENT_SET`, and
`ACCEPTANCE_PREDICATES`. `FIXTURE_INSTANCE` is a direct
`fixtureInstance.id` reference. `SESSION_ID`, `TEST_RESULT_ID`,
`RAW_EVIDENCE_INDEX`, and `RELEASE_GATE_RECEIPT` are owner references to
`labSession.sessionId`, `testResult.resultId`,
`evidenceCapture.captureIndexId`, and `releaseGate.receiptId` respectively.
No field is duplicated or orphaned across layers.

## Frozen proposed contracts

| Proposed ID | Gap | Interfaces | Evidence boundary | State |
|---|---|---|---|---|
| `PROPOSED-USB-DATA-OBSERVATION-001` | `GAP-IF-USB-DATA-METHOD` | `IF-USB-DATA`, `IF-USB-MECHANICAL` | USB-IF revision/compliance and ordered transport observation; no class, identity, endpoint, pin, connector or threshold inference | `PROPOSED_ONLY` |
| `PROPOSED-CONTROL-STATUS-HIL-001` | `GAP-CONTROL-STATUS-METHOD` | `IF-CONTROL`, `IF-STATUS`, supporting `IF-DIAGNOSTIC` | HIL stimulus/observation ordering, diagnostics and trace attachment; no target I/O or firmware semantics inference | `PROPOSED_ONLY` |

Each contract preserves the four evidence-audit phases and five raw-output
kinds. USB scenarios point to a future accepted DeviceLink/software
transaction scenario. Control/status runs can later identify a firmware
artifact role and implementation lane without claiming that either target lane
exists today.

## Run binding and evidence-capture boundary

`run.template.json` references the existing fixture adapter by path,
`EVT0-TARGET-ADAPTER-TEMPLATE`, and revision, but has no real binding ID. The
run remains `TEMPLATE_ONLY`: target adapter, fixture profile/instance, lab
session, TestResult, software and firmware identities, raw artifacts, verdict,
and physical readiness are null or empty.

The current evidence-capture profile has only
`VENDOR_CONTACT`, `BENCHMARK_SELLER`, `LAB_REGISTRY`, and `VENDOR_RESPONSE`
lanes. There is no HIL/raw-test lane. Therefore both the contract owner
projection and run template explicitly use
`captureRouteState=PENDING_OWNER_EXTENSION`, `laneId=null`, and
`captureIndexId=null`. `TestResult.rawArtifacts` remains the current raw
artifact owner; the TestResult/raw artifact owner remains authoritative and no
HIL capture route is claimed. The evidence-capture owner reference is retained
as `PENDING_OWNER_EXTENSION` until an official HIL/raw-test lane exists.

## Pending target boundary

All USB role/revision/mode/class/identity/endpoints/transfers/payload/framing,
control/status channels/levels/timing/debounce/state codes, debug/flash/log/
fault data, electrical/mechanical values, calibration, qualification, serial
and acceptance thresholds remain unresolved. The storage power-loss proposal
is outside this package and retains
`KEEP_PENDING_MORE_PRIMARY_EVIDENCE` in the method-gap evidence audit.

## Validation

The validator recompiles three closed JSON schemas and compares every package
JSON file to canonical pretty-printed JSON plus a newline. It checks exact
contract/phase/interface/source/raw-output coverage, field ownership closure,
method-adapter scoping, the existing fixture/method-gap semantic validators,
the absent HIL capture lane, live software boundary semantics, and
implementation SHA-256 identities. The selftest mutates ownership, fixture
and run duplication, false HIL readiness, formatting, promotion, target
values, phase/source coverage, owner references, live dependencies and software
boundaries. A benign software task/hash progression remains accepted because
task names and hashes are not validity gates.

Reports are ignored build outputs and never represent physical evidence.
