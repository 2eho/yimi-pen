# Release evidence receipts

本目录只接收通过 `EvidenceReceipt v1` Schema、语义身份和 ReleaseGateCatalog 校验的
`*.receipt.json`。物理 receipt 必须由相应测量/制造/板级 producer 生成，绑定同一
`PRODUCT_RELEASE` subject、原始工件 SHA-256 和非 synthetic 证据。

当前目录没有物理 receipt；host reports 由 `tools/release-gates/evaluate-current.mjs` 在
`build/release-gate-current/receipts/` 中适配，不在此伪装成实物证据。
