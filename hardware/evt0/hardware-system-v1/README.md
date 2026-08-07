# HardwareSystem v1

This contract separates stable product topology from target-specific evidence.

| File | Ownership |
|---|---|
| `topology.schema.json` / `topology.json` | Stable logical blocks, ports, interface semantics and requirement links |
| `target-binding.schema.json` / `target-binding.json` | Current intake selector, interface evidence/test/gate links and EDA readiness |

Current state is `UNRESOLVED`. The binding intentionally contains no copied board, head or
firmware identity; those facts come from an accepted record under `../intake-v1/records/`.

Update sequence:

1. Record supplier, observed and measured facts in EVT-0 intake.
2. Run `npm run validate:evt0-intake`.
3. Update interface binding states only when their referenced evidence and release gates close.
4. Run `npm run validate:hardware-system`.
5. Add a new board adapter without editing the stable topology unless a product requirement
   proves that an existing port or interface semantic is insufficient.

Human-readable architecture and the EDA gate are in
[`docs/hardware-system-architecture.md`](../../../docs/hardware-system-architecture.md).

