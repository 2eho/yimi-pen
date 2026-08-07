# JLCEDA shared HTTP POC v1

该合同把嘉立创EDA共享 HTTP 的**本机可复算事实**与未来 live 迁移分开：

- POC 只使用 `127.0.0.1:49642`（隔离 bridge）和 `127.0.0.1:49643`（隔离 MCP HTTP）；
- 一个固定版本 `easyeda-mcp-pro` 进程同时建立两个逻辑 MCP session；
- 验证 session ID 隔离、关闭一个 session 后另一个继续工作、停止释放端口、重启后旧 session 失效；
- 运行前后核对 Codex 全局配置、HardwareSystem、target-binding、BOM revision、采购计划以及 live `49620` listener；
- 当前服务保持只读 scope，采购、下单、raw exec、外部 sourcing 全部关闭。
- 每次运行、每个 cycle 使用独立 `DATA_DIR/SQLITE_PATH/ARTIFACT_DIR/CACHE_DIR`，不复用现有 stdio 进程状态。
- 子进程只继承最小OS环境白名单与本POC显式变量，不继承无关凭据/服务变量。
- 固定606个package文件的聚合树哈希与工具安装`package-lock.json`，并在第二校验器中重新复算Node、文件树、保护态、端口与配置。
- 运行时读取feature flags，并以一个参数完整但被scope提前拒绝的写请求证明`schematic:write`未开放；该请求不会进入bridge。

执行：

```powershell
npm run validate:eda-shared-http-poc
```

机器报告：

```text
build/jlceda-shared-http-poc.json
build/jlceda-shared-http-poc-validation.json
```

## 结论边界

本 POC 能闭合的是：单进程、双逻辑 session、session 隔离、端口边界与本机 stop/restart。

每次运行的两个独立runtime目录保留在忽略提交的`build/jlceda-shared-http-poc-runtime/`，用于复核SQLite/日志证据；空间维护由人员按run目录整体清理，不由验证命令自动删除。

以下项目继续保持 `PENDING_CONTROLLED_MAINTENANCE_WINDOW`：

1. 把真实 JLCEDA extension 从现有 stdio keeper 切到共享 HTTP daemon；
2. 两个独立 Codex Desktop task 经 URL 配置同时读取真实工程；
3. 对同一真实工程执行并发 EDA API 的调度语义；
4. Desktop URL MCP 配置刷新与完整 stdio 回滚演练；
5. GUI `EPIPE` 的长期稳定性。它与 MCP 多实例属于不同故障层。

候选 live URL 仅作为记录：`http://127.0.0.1:49630/mcp`。本合同不写全局配置。
