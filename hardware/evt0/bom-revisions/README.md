# BOM Revision v1

`bom-lock.csv` 是行级物料与阻塞证据的事实源；本目录为每个发布候选增加 revision、目标绑定、
证据入口、审批和release receipt链接。这样更换板卡或器件时只新增revision，不复制整套架构文档。

## 当前状态

- `BOM-REV-A.pending.json` 是待冻结基线；
- `activeBranch=UNRESOLVED`；
- 五元组全部为 `null`；
- 0个release receipt；
- 它不是已发布BOM，也不会解除任何EDA门。

## 分支规则

`bom-lock.csv` 的 `applicability` 只有三种值：

- `ALL`：一体主板与自研板都需要；
- `INTEGRATED_MAINBOARD`：只进入当前量产一体主板路线；
- `CUSTOM_BOARD`：只在一体主板路线经证据失格后进入自研板路线。

发布时，`ALL` 与当前 `activeBranch` 的行都必须为 `LOCKED`。另一分支的候选/阻塞行不进入
当前发布BOM，也不会被误当成替料。

## 发布门

`state=RELEASED` 同时要求：

1. `activeBranch` 已选择；
2. `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION` 五元组完整；
3. target binding 当前为 `FROZEN`，且SHA-256与manifest一致；
4. 行级CSV哈希与行数一致；
5. 适用行全部 `LOCKED`；
6. 至少一个物理/生产release receipt；
7. 审批状态、人员和时间完整。

供应商 `READY_TO_BUY` 只进入付款；实物 `ACCEPTED_BOARD_TARGET` 才能推动目标绑定和BOM发布。

## 校验

```powershell
npm run validate:bom-revision
```

报告写入 `build/bom-revision-validation.json`。
