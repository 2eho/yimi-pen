# EVT-0 实验室仪器登记采集包 v1

> 工作包：`HW-LAB-REGISTRATION-CAPTURE-V1`
> 日期：2026-08-04
> 当前物理事实：registry records `0`，qualified registries `0`；本包只缩短人工盘点到可验证记录的路径。

## 1. 为什么现在做

MB1 实际外发和供应商回件仍需要人员完成，86 分 benchmark 采购包也被卖家原图门锁定。当前能独立推进且
直接缩短实物闭环的是 LAB1–LAB6 登记：主板或竞品到货后，尺寸、功耗、声学、光学和限流上电结果都必须
引用已登记仪器。此前 Schema 和校验门已经存在，但人工还要从空模板自行建立七件资产、目录和哈希清单。

本包把这段重复工作收敛成：

```text
稳定六槽位/七资产 capture plan
  -> PnP 线索刷新（只作信息）
  -> pending-only 独占工作区
  -> 身份 / 自检结果 / 参考标准三类原件
  -> registry record
  -> Lab v1 统一资格校验
```

## 2. 证据输入

| 输入 | 当前身份 | 用途与边界 |
|---|---|---|
| `hardware/evt0/purchase-plan.csv#LAB1-LAB6` | 项目受控采购/验收账本 | 决定六槽位、七资产和各自来料门，不填实际型号 |
| `hardware/evt0/lab-v1/method-catalog.json#LAB-SETUP-001` | 9 个稳定方法目录 | 决定仪器身份、方法、原始文件和自检要求 |
| `build/hardware-lab-discovery.json` | 2,153 bytes；SHA-256 `c62721b37d0e081010fcf38f1487ed45d6e7e88e93586711c4620fbe1b1606b5` | 仅发现音频端点和 COM1；资格效果 `NONE_DISCOVERY_ONLY` |
| `registration-capture-plan.json` | 3,645 bytes；SHA-256 `6358840bf2bfb8280e6a7df593b9c2c83617c6e9593ce659cff3211f7bbb05de` | 准备脚本与校验器共用的六槽位/七资产单一事实源 |

当前没有新增铭牌照片、制造商型号、序列号、校准证书、参考标准或自检原始值，因此没有产生任何
`QUALIFIED` 结论。

## 3. 新增复用能力

### 单一采集计划

`registration-capture-plan.json` 固定：

- `PSU-01 / LAB1 / BENCH_SUPPLY`；
- `DMM-01 / LAB2 / MULTIMETER`；
- `MECH-01 / LAB3 / CALIPER + SCALE`；
- `MACRO-01 / LAB4 / MACRO_CAMERA`；
- `USBPWR-01 / LAB5 / USB_C_POWER_METER`；
- `SPL-01 / LAB6 / SOUND_LEVEL_METER`。

新增仪器或替换型号时只增加/更新真实 asset record；方法 ID、槽位、原始文件格式和测量会话继续复用。

### 可追溯身份与自检

- `serialSource` 区分 `MANUFACTURER_SERIAL` 与拍照留证的 `LOCAL_ASSET_TAG`；
- `TRACEABLE_SELF_CHECK` 必须同时引用自检结果和参考标准原件；
- 身份原件、自检结果、参考标准使用不同 artifact；
- registry 文件名必须等于 `registryId.json`，ID 全局唯一；
- Windows 反斜杠路径也会规范化后检查，原件只能位于本 registry 的 `raw/`。

这些变化只增强 Lab v1 的证据入口，不改变现有测量阈值、HardwareSystem、target-binding、BOM 或 EDA。

## 4. 已准备的真实工作区

```text
build/hardware-lab/instruments/EVT0-LAB-REGISTRY-20260804-01/
  CAPTURE-CHECKLIST.md
  registry.draft.json
  source-manifest.json
  raw/
```

当前 draft 是 Schema 合法的 `PENDING` 记录，预置 6 槽位和 7 个资产占位；全部实际身份和原件为空。
`source-manifest.json` 为 1,864 bytes，SHA-256
`511047a17c398ac487bec59a4b81b57bfd69258a0a16a609edd959815ac06468`，闭合生成时使用的 Schema、模板、
采集计划、方法目录、采购账本和 PnP 报告。

重复准备同一 registry ID 会停止；准备流程不会向 `records/` 写入记录，也不会改变资格状态。

## 5. 使用方法

新建后续批次：

```powershell
npm run prepare:hardware-lab-registry -- `
  --registry-id EVT0-LAB-REGISTRY-<UNIQUE-ID>
```

本轮直接从以下清单开始人工盘点：

```text
D:\work\yimi-pen\build\hardware-lab\instruments\EVT0-LAB-REGISTRY-20260804-01\CAPTURE-CHECKLIST.md
```

实际原件齐全后，把填写完成的 draft 复制到：

```text
D:\work\yimi-pen\hardware\evt0\lab-v1\records\EVT0-LAB-REGISTRY-20260804-01.json
```

然后运行 `npm run validate:hardware-lab`。缺少某一资产时保留对应 blocker，再按 `purchase-plan.csv` 的
`READY_TO_BUY_IF_MISSING` 路径采购；不从空模板推导品牌或型号。

## 6. 当前边界

- `BOARD_TARGET=UNRESOLVED`；
- registry/qualified 均为 0；
- PnP 线索不产生仪器资格；
- 目标板供电、OID、存储、声学和结构测量尚未开始；
- 量程、精度、带宽和校准状态只从真实铭牌、原厂资料、证书与可复算自检进入记录。

## 7. 机器验证

```powershell
npm run validate:hardware-lab
npm run test:hardware-lab-registry-prep
```

当前结果：Lab v1 `178` 项检查通过，9 methods / 6 slots / records 0 / qualified 0；准备层自检
`3/3`，覆盖 Schema 合法的 pending-only 6/7 工作区、输入 hash 闭包、重复 ID 拒绝及零 record 晋级。
