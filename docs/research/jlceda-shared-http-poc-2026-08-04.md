# 嘉立创EDA共享 HTTP POC v1（2026-08-04）

> 工作包：`HW-EDA-SHARED-HTTP-POC`
> 结论：隔离端口上的单进程、双逻辑 MCP session、session 隔离、stop/restart 与保护态回归已闭合；真实 JLCEDA/Codex URL 迁移继续等待受控维护窗口。

## 1. 为什么现在执行

真实 MB1 外发、REF2 卖家原件和实验室实物登记仍是更高收益路径，但都需要人员或外部回件。当前 stdio
模式同时存在多个 package 进程和 `49620–49629` listener；下一次并行 live EDA 读取前，需要先把“共享 HTTP
在本机是否真的支持多 session、关闭隔离和重启”从源码推断提升为运行证据。

本包没有用工具工作替代产品实物闭环：`BOARD_TARGET`、两套同版样品、OID 光头、BOM release 与芯片级
EDA 仍受原证据门约束。

## 2. 证据来源

### 2.1 固定上游与本机安装

- 上游固定 tag：`easyeda-mcp-pro-v0.35.4`，commit
  `69892876b5cf2ddcc1de1b590c0ce35c61a36698`；审计使用固定 tag 的
  [HTTP transport](https://github.com/oaslananka/easyeda-mcp-pro/blob/easyeda-mcp-pro-v0.35.4/src/server/transports/http.ts)、
  [server factory](https://github.com/oaslananka/easyeda-mcp-pro/blob/easyeda-mcp-pro-v0.35.4/src/server/factory.ts) 与
  [bridge manager](https://github.com/oaslananka/easyeda-mcp-pro/blob/easyeda-mcp-pro-v0.35.4/src/bridge/manager.ts)。
- 本机 Node：`v24.18.1`，92,540,232 bytes，SHA-256
  `ac51903c4c111815d52280b1fdcc8da067cbb37e2fe1a765097b85c3292c8582`。
- 本机 package：`easyeda-mcp-pro 0.35.4`；`README.md` 43,680 bytes，SHA-256
  `c522260620d5d919e7530f9ead6182d481f5551a6f3de49db2eead96c2ada992`；入口 SHA-256
  `4fca20b24212b1c025f5262e514c113ab3bfec12338349a46f69c02606122fcc`。
- `profile.json` 锁定606个package文件（3,815,595 bytes）的确定性聚合树SHA-256
  `16533fbc5a9dc6699a5ffd73d9c71d95da102864f7366cd4e38a5e3ded125d4e`，并锁定工具安装
  `package-lock.json` 49,507 bytes、SHA-256
  `6f3fd34aa68c624a5adc213798d3b7b7a71d219788ffad95b4f8b5786ed7e41e`；Node、package完整文件树或
  依赖锁漂移时先形成新profile revision，不把新版本行为静默继承到本结果。

源码与本机编译产物共同证明：每个 HTTP initialize 创建独立 session server 和 transport，并进入
`sessions: Map`；全部 session 复用同一个 `BridgeManager`、context 和 storage。`/healthz` 与 `/readyz`
只证明 HTTP 进程存活，真实 EDA 连通仍须 `easyeda_bridge_status`。

### 2.2 双线软件输入同步

本包启动时，FamilyWorkspace 的 34/34 报告已经存在，但软件 owner 尚未写入收口；POC 运行期间软件线完成
owner anchor、current-context、capsule 和 index 收口。包关闭时重新读取后的权威输入为：

- `SW-FAMILY-WORKSPACE-COMPOSITION-01` 已收口，34/34；报告 5,532 bytes，SHA-256
  `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254`；
- 边界仍为 `storage=single-process-app-owned-directories`、`hardwareImpact=NONE`；
- 下一个软件包是 `SW-ASSET-VAULT-RECOVERY-01A`；包关闭复读时已出现70/70候选报告（14,616 bytes，
  SHA-256 `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474`），但软件owner anchor尚未收口，
  因此只记为`PENDING_OWNER_CLOSEOUT`；候选边界仍为主机单进程vault/journal/startup recovery且`hardwareImpact=NONE`；
- 本硬件包的 HardwareSystem、target-binding、board adapter、BOM、硬件测试、ReleaseGate 和 EDA transport
  输入变化均为 `NONE`。

因此本 POC 没有把 host canonical WAV、portable restore 或候选asset-vault recovery推导为目标存储、codec、
DeviceLink 或掉电证据。

## 3. 隔离拓扑与保护范围

```text
逻辑 MCP client A ─┐
                    ├─ 127.0.0.1:49643/mcp ─ 单一 Node 进程 ─ 127.0.0.1:49642
逻辑 MCP client B ─┘                                      （无 EDA extension，预期 disconnected）

现有 JLCEDA extension ─ 127.0.0.1:49620 ─ 原 stdio keeper（全程保持）
```

隔离服务固定：

- `BRIDGE_PORT_SCAN=49642`，避免 package 回退到其他端口；
- 只开放 `diagnostics/schematic/bom/checks/pcb : read`；
- raw exec、下单、JLC 搜索、无 key sourcing、Mouser/DigiKey 全部关闭；
- 每次运行、每个 cycle 使用独立 `DATA_DIR/SQLITE_PATH/ARTIFACT_DIR/CACHE_DIR`；
- 每个cycle实际复核独立SQLite文件和artifact/cache目录；run目录作为忽略提交的本机证据保留；
- stdout/stderr 始终由父进程读取，避免把 GUI `EPIPE` 与 MCP 多实例问题混为一层。

运行前后逐字节核对：Codex `config.toml`、HardwareSystem topology、target-binding、`BOM-REV-A.pending.json`
与 `purchase-plan.csv`。同时核对 live `49620` listener 的 address/PID。

## 4. 本机运行结果

执行：

```powershell
npm run validate:eda-shared-http-poc
```

结果：运行门 **31/31**，第二校验器复算 **20/20**。

| 证据项 | 实测结果 |
|---|---|
| cycle 1 单进程/双 listener | PID `17216` 的完整LISTENING集合精确为 `127.0.0.1:49642`、`:49643` |
| 双 session | 两个 initialize 得到不同 session ID；报告只保存各自 SHA-256 |
| 工具面 | 两个 session 均为 71 tools，名称集合 SHA-256 `f01c011a1197429a001fa7fed2b162eb6009a1e683f7d11ca583343e7762a639` |
| 功能开关 | ordering/JLC search/Mouser/DigiKey/OAuth/raw exec均实测为false；`easyeda_execute`不在工具面 |
| 写scope反证 | 参数完整的`easyeda_schematic_place_component`在进入bridge前返回`ERR_FORBIDDEN_SCOPE`，要求`schematic:write` |
| 交错调用 | 两 session 并发发起bridge status并分别得到响应，均为`active_port=49642`、`connected=false`；不据此声称真实EDA调度语义 |
| session 隔离 | DELETE A 后 A 返回 HTTP 404；B 继续正常返回 status |
| cycle 1 停止 | `SIGTERM`，父进程未升级强制路径；两个端口均释放 |
| cycle 2 重启 | 新 PID `16592` 的完整LISTENING集合仍精确为两个隔离端口；旧B session为HTTP 404，新C session建立 |
| cycle 2 停止 | `SIGTERM`，父进程未升级强制路径；两个端口均释放 |
| live 路径 | listener owner前后均为PID `10344`；两端ESTABLISHED记录（PID `10344/14508`）也逐项一致 |
| 配置/硬件保护态 | 5 个受保护文件 bytes/SHA-256 前后一致；EasyEDA Codex entry 仍为 stdio command |

主报告：26,337 bytes，SHA-256
`7abc68725406e1bb31f7cc724fbbeb1b37770ec64c3dadaf5f2c54d54e8642ac`。第二校验报告：7,643 bytes，
SHA-256 `b620c580dfd6d9bbb9dd79210bbc175d9f1d1e1c4b7969fb325dfff58b518e2d`。报告还绑定runner
SHA-256 `107f117f966e4567e3813a6aa4b70bf379ce05eabb7727252c3867bd72a836d0` 与validator SHA-256
`11ffa539c44e4519c8a5a5fc73da321f703e1e54811d4db4d89a469a9822f18b`。

第二校验器不只读取`passed`：它重新计算Node/package树/依赖锁、当前保护态文件、stdio配置、live
`49620` endpoints和隔离端口空闲状态，并复核两个cycle的完整listener集合、session/stop/storage/effect不变量。

进程退出和端口释放属于本机实测；Windows 内部是否完整执行 package 的每一个 async shutdown 步骤没有单独
插桩，因此不把它扩大为“优雅 drain 已证明”。未来 service wrapper 仍需明确 drain timeout 与最终进程收口。

## 5. 已闭合与未闭合

### 已闭合

1. 0.35.4 在本机一个 HTTP 进程中可同时维持两个独立逻辑 MCP session；
2. 两个 session 共享一个 bridge listener，关闭一个 session 不影响另一个；
3. 服务重启后旧 session 明确失效，新 session 可重建；
4. 隔离运行不修改现有 Codex、live EDA、HardwareSystem、target-binding、BOM 或采购状态；
5. POC runner/validator/profile 可以在 Node、606文件package树或依赖锁漂移时阻断历史结论复用；
6. 运行态feature flag、工具注册与scope handler共同证明写操作、raw exec、下单和外部sourcing未开放。

### 继续 `PENDING_CONTROLLED_MAINTENANCE_WINDOW`

1. `49620/49630` 上真实 EDA extension + shared HTTP daemon；
2. 两个独立 Codex Desktop task 经 URL 同时读取真实工程；
3. 真实 EDA API 并发/排队语义；当前源码未见全局 FIFO；
4. Codex Desktop URL 配置刷新、服务 crash、stdio keeper 全回滚演练；
5. session 数量/空闲 TTL、共享 `127.0.0.1` 每分钟 100 请求配额的长期运维策略；
6. GUI `EPIPE` 长时稳定性。它是 Electron 输出 pipe 层，不由本 POC 结论覆盖。

最终stdio快照仍为多实例：8个package进程/8个listener，只有`49620`连到EDA。数量随其他Codex task退出
可下降；关键事实是stdio仍按task产生独立进程，本POC没有停止或迁移这些现有实例。

真实迁移前还须注意两个固定事实：实际 bridge 监听候选来自 `BRIDGE_PORT_SCAN`，而非只看
`BRIDGE_PORT`；`/readyz=ok` 也不等价于 `connected=true`。

## 6. 架构影响与复用收益

| 入口 | 本包影响 |
|---|---|
| HardwareSystem / target-binding | `NONE`；18 条 target binding 继续 `TARGET_EVIDENCE_PENDING` |
| board adapter | `NONE` |
| BOM revision / purchase | `NONE` |
| ReleaseGate | `NONE` |
| live EDA | `NONE_ISOLATED_PORTS` |
| Codex 全局配置 | `NONE_NOT_APPLIED` |

复用资产集中在一个版本化 profile、一个生命周期 runner 和一个独立 validator。后续 package 更新或 live 迁移
只新增 profile revision/运行证据，不复制端口、scope、保护态和 session 验收逻辑。

## 7. 收口后收益复排

| 排名 | 下一硬件包 | 分项 | 总分 | 判定 |
|---:|---|---|---:|---|
| 1 | `HW-MB1-SEND-AND-FREEZE` | `30/20/20/10/7/9` | **96** | 当前最高收益；真实外发和书面回件直接推进五元组 |
| 2 | `HW-BENCHMARK-BUY-AND-INTAKE` | `24/18/19/10/8/7` | **86** | 仍受下一项卖家原件门控 |
| 3 | `HW-REF2-SELLER-EVIDENCE-SEND-AND-CAPTURE` | `24/18/16/10/9/8` | **85** | 发送已生成请求并保存 11 项原件 |
| 4 | `HW-LAB-INSTRUMENT-REGISTRATION` | `18/20/15/9/8/7` | **77** | 采集 6 槽位/7 资产的真实身份和校准/参考证据 |
| 5 | `HW-EDA-SHARED-HTTP-LIVE-MIGRATION` | `16/20/5/10/6/7` | **64** | POC 提升证据就绪；维护窗口、真实双 task 和完整回滚仍待执行 |
| 6 | `HW-EDA-SKELETON` | `15/16/5/9/7/5` | **57** | 现有接口骨架足够；芯片级字段保持锁定 |
| 7 | 芯片级自研 PCB | `10/4/4/4/5/2` | **29** | 一体板候选尚未经过书面资料和两套同版实物判失格 |

收益最高动作仍是真实发送 MB1 询证；本机没有另一个应越过供应商/实物门而提前展开的芯片级设计包。
