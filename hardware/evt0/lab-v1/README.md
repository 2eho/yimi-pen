# EVT-0 Lab Baseline v1

这套台架定义把“到货即测”变成可重复的硬件能力，而不是一次性的手工清单。
它只负责仪器、方法、原始数据和判定边界；不替主板/OID 证据回答未知型号，也不把竞品观察
升级成 `BOARD_TARGET`。

## 文件

- `method-catalog.json`：可复用的测量方法目录；每个方法都有状态、仪器、步骤、记录项、
  通过线和来源引用。
- `instrument-registry.schema.json`：真实仪器登记的严格 Schema；六个稳定槽位可包含一个或多个
  物理资产，其中 `MECH-01` 明确需要卡尺和秤两件资产。
- `instrument-registry.template.json`：仪器的制造商、精确型号、序列号、铭牌原图与校准/自检
  原件登记模板；复制到 `records/<registry-id>.json` 后才成为候选记录。
- `registration-capture-plan.json`：六个稳定槽位、七类必需实物及每类身份/资格原件的单一采集计划；
  准备脚本和校验器共同读取，避免清单与资产映射漂移。
- `records/`：真实仪器登记；只有六个槽位及其必需资产全部通过身份和校准证据门，registry
  才可标为 `QUALIFIED`。
- `session.template.json`：一次测量会话的环境、目标身份、方法结果和原始文件索引模板。

## 证据分层

| readiness | 用途 | 允许的结论 |
|---|---|---|
| `READY_NOW` | 设备到货前或竞品到货后即可执行 | 记录观察/测量；不能据此冻结目标板号 |
| `WAIT_BOARD_LOCK` | 需要 `BOARD_TARGET`、`OID_TARGET_HEAD` 或精确接口 | 只建立方法和空记录，不填写推测值 |
| `RELEASE_GATE` | 目标样机组装后的质量门 | 只有原始数据、仪器身份和方法版本齐全时才计算 PASS |

任何测量记录必须同时带：

1. `methodId` 与方法版本；
2. 仪器登记 ID、精确型号、序列号和校准/自检证据；
3. 环境与连接状态；
4. 原始文件相对路径和 SHA-256；
5. 原始值、单位、计算过程和判定结果。

缺任一项保持 `PENDING`，不补写估计值。`PASS` 只表示该方法的通过线已被原始数据复算，
不等于目标产品或量产资格已经成立。

## 推荐执行顺序

### A. 现在可做

1. 用模板登记 LAB1–LAB6；已有同规格仪器只登记实际型号，不重复采购。
   可先运行 `npm run discover:hardware-lab` 生成
   `build/hardware-lab-discovery.json`。该报告只列 Windows 当前可见的 PnP/串口线索，
   `qualificationEffect` 固定为 `NONE_DISCOVERY_ONLY`；内置摄像头、端口名或 USB VID/PID
   都不等同于宏观相机、测量精度或校准证据。
   推荐直接生成一个保持 `PENDING` 的采集工作区：

   ```powershell
   npm run prepare:hardware-lab-registry -- `
     --registry-id EVT0-LAB-REGISTRY-20260804-01
   ```

   工作区位于 `build/hardware-lab/instruments/<registry-id>/`，包含六槽位/七资产 draft、输入文件
   SHA-256 manifest、逐资产清单和空 `raw/`；准备动作的资格、付款、target-binding 和发布效果均为 `NONE`。
2. 运行台架自检：限流电源、万用表、卡尺/秤、微距、USB-C 功率计、声级计。
3. 对 `REF1–REF3` 竞品执行尺寸/重量、外观/丝印、USB 功耗、声学相对基线和点读观察。
4. 原始照片、CSV、日志和仪器报告放到 `build/hardware-lab/<sessionId>/raw/`，计算哈希后再填写 session。

### B. `BOARD_TARGET` 冻结后

复用同一方法 ID，对两套同版主板/OID 套件执行：限流上电、24 码逐码事件、离线 `100/100`、
首音 P50/P95/P99、充电/NTC、续航、温升、声压和异常恢复。目标阈值只取
[`docs/hardware-gen1-p0.md`](../../../docs/hardware-gen1-p0.md) 的完成门与供应方书面资料。

## 已有产品门的引用

- 首音：P50 `<150ms`、P95 `<200ms`、P99 `<300ms`；
- 离线：断开无线和电脑后 `100/100` 正确播放；
- 声压：`<=85dBA @ 50cm`；
- 续航：混合点读工况 `>=6h`；
- 温升：25C 环境连续播放/充电各 1h，触表面 `<45C`；
- 光学和印刷矩阵：使用真实 OID、供应方工作距/角度窗口和两批印刷样，不用二维码或视觉大码替代。

这些是目标样机完成门，不是当前尚未到货样品的预先通过结论。

## 校验

```powershell
npm run validate:hardware-lab
```

校验器检查目录、字段、唯一 ID、方法/仪器引用、模板边界，以及真实 registry 的身份、校准、
artifact 路径/字节数/SHA-256 和资格状态；它不会伪造物理测量，也不会改变 `BOARD_TARGET`。

真实 registry 还会复算 `build/hardware-lab/instruments/<registry-id>/raw/` 下铭牌与
校准/自检原件的字节数和 SHA-256。制造商序列号缺失时只接受拍照留证的唯一
`LOCAL_ASSET_TAG`，并用 `serialSource` 与制造商序列号区分。`TRACEABLE_SELF_CHECK` 的身份原件、
自检结果和参考标准原件必须分开，并分别闭合 artifact 引用。

PnP 名称直接晋级、`MECH-01` 缺卡尺或秤、资产错槽、跨 registry 路径、原始文件缺失、
重复 registry/serial、过期校准或缺参考标准都有负向校验向量。当前没有真实 registry 时，报告明确显示
`records: 0 / qualified: 0`；准备脚本自检也证明重复 workspace 拒绝且不会自动建立 record。
