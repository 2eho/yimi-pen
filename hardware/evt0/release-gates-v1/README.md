# ReleaseGateCatalog / EvidenceReceipt / ReleaseDecision v1

该合同把原先分散在产品、Family、固件和 Rust runner 中的 `releaseReady=false + blockers[]`
收敛为一个版本化判定链：

```text
ReleaseGateCatalog v1
  + EvidenceReceipt[]
  + PRODUCT_RELEASE subject
  → deterministic ReleaseDecision v1
```

## 边界

- gate ID 使用肯定式稳定 `RG-*`；通过、失败、缺失只出现在 receipt/decision；
- catalog ID 同时覆盖 host adapter registry、legacy inventory，以及 receipt/decision Schema、判定函数、
  report operator、源码集合、密封 run 和当前 evaluator 的原始 SHA-256；解释语义变化会生成新的 catalog
  identity，而不是悄悄重解释旧 receipt；
- 旧 `*_PENDING/*_UNFROZEN` 只在 `legacyAliases` 中迁移，输出永远使用 canonical ID；
- `RELEASE_GATE_CATALOG_PENDING` 是实现状态，自举进入 catalog 会形成循环，因此明确排除；
- `RELEASE_GATE_RECEIPT_PENDING` 是迁移机制；缺 receipt 会自然形成 `missingGateIds`，不再作为产品 gate；
- `gateId`、`diagnostic.errorDomain/errorCode`、`diagnostic.reasonCode` 是三个独立命名域；
- assigned physical map 不等于实物证据。物理/生产 gate 只接受 `syntheticEvidence=false`、
  指定 producer、subject 和 artifact role 齐全的 receipt。

Catalog v1 当前含 34 项：15 项 host 合同门、19 项物理/生产门。加权随机的 host 合同由
`RG-HOST-WEIGHTED-RANDOM-CONTRACT-PASSED` 表示；非 fixture Snapshot、目标 RNG 和双板分布仍由
`RG-SNAPSHOT-WEIGHTED-RANDOM-VERIFIED` 表示，前者不关闭后者。确认链同样分层：
`RG-HOST-CONFIRMATION-TRUST-CONTRACT-PASSED` 只证明本仓库合同与 fixture，
`RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED` 证明当前产品版本的 provider 资格；逐家庭构建仍必须
另带绑定单个 BuildPlan 的 `BuildAuthorization`。

## Receipt 身份

每个 receipt 绑定：

- catalog ID/version 与 canonical gate ID；
- `PRODUCT_RELEASE` subject 的 ID 和 revision SHA-256；
- 实际 evidence subject（板、工具链、Snapshot、固件或 host report）及 revision SHA-256；
- producer ID/version、严格 RFC 3339 时间、PASS/FAIL；
- artifact role、仓库相对路径、大小和 SHA-256；
- synthetic 边界与可选 namespaced diagnostic。

`receiptId` 是移除自身字段后的 canonical SHA-256。Decision 对 receipt ID 排序，输入顺序不影响
`decisionId`；同 gate 出现 PASS/FAIL 冲突、subject 过期、catalog 漂移或缺 artifact 时直接报错。
外部物理/生产 receipt 的 artifact 必须持久化在 `hardware/evt0/`，evaluator 会读取实际字节并
复核 size/SHA-256；仅在 JSON 中填写摘要不会形成 PASS。

## 当前主机适配

[`host-report-adapters.json`](./host-report-adapters.json) 是现有报告到 15 个 host receipt 的唯一
适配表。各 validator 不再维护私有 blocker taxonomy；当前 decision 的 owner 是：

```text
build/release-gate-current/release-decision.json
```

执行：

```powershell
npm run validate:full
# 仅在源码、密封 run 和15份报告均未变化时，可重复复算同一 decision：
npm run evaluate:release-gates
```

`validate:full` 由独占 runner 记录报告运行前指纹，重跑全部 host producer，要求源码集合在运行期间零漂移、
15份报告均本轮刷新，再写入 `build/release-gate-host-run.json`。Evaluator 要求该 run 绑定当前源码集合、
catalog 和精确 report hash；host receipt 使用密封 run 的固定完成时间，重复评价不会改变 receipt set 或
decision identity。合同回归使用专用 fixture catalog 验证完整 PASS、缺 receipt、FAIL、多主体、顺序无关和
22条负例，其中包含伪造的 production confirmation 自报 PASS；不生成生产物理 receipt。当前 evaluator
读取15个真实 host report；在 `hardware/evt0/release-evidence/` 没有物理 receipt 时，decision 保持
15项通过、19项缺失、
`releaseReady=false`。

## Family 构建兼容说明

`family-build-request-v1.releaseGateReceiptRef` 是早期单 receipt 兼容字段，设计 fixture 固定为
`null`。该 v1 路径保留旧黄金字节，但 `release-candidate` 已封闭。新流程先使用不含 confirmation 的
`BuildPlan` 生成 preview，再由 proof 验证生成 `BuildAuthorization`；产品级 `ReleaseDecision` 与逐构建
authorization 必须同时满足。旧字段不在 v1 上静默改变语义。
