# Research notes

技术调研与 RFQ 笔记（非产品定稿）。

| 文档 | 内容 |
|------|------|
| [github-survey-2026.md](./github-survey-2026.md) | GitHub 上对数值/选型/行动缺口的细分调研 |
| [embedded-tooling-cli-mcp-2026.md](./embedded-tooling-cli-mcp-2026.md) | 一体主板与 ESP32-S3 两条路线的嵌入式 CLI、MCP、测试、音频和 KiCad 工具选型 |
| [mature-products-gen1-p0.md](./mature-products-gen1-p0.md) | 小鸡球球、宝贝 JoJo、讯飞的证据分级对标与采购/拆解清单 |
| [oid-board-generation-survey-2026.md](./oid-board-generation-survey-2026.md) | 用户主板照片、组创公开方案与“第四代 OID”代际口径复核 |
| [product-system-evidence-2026.md](./product-system-evidence-2026.md) | 产品、OID、主板、Snapshot 与固件决策使用的证据等级和来源台账 |
| [evidence-gate-audit-2026-08-03.md](./evidence-gate-audit-2026-08-03.md) | 截至 2026-08-03 的桌面证据闭合边界、`BOARD_TARGET` 冻结顺序和下一步最小证据包 |
| [gen1-evt0-single-buy.md](./gen1-evt0-single-buy.md) | 目标件单买、精确料号锁定、下单门、来料检验与预算窗 |
| [gen1-p0-oid-rfq.md](./gen1-p0-oid-rfq.md) | 当前 `M01-M08` 预询证与 EVT-0 后续 OID/印刷/SDK/授权/批量报价问卷 |
| [gen1-mb1-prepay-pack.md](./gen1-mb1-prepay-pack.md) | 两家完整 PCBA/OID 候选与松翰原厂交叉核对的付款前发送包、回件归档和付款门 |
| [mb1-contact-channel-integration-2026-08-04.md](./mb1-contact-channel-integration-2026-08-04.md) | Ztron、春苗与松翰当前官方联系入口、原始页面/脚本hash、登录边界和外发 sourceRef 集成 |
| [vendor-contact-receipts-v1-2026-08-04.md](./vendor-contact-receipts-v1-2026-08-04.md) | 确定性外发包与供应商回件之间的不可变发送归档、官方入口/提交原件和篡改拒绝合同 |
| [vendor-contact-receipts-independent-review-2026-08-04.md](./vendor-contact-receipts-independent-review-2026-08-04.md) | Contact Receipt 独立审计、路径/端点/收件人/传输证据发现及同日集成复核 |
| [mb1-send-preflight-2026-08-04.md](./mb1-send-preflight-2026-08-04.md) | 三路 MB1 待发工作区的 draft/归档/入口/tree 防漂移检查、隔离负向门与人工发送交接 |
| [hardware-evidence-capture-adapter-v1-2026-08-04.md](./hardware-evidence-capture-adapter-v1-2026-08-04.md) | 四 lane 原始证据复制、哈希、显式 route、owner fragment、不可变 index、回滚和收口验证 |
| [hardware-software-sync-2026-08-04.md](./hardware-software-sync-2026-08-04.md) | 双线每包同步门、近期软件增量对18条硬件接口的只读影响判定与变化收敛规则 |
| [hardware-evidence-procurement-audit-2026-08-04.md](./hardware-evidence-procurement-audit-2026-08-04.md) | 官方来源当前性、MB1五元组、benchmark采购、付款/到货门和最新收益排序审计 |
| [hardware-reuse-maintainability-audit-2026-08-04.md](./hardware-reuse-maintainability-audit-2026-08-04.md) | 稳定拓扑、target binding、BOM/revision、intake/lab/receipt复用链及已证实漂移审计 |
| [hardware-validation-readiness-audit-2026-08-04.md](./hardware-validation-readiness-audit-2026-08-04.md) | HardwareSystem、intake、lab、EDA bridge/singleton和物理开放门的本机验证审计 |
| [hardware-lab-instrument-registration-2026-08-04.md](./hardware-lab-instrument-registration-2026-08-04.md) | 六槽位/七物理资产的真实仪器登记、铭牌/校准哈希门和本机 PnP 只读发现结果 |
| [hardware-lab-registration-capture-v1-2026-08-04.md](./hardware-lab-registration-capture-v1-2026-08-04.md) | 六槽位/七资产单一采集计划、pending-only工作区、serial来源与参考标准证据闭包 |
| [benchmark-sku-evidence-2026-08-04.md](./benchmark-sku-evidence-2026-08-04.md) | REF1–REF3 当前零售原页、官方 G4 型号链、卖家同框补证模板与防误付状态 |
| [benchmark-proof-followup-2026-08-04.md](./benchmark-proof-followup-2026-08-04.md) | REF1 售罄/JD空壳、REF2 G4与446637未同框、REF3身份/预算不闭合的独立复核 |
| [benchmark-seller-evidence-v1-2026-08-04.md](./benchmark-seller-evidence-v1-2026-08-04.md) | REF2 同一待发物的11项卖家原件门、连续视频绑定、独占raw归档、哈希验证和pending工作区 |
| [jlceda-shared-transport-design-2026-08-04.md](./jlceda-shared-transport-design-2026-08-04.md) | stdio 多实例与 EPIPE 分层根因、共享 Streamable HTTP 设计、迁移/回滚和待验矩阵 |
| [jlceda-shared-http-poc-2026-08-04.md](./jlceda-shared-http-poc-2026-08-04.md) | 隔离共享HTTP的双session、关闭隔离、stop/restart、保护态回归与live迁移剩余门 |
| [eda-system-skeleton-v1-2026-08-04.md](./eda-system-skeleton-v1-2026-08-04.md) | 12块/36逻辑端口/18接口的确定性EDA系统骨架、官方API证据、SVG预览、写入计划与芯片级负向门 |
| [next-work-package-ranking-2026-08-04.md](./next-work-package-ranking-2026-08-04.md) | 每个工作包收口后对硬件/软件候选按关键路径、证据和实物收益动态排序 |
| [hardware-fixture-method-contract-usb-control-hil-v1-2026-08-05.md](./hardware-fixture-method-contract-usb-control-hil-v1-2026-08-05.md) | USB 数据观察与 control/status HIL 的 target-neutral 提议合同、适配器/运行模板与验证证据 |
| [hardware-hil-raw-evidence-capture-v1-2026-08-05.md](./hardware-hil-raw-evidence-capture-v1-2026-08-05.md) | HIL/raw-test 提议 owner extension、不可变 capture-index provenance、TestResult.rawArtifacts 接缝与待采集边界 |

定稿原则仍以 `/docs/theory.md` 及安全/硬件/商业专题为准。
## Hardware reusable test fixture v1

- `hardware-reusable-test-fixture-architecture-v1-2026-08-04.md` records the
  evidence-backed profile/adapter/instance/selftest seam, explicit method gaps,
  ownership boundaries, software read-only delta, and next decision.
- Validation is owned by `scripts/validate-hardware-test-fixture.mjs` and
  `scripts/test-hardware-test-fixture.mjs`; the current targeted result is
  `117/117` with `109/109` baseline and `40/40` rejected mutations. Ignored
  reports are written under `build/`.

## Fixture method-gap evidence audit

- `hardware-fixture-method-gap-evidence-audit-2026-08-04.md` records the
  primary-source capture, claim boundaries and evidence-based decisions for
  USB transport, storage power-loss durability, and control/status HIL gaps.
- The package is source-capture-only; proposed method IDs stay
  `PROPOSED_ONLY`, target parameters/thresholds stay pending, and no stable
  lab owner or accepted fixture file is edited. Revision `1.1.0` separates
  immutable audit-time dependency provenance from live fixture/software semantic
  checks; validation is `26/26` and the negative selftest rejects `30/31`
  mutations, with one benign current-identity drift accepted.

## Fixture USB/control-status method contract

- The revision-1.0.0 package freezes two target-neutral `PROPOSED_ONLY`
  contracts without adding a method, instrument, target, physical result or
  ReleaseGate receipt.
- The architecture-review refinement makes the method adapter method-scoped,
  keeps generic target facts in the accepted fixture adapter, and binds the
  run to the fixture adapter plus the existing TestResult/raw-artifact owner.
  Method-scoped run-input slots are explicit for USB cable/payload and HIL
  fault/sequence/measurement/predicate fields; fixture-owned PIN_MAPPING,
  CONNECTOR and FIRMWARE_VERSION resolve only to the accepted fixture adapter
  paths. The current evidence-capture profile has no HIL lane, so the contract
  keeps `PENDING_OWNER_EXTENSION` with null lane/capture IDs. The final
  validator is `38/38`; its selftest is baseline `38/38` with `42/43` mutations
  rejected (one benign software task/hash progression accepted).
