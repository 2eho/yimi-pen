# Hardware EDA system skeleton v1（2026-08-04）

## 1. Work package

`HW-EDA-SYSTEM-SKELETON-V1` projects the stable HardwareSystem v1 topology into a renderer-neutral hierarchy, logical interface register, deterministic SVG preview, and an unexecuted JLCEDA write plan.

The package deliberately stops at the current target-binding gate:

- `BOARD_TARGET=UNRESOLVED`;
- `eda.readiness=SYSTEM_SKELETON_ONLY`;
- `systemSkeletonReady=true`;
- `chipLevelReady=false`;
- permitted work is exactly `HIERARCHY / BLOCK_DIAGRAM / INTERFACE_LABELS`;
- symbols, pins, physical network names, rail values, connectors, and PCB layout remain locked.

No `.eprj`, `.esch`, `.epcb`, native export, circuit, BOM, ERC/DRC result, or manufacturing artifact is claimed by this package.

## 2. Evidence used

### Hardware facts

The only block/interface fact owner is:

- `hardware/evt0/hardware-system-v1/topology.json`;
- 15,420 bytes;
- file SHA-256 `96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5`;
- canonical topology ID `hwt:sha256:98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f`;
- 12 stable blocks, 36 logical ports, and 18 interfaces.

`target-binding.json` supplies only the current readiness/lock context. `hardware/eda/manifest.json` confirms JLCEDA project identity remains `UNSET/UNFROZEN`, `designWrite=false`, and the native artifact register is empty.

### Official JLCEDA evidence

Official repositories were captured read-only at:

- `easyeda/easyeda-api-skill` commit `72d3ce97b6bf3ece54b75806933df12980e83b7d`;
- `easyeda/pro-api-sdk` commit `a1b5457da2e402b91ffa46bb7545963b09664e36`.

The pinned official references establish that:

1. V3 native source is a project log with document/client identity, tickets, and unique primitive identities; an offline fragment without project lifecycle/readback would not prove a real JLCEDA project.
2. The extension API exposes project/document inspection, schematic/page creation, rectangle/text creation, save, readback, and SVG/PDF export surfaces.
3. Page creation, text creation, and document export used by the future route include Beta APIs and therefore need a separate version-pinned write/readback package.
4. An EDA `WIRE` carries electrical network semantics through its network attribute. The current preview therefore uses SVG graphic polylines; a future EDA overview lists interfaces as text and creates zero EDA wires/buses.

Every pinned file URL, retrieval time, bytes, and SHA-256 is recorded in `hardware/evt0/eda-system-skeleton-v1/evidence.json`.

## 3. Reusable architecture

```text
HardwareSystem topology (single fact owner)
  -> role-only logical layout policy
  -> deterministic logical hierarchy
  -> 12 leaf views + 18-interface register
  -> renderer-neutral write plan
  -> SVG review preview
  -> future isolated JLCEDA applicator (separate gate)
```

Board/head/storage/audio substitutions do not create a second architecture model. They continue to enter through `target-binding`, the board adapter, BOM revision, intake records, and tests. The system skeleton is regenerated from the same 12-block/18-interface owner.

The layout profile owns presentation positions by stable **role**, rather than copying block or interface contents. New implementation detail is rejected by recursive field gates and implementation-value probes.

## 4. Generated outputs

`npm run generate:eda-system-skeleton` writes only under `build/eda-system-skeleton-v1/`:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `logical-skeleton.json` | 42,076 | `13da791e83896499609215689283bcae5a0de5b19297dac9f450608d1fc50c3a` |
| `write-plan.json` | 33,567 | `665f7427812df71f4b929a9975e5960a998aa6fbe2cfb39cc34660bda7d7ae61` |
| `system-overview.svg` | 21,080 | `e7ca6db6be981ffea23b1a6972cf58a6e1ed582c05065c199451477f34163767` |

The write plan keeps all native project/document/page identities null, records `nativeSourceGenerated=false` and `nativeExportGenerated=false`, and permits only future rectangle/text primitives. It stores visual placement references instead of EDA coordinate arguments; a later applicator owns a separate versioned coordinate/style mapping. Interface lines stay in the SVG preview and have no arrowhead, electrical direction, or physical geometry meaning.

## 5. Validation

```powershell
npm run validate:eda-system-skeleton
```

Result:

- generator and byte-for-byte check: 3/3 artifacts;
- independent validation: 26/26;
- projection: 12 blocks / 36 logical ports / 18 interfaces;
- isolated negative/self tests: 20/20;
- negative probes cover component/symbol/pin/network/rail/connector/PCB injection, target/write-state drift, layout-role duplication, interface endpoint drift, topology identity drift, artifact tamper, and output-path escape.

The full machine reports are:

- `build/eda-system-skeleton-v1/validation.json`: 6,721 bytes, SHA-256 `551b0d4f8bad5b29c23ab6c91611f558e0ed2bcb3da4a01483fed6e906e4c1a3`;
- `build/eda-system-skeleton-v1/selftest.json`: 3,052 bytes, SHA-256 `b8481e9792958c082ef6b3bfa0d34a0502eaa9fde7590960ca9aae11a6f9fcc5`.

## 6. Future controlled JLCEDA apply gate

A separate package may execute the plan only after a connected isolated project, scoped design-write window, active document identity, pre-write snapshot, rollback point, and pinned API readback test are all captured. It must record native project/page identities, rectangle/text counts, official export bytes/SHA-256, post-write snapshot, and rollback evidence.

That later operation still creates only a system documentation view. Chip-level circuit work remains behind accepted target identity, supply, OID code/tool, two same-revision samples, and the existing release gates.

## 7. Software-line synchronization

At package start, the software owner had `SW-AUTHORING-PRODUCT-SHELL-01A` in progress. During this hardware package a 31/31 product-shell report appeared, with SHA-256 `c7c8cb54918dafe74210b31268c500c14012557bafddcfc7a9fec3f5e341189a`; its reported boundary keeps `BOARD_TARGET=UNRESOLVED`, device delivery separate, and `hardwareImpact=NONE`.

The hardware projection already exposes the needed stable OID event, storage, DeviceLink/USB, audio, control/status, and diagnostics boundaries. No new codec, storage, USB, OID-event, power, mechanical, BOM, or board-adapter fact entered this package. Formal software owner state is re-read at hardware closeout before final ranking.
