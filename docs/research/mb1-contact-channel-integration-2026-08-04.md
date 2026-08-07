# MB1 官方联系入口复核与外发集成（2026-08-04）

> 工作包：`HW-MB1-CONTACT-CHANNEL-VERIFY-01`
> 获取窗口：2026-08-04 04:46–05:12（主机时区 `+08:00`）
> 判定边界：本文件核验当前官方入口和客户端提交合同，没有发送消息、建立供应商回件或产生付款/目标绑定事实。

## 1. 当前结论

| 候选 | 官方入口 | 本轮原始证据 | 当前人工发送路径 | 状态 |
|---|---|---|---|---|
| `REF-ZTRON-LOCAL` | [Ztron Contact](https://www.ztrontech.com/contact/) | HTTP 200；34,263 bytes；SHA-256 `559E95C10F3E882AD77F13A5A333A6D3FA49718110CC1AAF06FC4595D956818A` | 页面把 `market3@ztrontech.com` 暴露为 `mailto:`，同时列出 `market2@ztrontech.com`；以前者为首选、后者为备选，发送当日复核 | `VERIFIED_ENTRY / NOT_SENT` |
| `REF-CHUNMIAO-LOCAL` | [春苗点读笔方案页](https://www.szdianjiao.com/articles/readpen.html) | HTTP 200；8,635 bytes；SHA-256 `5020EC8D66A122651F3FF3CB0674C0AAD311D7AB6AA4BBFB29DFDC787C84013F`；Last-Modified `2025-08-15T10:53:30Z` | 官方方案页公开 `190530584@qq.com`；发送当日复核 | `VERIFIED_ENTRY / NOT_SENT` |
| `SONIX-OID-COMPONENT` | [Sonix FAE 技术联系](https://www.sonix.com.tw/page/FAE) | 页面：HTTP 200，713,604 bytes，SHA-256 `97D08ED991F8C92233E9887C77544A7F42EEA8307D4F116A5BB61061091C5777`；官方 `fae.js`：104,014 bytes，SHA-256 `06C2DE68D7933876F4E7D15B9C1951B94BDE113FFE830AC747EBAFDD114FDAAC` | 当前客户端合同先检查会员 token，表单含联系 Email 与产品线字段，并向官方 FAE API 提交；登录后选择 OID 类别并人工提交 | `VERIFIED_ENTRY / LOGIN_REQUIRED / NOT_SENT` |

三条路径均只解决“从哪里提交”。`BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION`、两套同版样品、报价、许可与供应状态仍须供应商原始回件和实物 intake。

## 2. 一手资料边界

### Ztron

同一官方域名的 [OID 产品方案页](https://www.ztrontech.com/solutions/1.html) 已由
`SRC-OID-001` 持有产品架构参考；本轮新增 Contact 页只证明官方联系路径。产品页与联系页同时出现
`market3@ztrontech.com`，联系页另列 `market2@ztrontech.com`，因此外发模板调整的是联系人优先顺序，M01–M08 与 A01–A10 未变化。

### 春苗

现有 `SRC-OID-011` 的官方方案页本身同时包含方案声明与邮箱，原始字节/hash 本轮复算一致。它仍属于供应商页面声明；精确 PCBA/头、离线授权、工具版本和同版供货只由书面回件与两件实物证明。

### Sonix

官方 FAE 页面可见说明要求填写技术支持表格，并说明问题将以邮件回复。页面加载的官方
`/webapi/fl001005/fae.js` 明确给出：

- 表单类别 `FAE_TYPE_ID=2`；
- `Contact Email` 与产品线选择字段；
- 初始化时检查会员 token；
- 表单提交到官方 `/webapi/api/Vote/SubmitVoteFront`；
- 技术记录和邮件回复属于 FAE 路径。

这些事实只用于选择原厂交叉核对入口，不把客户端脚本写成已提交、已受理或具体料号可供货证据。
连续复算中该脚本的 `104,014` bytes 与 SHA-256 保持一致，但服务器 `Last-Modified` 随抓取时刻变化；
因此台账把版本标为 `UNPUBLISHED_SCRIPT_VERSION; CONTENT_HASH_LOCK`，该 header 只作响应观察，不作版本身份。

## 3. 机器台账与外发包变化

新增三个 O 级来源：

- `SRC-MB1-CONTACT-ZTRON-001`
- `SRC-MB1-CONTACT-SONIX-PAGE-001`
- `SRC-MB1-CONTACT-SONIX-SCRIPT-001`

原始页面快照位于忽略提交的 `build/contact-source-snapshots/`；URL、时间窗、版本、bytes 与 SHA-256 由
`hardware/evt0/evidence-sources.json` 持有。

外发模板只更新：

1. Ztron 首选/备选邮箱顺序与 contact sourceRef；
2. Sonix 登录后 FAE 表单说明与两个 contact sourceRef。

重新构建后的外发包仍为 `PREPARED_NOT_SENT`，当前 ID：

```text
sha256:3ef0820cdc323d0a1cf8dfb80ea918a6c707924025f95c78f17998d19f777d7d
```

## 4. 验证与下一动作

```powershell
npm run refresh:vendor-contact-sources
npm run validate:vendor-outbound
npm run validate:vendor-contact-receipts
npm run validate:vendor-evidence
npm run validate:product-baseline
```

本轮结果：联系来源 4/4，source-set SHA-256
`7344e7c51d13742981b1d46e9443ab414b6d3a7d8d1223f29330de49fe7baf43`；外发 3 templates + 4/4 负向门；Contact Receipt 16/16 + 文件闭包自检 3/3；Vendor Evidence 18/18；产品基线 231/231。真实 send receipts、supplier responses、READY_TO_BUY 和 accepted target 均为 0。

下一动作仍由人员通过上述入口提交对应归档邮件，并使用 Contact Receipt v1 保存官方入口与提交原件。Sonix 路径需要人员登录官方会员账号；涉及账号和实际外部提交时在浏览器中由人员完成最终动作。
