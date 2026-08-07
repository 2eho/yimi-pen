# HW-EVIDENCE-CAPTURE-ADAPTER-V1 收口记录（2026-08-04）

## 结论

统一硬件原始证据采集适配器已收口。它只负责把外部提供的普通文件复制到对应 owner
工作区的独占 `raw/` 目录，复算 bytes/SHA-256，保留显式媒体类型、采集时间、来源 URL
和 lane 路由，并生成一个不可变 capture index。它不推断事实、不填写五元组、不改变
owner record，也不提升发送、回件、资格、购买、BOM、ReleaseGate 或 `BOARD_TARGET`。

当前 `BOARD_TARGET=UNRESOLVED`；五元组仍不填推测值。软件线的 System TTS Source Adapter
只作为 `hardwareImpact=NONE` 的只读输入，41/41 报告未产生硬件接口、board adapter、BOM、
测试或 EDA 增量。

## 合同与四条封闭 route

适配器合同位于 `hardware/evt0/evidence-capture-v1/`：

- `profile.schema.json` / `profile.json`：固定四 lane、owner 文件/身份字段、raw 路径和非提升效果；
- `capture-request.schema.json`：请求路径、显式 metadata、单层 destination 和 lane route；
- `capture-index.schema.json`：请求/owner 身份哈希、artifact、闭合 route、闭合 ownerFragment 和效果；
- index 的四个 artifact 分支把 route 与 fragment 限定到各 lane，`additionalProperties=false`；
- Benchmark fragment 字段严格为 owner artifact 的九字段：`id/kind/provenance/path/bytes/sha256/
  mediaType/capturedAt/sourceUrl`；Contact、Lab、Vendor Response fragment 严格为五字段基础形状。

| lane | owner draft | route | 绑定门 |
|---|---|---|---|
| `VENDOR_CONTACT` | `receipt.draft.json` | 官方入口/提交导出/支持原件 | 只保留 receipt-bound 原件，实际发送仍由人工完成 |
| `BENCHMARK_SELLER` | `record.draft.json` | artifact kind + provenance | fragment 与 Benchmark owner schema 完全一致 |
| `LAB_REGISTRY` | `registry.draft.json` | `instrumentId + assetId + role` | asset 必须唯一存在于当前 draft instrument |
| `VENDOR_RESPONSE` | `response.draft.json` | role + referenceIds | tuple、`M01–M08`、`A01–A10`、sample set 必须来自 owner draft |

## 事务和保护门

1. 归一化并限制 request/workspace/index/destination/source 路径；source 只允许仓库内相对路径，
   拒绝绝对路径、别名段、越根、符号链接和 reparse-like 路径链。
2. preflight 校验 owner draft 为普通文件、`recordKind`、lane identity、workspace basename，
   Vendor Response 另外校验 candidate 目录绑定。
3. capture 前记录 owner/request bytes 与 SHA-256；artifact ID、destination 和归一化 source
   path 做大小写不敏感碰撞检查，已有 destination 永不覆盖。
4. source 只读稳定读取；staging 使用 `COPYFILE_EXCL`，每份 staged copy 做 source 前后哈希和
   readback；promotion 仍使用独占 copy，而不是可能覆盖目标的 `rename()`。
5. promotion 后复算 destination；owner/request 在 staging、index commit 前后均重新哈希；index
   使用 `wx` 单次写入，并仅在 `writeFile` 成功后建立 `indexWritten` ownership witness，写后再次验证
   owner/request/destination。
6. 失败时仅删除本 capture 新建且 SHA-256 匹配的 destination/index，保留外部修改、既有目标和
   无法证明归属的残留物；stage 始终清理。
7. `check` 只读复算 request、owner、route、fragment、destination 和 canonical pretty JSON index，
   并再次验证 owner/request 未漂移。

## 本机证据

- `node --check`：capture / validator / selftest 三个脚本通过；
- `npm run validate:hardware-evidence-capture`：当前报告 `build/hardware-evidence-capture-validation.json`，
  66/66；覆盖四 schema 编译、owner schema/template 兼容、四 route/fragment 封闭性、5 个准备 workspace
  只读 preflight、既有 index、target binding 和 TTS 只读边界；
- `npm run test:hardware-evidence-capture`：当前报告 `build/hardware-evidence-capture-selftest.json`，
  46/46；覆盖四 lane 成功、四 lane owner/source 不变、重复/大小写、已有目标、route/time/url、Lab 未知 asset、
  Vendor refs、owner identity、request 路径、source 路径门、staging/rollback、owner/request race、
  canonical index commit race、重复 capture、index/destination/request 篡改；
- `validate:hardware-rd` 已接入上述 validator 与 selftest，capture 入口另提供 `preflight/capture/check` npm scripts。

## 未关闭的外部证据

适配器收口不等于外部证据到达。真实 MB1 Message-ID/确认号/FAE 工单、供应商书面回件、两套同版
主板/OID kit、REF2 同一待发物卖家原件、LAB1–LAB6 六槽位/七资产实物原件、真实 OID/电源/存储/音频/
结构/HIL 测量仍缺。上述原件到达后先经本适配器归档，再由各 owner record 显式引用并运行原 validator。

## 收口后的硬件路线

当前收益排序保持：`MB1 96 > conditional buy 86 > REF2 send/capture 85 > Lab 77 > EDA live 64 >
controlled apply 58 > custom PCB 29`。最高下一任务仍是真实 MB1 发送；本包不越过 target evidence gate
进入芯片、引脚、电源值、连接器或 PCB layout。
