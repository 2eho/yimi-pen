# HW-LAB-INSTRUMENT-REGISTRATION-V1（2026-08-04）

## 结论

本工作包把已有 `EVT-0 Lab Baseline v1` 从“六个空槽位”推进为可验证的真实仪器登记合同，
但当前机器没有产生任何合格仪器事实：

- registry records：`0`；
- qualified registries：`0`；
- `LAB1–LAB6`：全部 `PENDING`；
- 对 `BOARD_TARGET` 的影响：`NONE_UNTIL_ALL_REQUIRED_QUALIFIED`。

## 稳定复用边界

以下已通过资产保持不变：9 个测试方法、六个逻辑仪器槽位、方法引用、产品阈值、会话原始数据
格式。新增变化只收敛在 `hardware/evt0/lab-v1/instrument-registry.schema.json`：

```text
稳定方法 ID
  -> 六个稳定仪器槽位
  -> 每槽一个或多个可追溯物理资产
  -> 铭牌/serial 原图
  -> 校准证书或可追溯自检
  -> 原件 bytes + SHA-256
  -> QUALIFIED registry
  -> 测量 session 引用
```

`MECH-01` 保持一个公共方法槽位，但必须同时登记 `CALIPER` 和 `SCALE` 两件物理资产，避免把
“卡尺/秤”压成一个虚构型号或 serial。

## 当前机器发现证据

执行：

```powershell
pwsh -NoProfile -File scripts/discover-hardware-lab.ps1
```

原始报告写入忽略提交的 `build/hardware-lab-discovery.json`。本次仅发现 Windows 当前可见的
6 条 PnP 候选和 1 个串口：内置前/后摄像头、系统音频端点/驱动和 `COM1`。它们全部标为
`UNQUALIFIED_*_DISCOVERY_ONLY`。

本次快照时间为 `2026-08-03T19:59:45.2950972Z`，文件为 2,686 bytes，SHA-256 为
`0301e31c8f688780d14828dec9a0e07599bf5759157f6079f07bfef052f37ef5`。以后再次盘点会生成
新的时间和哈希，不能用这次快照替代届时的物理铭牌检查。

这份 PnP 快照只证明“操作系统当时列出了这些设备”；它没有提供限流电源、真有效值万用表、
卡尺、秤、微距能力、USB-C 功率测量或 A 计权声级测量所需的制造商/完整型号/serial/精度/
校准证据。未枚举也不证明物理仪器不存在，因此下一步仍需人工盘点实物铭牌。

## 证据门

真实 registry 只有同时满足以下条件才进入 `QUALIFIED`：

1. 六个稳定槽位齐全，且 `MECH-01` 同时包含卡尺和秤；
2. 每件资产都有制造商、完整型号、唯一 serial；制造商没有序列号时使用拍照留证的唯一
   `LOCAL_ASSET_TAG`，并由 `serialSource` 明确区分；
3. 铭牌/serial 原图带 bytes、SHA-256 和 media type；
4. 校准证书或可追溯自检为 `PASS`，带日期、方法和原始 artifact；可追溯自检分别引用结果与参考标准原件；
5. 所有 artifact 实际存在于登记路径，字节数与 SHA-256 可复算；
6. registry 有记录时间、operator，且 blocker 为空。

PnP 名称直接晋级、缺卡尺或秤、资产放入错误槽位、缺原始文件、重复 serial、过期校准都由
负向向量拒绝。发现报告不会修改仪器 registry、BOM revision、target-binding 或任何板卡字段。

## 用户最小动作

同日续包 `HW-LAB-REGISTRATION-CAPTURE-V1` 已建立六槽位/七资产单一采集计划和一个 pending-only
真实工作区。最新 PnP 刷新仍只得到音频端点/驱动和 COM1 共 4 条候选，报告 2,153 bytes、SHA-256
`c62721b37d0e081010fcf38f1487ed45d6e7e88e93586711c4620fbe1b1606b5`，资格效果仍为 `NONE_DISCOVERY_ONLY`。

逐项按以下清单拍摄 `LAB1–LAB6` 实物铭牌/serial 或本地资产标签，并提供校准证书；没有证书的仪器
按原厂说明与可追溯参考完成自检，分别保留身份、自检结果和参考标准原件：

```text
D:\work\yimi-pen\build\hardware-lab\instruments\EVT0-LAB-REGISTRY-20260804-01\CAPTURE-CHECKLIST.md
```

填写完成的 `registry.draft.json` 再复制到同 ID 的 `records/` 文件并运行
`npm run validate:hardware-lab`。当前校验为 178 checks，准备层自检 3/3；records/qualified 仍为 0。
缺少的槽位在盘点后才进入精确采购，不提前猜型号。
