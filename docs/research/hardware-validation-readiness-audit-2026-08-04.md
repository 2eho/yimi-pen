# 硬件验证与 EDA 就绪审计（2026-08-04）

## 结论

当前硬件基础设施已经具备**结构化接收证据**的能力，但还没有目标主板/OID实物证据：

- `BOARD_TARGET=UNRESOLVED`；
- 18/18 个接口绑定仍为 `TARGET_EVIDENCE_PENDING`；
- 实物 intake 记录为 `0`；
- 实验室方法目录与模板通过结构校验，但 LAB1–LAB6 的实际型号、序列号和校准记录尚未登记；
- 嘉立创EDA本地只读桥接已连接，芯片级EDA仍受目标证据门约束；
- MCP运行态存在10个进程/10个回退端口，`singleton=false`。49620上的连接可证明本地桥接存活，不能证明目标板卡身份或设计正确性。

因此当前允许推进供应商询证、精确SKU采购准备、仪器登记和实物到货模板；芯片选择、引脚、
电源数值、连接器和PCB布局继续保持锁定。

## 当前运行证据

审计时间：2026-08-04 03:13（Asia/Tokyo环境；工具报告使用本机偏移）。

| 命令 | 结果 | 可以证明 | 仍未证明 |
|---|---|---|---|
| `npm run validate:hardware-system` | 402/402，拓扑 SHA-256 `98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f` | 稳定12块/18接口、target-binding结构一致 | 精确板号、器件、接口电平和实物适配 |
| `npm run validate:evt0-intake` | 207/207，physical records `0` | 竞品与两套同版kit的模板可用 | 任一真实样品通过 |
| `npm run validate:hardware-lab` | 9 methods、6 instruments、132 checks | 方法/仪器引用与模板边界一致 | 仪器已具备、校准有效、产生真实测量 |
| `npm run test:hardware` | 1/1 loopback | host侧pySerial测试环境可运行 | 目标板串口、OID事件、时序和HIL |
| `npm run eda:doctor` | 全部PASS；49620、loopback only、2 endpoints | JLCEDA Pro、Node24、MCP 0.35.4与只读桥接可用 | EDA工程内容、目标板绑定和制造正确性 |
| `npm run eda:singleton` | 10 processes、10 listeners、`singleton=false`；仅49620 connected | 端口分流问题可复算 | Codex live MCP单例已收口 |
| `npm run validate:books` | 2 books通过 | 文档改动未破坏现有书籍fixture | 任何物理OID兼容性 |
| `git diff --check` | exit 0 | 当前diff无空白错误 | 完整产品验收 |

生成报告：

- `build/hardware-system-validation.json`
- `build/evt0-intake-validation.json`
- `build/hardware-lab-validation.json`
- `build/jlceda-bridge-status.json`
- `build/jlceda-mcp-singleton.json`

`build/` 中的运行报告是本机证据，不提升供应商网页或模板的证据等级。

## 稳定架构复用状态

当前已复用而无需随板卡重建的资产：

1. `hardware-system-v1/topology.json`：稳定功能块和接口身份；
2. `hardware-system-v1/target-binding.json`：把板卡差异收敛到目标绑定；
3. `intake-v1/`：竞品与两套同版kit共用证据字段；
4. `lab-v1/`：仪器、方法和会话格式；
5. `purchase-plan.csv` 与 `bom-lock.csv`：采购门和revision门；
6. `test-result-v1/`：结果、原始采样和工具身份边界。

后续主板、OID头、电池、扬声器和外壳的变化应新增候选/target-binding/BOM revision及对应
evidence receipt，而不是复制一套平行测试方法。

## 当前开放门

| 门 | 状态 | 关闭它所需的直接证据 |
|---|---|---|
| `RG-BOARD-TARGET-FROZEN` | OPEN | 两套完全一致的 `BOARD_MPN / PCB_REV / HEAD_MPN / HEAD_REV / FW_VERSION`，供应商原件与实物一致 |
| `RG-BOARD-SUPPLY-VERIFIED` | OPEN | 当前同revision库存、PCN/EOL、替代规则和后续供货书面证据 |
| `RG-OID-CODE-TOOL-FROZEN` | OPEN | 离线码工具/稳定代生成、版本、hash、码段和印刷profile |
| `RG-OID-TWO-HEAD-TWO-PRINT-MATRIX-PASSED` | OPEN | 两只同版头、两个独立印刷批次和原始读码矩阵 |
| `RG-TARGET-AUDIO-PROFILE-VERIFIED` | OPEN | 精确扬声器/功放/声腔、固定50cm测量与原始声学数据 |
| `RG-TARGET-FORM-RELIABILITY-PASSED` | OPEN | 目标电池/外壳/装配后的温升、充电、跌落、耐久和复测 |

## 下一动作约束

- 外部最高收益：发送 `gen1-mb1-prepay-pack.md` 并按书面回件建立候选证据；
- 实物最高收益：购买精确SKU竞品并建立 intake；
- 本地准备：登记实际LAB1–LAB6，收到回件后用单一供应商证据格式入库；
- EDA单例修复只在下一工作包依赖live工程读取时前置，修复时需保护其他Codex会话；
- `BOARD_TARGET` 证据门通过前，只保留层级、块图和接口标签，不进入芯片级设计。

## 集成后补充

审计发现随后已转化为机器门：HardwareSystem增至425/425并覆盖全部board-kit
observation/test影响归属；intake增至216/216并要求每件样品独立五元组、唯一serial和带
bytes/SHA-256的artifact manifest；新增Vendor Evidence v1 18/18与BOM Revision v1 86/86。
这些结果仍保持response records、physical records、released BOM与accepted target均为0。
