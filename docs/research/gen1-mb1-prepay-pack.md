# Gen1 MB1 付款前询证执行包

> 工作包：`HW-MB1-PREPAY-01`
> 更新：2026-08-04
> 状态：`READY_TO_SEND`；尚未记录任何已发送或已回复事实
> 主问卷：[Gen1 同版一体主板/OID RFQ](./gen1-p0-oid-rfq.md)

确定性人工外发包已落在
[`hardware/evt0/vendor-evidence-v1/outbound-v1/`](../../hardware/evt0/vendor-evidence-v1/outbound-v1/README.md)。
运行 `npm run validate:vendor-outbound` 后，从 `build/vendor-outbound-v1/` 取得三份邮件正文、
收件入口、附件请求清单、来源副本及完整 SHA-256 manifest；状态仍是 `PREPARED_NOT_SENT`。

## 1. 为什么当前先做这包

`BOARD_TARGET` 仍为 `UNRESOLVED`。它同时阻塞芯片级 EDA、Rust target/BSP、存储、
电源、音频、结构和 HIL。HardwareSystem v1 已把稳定的 12 块/18 接口冻结，本包只
取得目标绑定证据，不改稳定产品内核。

## 2. 首轮官方入口

| candidate | 角色 | 官方依据 | 首轮联系入口 | 当前边界 |
|---|---|---|---|---|
| `REF-ZTRON-LOCAL` | 完整一体 PCBA/OID 方案候选 | [点读笔方案](https://www.ztrontech.com/solutions/1.html) | [官方联系方式](https://www.ztrontech.com/contact/)；当前 `mailto:` 首选 `market3@ztrontech.com`，另列 `market2@ztrontech.com` | 只有方案级描述，缺完整板号、头 revision、固件、工具与同版供货 |
| `REF-CHUNMIAO-LOCAL` | 第二家完整 PCBA/OID 方案候选 | [点读笔技术方案](https://www.szdianjiao.com/articles/readpen.html) | 官方页面列出的 `190530584@qq.com` | 页面宣称 PCBA、SDK、OID 工具和本地存储，精确身份与可复现性均待回件 |
| `SONIX-OID-COMPONENT` | 芯片/模组原厂交叉核对，不替代 Q01 | [OID 产品目录](https://www.sonix.com.tw/products/oid) | [官方 FAE](https://www.sonix.com.tw/page/FAE)；当前为会员登录后技术表单 | 登录后选择 OID 产品线，询问准确 SKU、验证组合与方案伙伴；不把单颗 Decoder/Module 当完整板卡 |

首轮两家 PCBA 候选收到完全相同的问题。原厂 FAE 只补芯片/模组身份和推荐组合，
不与完整板卡候选混合评分。

## 3. 可直接发送的中文正文

**主题：** 益米 Gen1 离线 OID 点读笔——两套同版 PCBA/OID 工程样品预询证

```text
您好，我们正在开发面向 3–6 岁家庭的无屏离线点读笔，首轮希望购买 2 套完整、
同版的一体主板 + OID 光头工程样品。当前只做付款前技术询证，请按下列项目书面回复：

M01 OID 读码与许可校验能否完全离线，不依赖云端心跳？
M02 能否提供 2 套完全相同的 BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV /
    FW_VERSION，并随附至少 24 码码卡和空白负样？
M03 能否书面说明码制、可分配码段、保留段与冲突管理？
M04 能否提供原创书页/贴纸的离线码生成工具或稳定代生成服务？
M05 能否提供 DPI、网点、颜色/分色、RIP、纸张、覆膜、工作距和角度要求？
M06 能否提供板/头电气与机械资料、功耗、事件/日志、版本化 SDK/C 示例、
    build/flash/log 工具和命令？
M07 请分列两套样品、后续 100/1,000 台的一次性费用、单价、版税、MOQ、交期。
M08 量产供货与固件授权是否独立于第三方商业点读内容库？

请同时提供十项附件：
1) 完整身份五元组；2) 两套待发样品正反面/标签/serial 原图；
3) 板与光头 2D 图、连接器和工作距；4) MCU/BSP/RTOS/SDK/C compiler/linker 版本；
5) build/flash/log 命令、软件包版本和 SHA-256；6) OID 事件 API/帧协议、错误码、
sequence/drop/时间戳定义；7) 离线码工具、24 码、空白区、码段和授权；
8) 印刷 profile 与两个独立打样批次安排；9) 音频/存储/USB/供电/离线能力表；
10) 当前同 revision 可供数量、同版承诺、PCN/EOL 与替代规则。

若使用松翰 OID，请注明具体 Decoder 与 Sensor Module 完整 MPN。我们已从原厂当前
资料核对 SN95310/SN95350/SN95360、SNM9S5X30BC2100A 家族及
SNM9S5430BC2100A/SNM9S5630BC2100A；这些仅用于核对，不预设贵司方案。
若使用“95500/SN95500/三代/四代”等简称，请补充当前完整 MPN 和比较/替代关系。

收到相互一致的书面资料后，我们再确认两套样品付款；不接受随机 revision 或
仅写“功能相同”的替代发货。谢谢。
```

## 4. 回件归档与判定

每家供应方单独使用一个 candidate；不同 revision 不合并：

```text
build/vendor-evidence/<candidate>/<received-at>/raw/       # 原始邮件、图片、PDF、压缩包
build/vendor-evidence/<candidate>/<received-at>/hashes.csv # 文件名、字节数、SHA-256
```

实际发送时优先复制生成包中的 candidate-specific `.email.txt`，避免人工转录时让两家 PCBA
候选的问题集合漂移。`SONIX-OID-COMPONENT` 使用独立原厂交叉核对正文，不与完整 PCBA 付款门混合。

发送前为每条消息运行 `prepare:vendor-contact-receipt`，把当时的完整 bundle 归档到独立 receipt
工作区。发送当日保存官方入口原件，发送后保存 `.eml` 或网页确认原件，再从
[`vendor-contact-receipts-v1/receipt.template.json`](../../hardware/evt0/vendor-contact-receipts-v1/receipt.template.json)
建立记录并运行 `npm run validate:vendor-contact-receipts`。通过后状态只到
`AWAITING_RESPONSE`，`targetBindingEffect/paymentEffect` 仍为 `NONE`。

收到回件后从
[`vendor-evidence-v1/candidate.template.json`](../../hardware/evt0/vendor-evidence-v1/candidate.template.json)
复制一份独立记录，逐项填写 `M01–M08`、`A01–A10`、五元组及两件待发样品身份；运行
`npm run validate:vendor-evidence`。该记录即使达到 `READY_TO_BUY`，其
`targetBindingEffect` 仍固定为 `NONE_VENDOR_CLAIM_ONLY`，到货后继续进入 `intake-v1`。

`build/` 默认不进入版本库。只有可公开、可复算的来源元数据写入
[`evidence-sources.json`](../../hardware/evt0/evidence-sources.json)；收到真实样品后再从
[`board-oid-kit.template.json`](../../hardware/evt0/intake-v1/board-oid-kit.template.json)
建立正式 intake。口头或即时消息答复需回收为邮件、规格书或带来源时间的原文件。

## 5. 付款门

以下全部成立才把对应 candidate 从 `REFERENCE_ONLY/EVIDENCE_REQUIRED` 推进到待购：

- `M01-M08` 均有书面回答；
- 十项附件相互一致，文件版本与哈希可复核；
- 两套待发样品身份五元组、标签和 revision 完全一致；
- SDK、C reference、build/flash/log、码工具与印刷资料具备可复现入口；
- 离线许可、同版供货、PCN/EOL 和替代规则有书面边界；
- 任一简称都已映射到准确 MPN/revision。

回件缺项时只回填对应 gap，不填推测值。两家都未通过时保留淘汰证据，再扩充第三家
完整 PCBA 候选；这仍不自动触发自研 PCB 分支。

## 6. 等待窗口

询证发出并进入外部等待后，重新比较双线收益。硬件线程保持自己的写入范围，同时在每个包开始和收口时
只读检查软件 active anchor 与18条接口的变化；软件线程独立推进稳定合同、纯内核、用例端口和 adapter。
若外部等待超过反馈窗口，按
`docs/research/next-work-package-ranking-2026-08-04.md` 的同一权重盘点实际LAB1–LAB6或推进
benchmark精确SKU/intake；实验室方法基线、供应商回件合同、BOM revision与逐样品身份门已经可复用。
任一供应商回件、实物到货、测量记录、软件接口或 EDA 状态变化后立即同步并重排。
