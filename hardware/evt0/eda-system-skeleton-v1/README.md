# EDA system skeleton v1

`HW-EDA-SYSTEM-SKELETON-V1` turns the stable HardwareSystem topology into one deterministic logical hierarchy, interface register, future JLCEDA write plan, and SVG preview.

## Boundary

This package is valid only while `BOARD_TARGET=UNRESOLVED` and target binding reports `eda.readiness=SYSTEM_SKELETON_ONLY`.

- Permitted: hierarchy, block diagram, logical interface labels.
- Locked: symbols, pins, physical network names, rail values, connectors, packages, PCB routing/layout, BOM, ERC/DRC, and manufacture outputs.
- `system-overview.svg` is a logical preview. Its coordinates are presentation data rather than physical geometry.
- `write-plan.json` is an unexecuted plan. It keeps project/document identities null and restricts a later controlled EDA pass to rectangles plus text.
- Interface arrows exist only in the SVG. The EDA plan uses a text register, because an EDA wire would carry electrical network semantics before target evidence exists.

The generator consumes `hardware-system-v1/topology.json` as the sole block/interface fact owner. Replacing a board, OID head, storage path, or audio path therefore changes target binding and adapters while this 12-block/18-interface projection remains reusable.

## Generate and validate

```powershell
npm run generate:eda-system-skeleton
npm run validate:eda-system-skeleton
npm run test:eda-system-skeleton
```

Generated artifacts (reproducible under `build/`):

- `logical-skeleton.json`
- `write-plan.json`
- `system-overview.svg`

Machine validation is written to `build/eda-system-skeleton-v1/validation.json`.

## Future controlled apply

The later applicator must use a connected, isolated JLCEDA project with a captured rollback point and scoped design-write permission. It must read back project/document identities and created primitive counts, export via the official API, and archive the native export plus hashes. That future evidence belongs to a separate work package and does not upgrade this logical skeleton into a circuit design.
