# Hardware evidence capture adapter v1

本包只关闭一个重复劳动缺口：供应商发送回执、成熟产品卖家原件、实验室仪器原件和供应商书面回件都需要重复填写文件路径、字节数、SHA-256 与媒体类型。采集适配器把这部分统一成一次事务化复制和不可变索引。

## 边界

- 原始 source 文件只读，要求普通文件，拒绝符号链接和 Windows reparse point。
- `sourcePath` 必须是相对 capture request 的已归一化仓库内路径；不接受绝对路径、空/点段、路径别名或越过仓库根的路径。
- 每个 destination 只能是已存在 owner draft 对应工作区的单层 `raw/` 文件。
- `mediaType`、采集时间、来源 URL、证据种类和路由全部由请求显式提供；工具不依据扩展名、文件内容或目录名猜测。
- 先复算 owner draft 的 bytes/SHA-256，再复制并回读 destination；写入完成后再次复算 owner draft，要求逐字节一致。
- 任一文件失败时，仅清理本 capture 新建且 SHA-256 仍匹配的 destination；既有原件和 owner record 保持原状。
- 输出 `capture-index.<CAPTURE_ID>.json`，其中 `ownerFragment` 只是一段可审查的 artifact 描述。各 owner record 仍需人员明确引用，并由原 validator 判断发送、回件、资格或购买状态。

该包不会产生以下事实：

- Message-ID、网页确认号、FAE 工单或已发送状态；
- 卖家对 G4、446637、32GB、包装、背标、版本页或同一待发物的确认；
- 仪器型号、序列号、校准合格或测量结果；
- `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION`；
- `READY_TO_BUY`、`QUALIFIED`、`BOARD_TARGET`、BOM release 或 ReleaseGate 提升。

## 支持的 lane

| lane | owner draft | 原件根 | 路由元数据 |
|---|---|---|---|
| `VENDOR_CONTACT` | `receipt.draft.json` | `build/vendor-contact-receipts/<receiptId>/raw/` | 官方入口、提交导出或其他支持原件 |
| `BENCHMARK_SELLER` | `record.draft.json` | `build/benchmark-seller-evidence/<recordId>/raw/` | owner schema 的 kind、provenance、capturedAt、sourceUrl |
| `LAB_REGISTRY` | `registry.draft.json` | `build/hardware-lab/instruments/<registryId>/raw/` | instrument、asset 与 identity/calibration/reference 角色 |
| `VENDOR_RESPONSE` | `response.draft.json` | `build/vendor-evidence/<candidate>/<responseId>/raw/` | tuple、M01–M08、A01–A10、sample offer 或支持原件引用提示 |

## 命令

工作区只读预检：

```powershell
node scripts/capture-hardware-evidence.mjs preflight `
  --lane VENDOR_CONTACT `
  --workspace build/vendor-contact-receipts/20260804-ZTRON-01
```

也可以通过 npm script 传参：

```powershell
npm run preflight:hardware-evidence -- --lane VENDOR_CONTACT --workspace build/vendor-contact-receipts/20260804-ZTRON-01
```

把 `capture-request.<CAPTURE_ID>.json` 放在目标工作区，然后执行：

```powershell
node scripts/capture-hardware-evidence.mjs capture `
  --request build/vendor-contact-receipts/20260804-ZTRON-01/capture-request.ZTRON-SEND-01.json
```

等价的 npm 命令是 `npm run capture:hardware-evidence -- --request <request-path>`；复核使用
`npm run check:hardware-evidence -- --request <request-path>`。

后续复核：

```powershell
node scripts/capture-hardware-evidence.mjs check `
  --request build/vendor-contact-receipts/20260804-ZTRON-01/capture-request.ZTRON-SEND-01.json
```

仓库级回归：

```powershell
npm run validate:hardware-evidence-capture
```
