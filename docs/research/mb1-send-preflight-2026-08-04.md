# MB1 发送前防漂移检查与人工交接（2026-08-04）

> 工作包：`HW-MB1-SEND-PREFLIGHT-01`  
> 作用：在人员执行三路真实外发前，复算官方入口、冻结外发归档、待发草稿和本地证据目录的一致性。  
> 当前事实：3/3 工作区通过 preflight；真实提交、供应商回件、付款资格和目标绑定仍为 0。

## 1. 为什么增加这一门

既有 `vendor-outbound-v1` 保证询证文本可复算，`vendor-contact-receipts-v1` 保证发送后的
Message-ID、表单确认号或 FAE 工单与原件闭合。两者之间还需要一个发送前检查，避免人员打开已经漂移、
串线或载入残留原件的工作区。

本包新增：

- `scripts/check-vendor-contact-send-readiness.mjs`
- `scripts/test-vendor-contact-send-readiness.mjs`
- `npm run check:vendor-contact-send-readiness`
- `npm run test:vendor-contact-send-readiness`

检查器只生成本地 preflight 报告；提交动作、供应商回复、付款和 `BOARD_TARGET` 状态保持原值。

## 2. 当前一手入口复核

`npm run refresh:vendor-contact-sources` 在本工作包内连续复算 4/4，source-set
SHA-256 为 `7344e7c51d13742981b1d46e9443ab414b6d3a7d8d1223f29330de49fe7baf43`：

| 路径 | 当前原件身份 | 人工发送边界 |
|---|---|---|
| [Ztron Contact](https://www.ztrontech.com/contact/) | 34,263 bytes；SHA-256 `559e95c10f3e882ad77f13a5a333a6d3fa49718110cc1aaf06fc4595d956818a` | 官方页列出 `market3@ztrontech.com` 与 `market2@ztrontech.com`；发送当日保存页面与 `.eml` |
| [春苗点读笔方案页](https://www.szdianjiao.com/articles/readpen.html) | 8,635 bytes；SHA-256 `5020ec8d66a122651f3ff3cb0674c0aad311d7ab6aa4bbfb29dfdc787c84013f` | 官方页列出 `190530584@qq.com`；发送当日保存页面与 `.eml` |
| [Sonix FAE](https://www.sonix.com.tw/page/FAE) | 713,604 bytes；SHA-256 `97d08ed991f8c92233e9887c77544a7f42eea8307d4f116a5bb61061091c5777` | 页面当前显示会员登录入口；登录后选择 OID 路线，保存确认页和工单号 |
| [Sonix FAE script](https://www.sonix.com.tw/webapi/fl001005/fae.js) | 104,014 bytes；SHA-256 `06c2de68d7933876f4e7d15b9c1951b94bde113ffe830ac747ebafdd114fdaac` | 只证明客户端字段/路由语义；真实受理以提交原件为准 |

同一工作窗口的浏览器可见状态进一步确认：Ztron 与春苗页面仍展示归档联系方式；Sonix FAE 页面显示
“请先登录会员”提示。浏览器观察只作发送操作提示，项目中的 bytes/SHA-256 快照才是当前可复算来源。

## 3. Preflight 合同

每个待发工作区执行 25 项检查：

1. 工作区、draft、checklist、冻结 manifest 与空 `raw/` 均存在；
2. draft 通过 Contact Receipt v1 Schema，目录名与 `receiptId` 一致；
3. 状态保持 `PENDING/PENDING_SEND`，endpoint/submission/raw 事实为空；
4. `targetBindingEffect=NONE_CONTACT_ONLY`、`paymentEffect=NONE_AWAIT_VENDOR_RESPONSE`；
5. 同 ID 的正式 record 尚待建立；
6. manifest 路径、bytes、SHA-256、bundle contract 与 `reproducibleId` 闭合；
7. message、candidate、sourceRefs、recipient-entry 和官方 URL 交叉绑定；
8. message/recipient 文件实际 bytes/SHA-256 与 draft 一致；
9. 冻结归档的 13 文件树与当前已验证 outbound tree 一致。

隔离自检 4/4 覆盖：完整工作区通过、消息篡改拒绝、`raw/` 残留拒绝、正式 record ID 冲突拒绝。

当前报告：`build/vendor-contact-send-readiness.json`。结果为 3/3 工作区、每个 25/25；三个冻结
归档均为 13 文件，tree SHA-256
`81518140e346d0c88a1c62472ea8b9378882ec4cf363dc446954c97d27c051aa`。外发 bundle 保持：

```text
sha256:3ef0820cdc323d0a1cf8dfb80ea918a6c707924025f95c78f17998d19f777d7d
```

## 4. 人工交接入口

| 工作区 | 发送清单 | 当前状态 |
|---|---|---|
| `20260804-ZTRON-01` | `build/vendor-contact-receipts/20260804-ZTRON-01/SEND-CHECKLIST.txt` | `READY_FOR_MANUAL_SUBMISSION / PENDING_SEND` |
| `20260804-CHUNMIAO-01` | `build/vendor-contact-receipts/20260804-CHUNMIAO-01/SEND-CHECKLIST.txt` | `READY_FOR_MANUAL_SUBMISSION / PENDING_SEND` |
| `20260804-SONIX-01` | `build/vendor-contact-receipts/20260804-SONIX-01/SEND-CHECKLIST.txt` | `READY_FOR_MANUAL_SUBMISSION / LOGIN_REQUIRED / PENDING_SEND` |

发送完成后，将官方入口原件和 `.eml`/确认页放入对应 `raw/`，把 draft 复制到
`hardware/evt0/vendor-contact-receipts-v1/records/<receipt-id>.json`，填写真实 transport reference、
bytes 和 SHA-256，再运行 `npm run validate:vendor-contact-receipts`。状态最多进入
`AWAITING_RESPONSE`；供应商原始回件继续由 `vendor-evidence-v1` 验收。

## 5. 双线与硬件影响

- 软件 owner 已正式收口 Asset Vault Recovery 70/70（报告 SHA-256
  `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`），边界仍是单进程
  App-owned host workspace，`hardwareImpact=NONE`；当前已启动 framework-neutral Authoring Product
  Shell，会话内核尚处软件执行期，当前没有形成硬件接口输入。
- 本包复用既有 `evidence-sources`、outbound manifest、Contact Receipt Schema、原始文件哈希与
  Vendor Evidence 门；新增变化收敛在发送前 checker 和 fixture test。
- HardwareSystem、18 条 target binding、board adapter、BOM revision、硬件测试与 EDA transport
  均保持原状态；`BOARD_TARGET=UNRESOLVED`。
- 同窗口 PnP 发现只有主机音频端点和 `COM1`，`qualificationEffect=NONE_DISCOVERY_ONLY`；Lab
  仍为 records 0、qualified 0。

## 6. 收益复排

| 排名 | 工作包 | 分项 | 总分 | 下一动作 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | 人员执行三份 checklist，保存 Message-ID/确认号/FAE 工单 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 条件项，仍受 REF2 原件门控 |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | 发送卖家请求并取得 11 项同一待发物原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | 采集 6 槽位/7 资产的铭牌、serial 与校准/自检原件 |
| 5 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | `16/20/5/10/6/7` | **64** | 仅在安排短维护窗口后进入真实迁移 |
| 6 | `HW-EDA-SKELETON` | `15/16/5/9/7/5` | **57** | 当前 18 接口骨架继续复用 |
| 7 | 芯片级自研 PCB | `10/4/4/4/5/2` | **29** | 一体板书面/双样实物门通过前保持锁定 |

preflight 已把本地误发风险收敛；最高收益增量现在只来自真实外发与原始提交证据。
