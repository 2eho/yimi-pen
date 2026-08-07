# Desktop Authoring UI Adapter v1

`DesktopAuthoringTaskService` 是 App-local、framework-neutral 的持久化边界；渲染层只接收
`DesktopAuthoringTaskView`，不直接持有 `AuthoringProductSession`、journal、repository、workspace
或任何 OS adapter。

组合根必须显式传入并通过 recovery contract 规范化 `adapterBindings`；不会从 ports 推断静态绑定，
也不会以实例内 per-task override 代替持久化的 composition identity。

## Contract

每个公共命令入口（包括 malformed input 与 overlap failure）都返回一个 Promise。Promise resolve 前，service
必须已经完成 journal CAS 写入，并从磁盘重新加载 canonical record。返回 view 的四个身份字段始终来自同一条持久化记录：

| 字段 | 来源 |
| --- | --- |
| `recordId` | recovery record content identity |
| `journalRevision` | local journal CAS revision |
| `stateId` | session snapshot content identity |
| `sessionRevision` | session event cursor |

同步 mutation `selectSource`、`submitMetadata` 和 `retry` 通过
`saveAuthoringTaskRecoverySnapshot` 完成持久化。source selection 同时写入 adapter-private
`sourceRequest`，随后 service 丢弃旧 controller 并从 journal reopen，避免旧 recovery closure 继续被复用。

异步 `acquire`、`commit`、`review` 和 `cancel` 继续使用既有 checkpoint hooks。settlement 返回前，service
会验证 controller snapshot 与当前磁盘 record 的 `stateId`、`sessionRevision` 一致。

single-flight identity 是 `command + canonical JSON payload fingerprint`。同一 task 的同命令同 payload 返回
同一个 Promise；同命令不同 payload 返回 `DESKTOP_AUTHORING_TASK_BUSY`，错误只含 command/code，不含私有 payload。
同步 mutation 遇到 live journal CAS 冲突时返回或附带磁盘新 writer 的 `CONFLICT` read-only view，核心不产生持久化 mutation。

`getView()`、`listTasks()` 与 `abandon()` 每次都以当前显式 adapter bindings 和 Family head 对持久化 record
重新执行 recovery classification；这些读取不会触发 recovery transition 或其它磁盘写入。仅新建后仍在内存中的
`fresh` handle 可以暂时保留首次 `AWAITING_SOURCE` 视图；重启后同一记录回到 `ACTION_REQUIRED`。`REPLAY_FROZEN_COMMIT`
（包括重启后的 `COMMITTING`）不能被 abandon 越过 truth barrier；CAS 冲突会在抛出的错误上附带新 writer 的
canonical conflict view，并保留旧写入者的零持久化变更。abandon 在 CAS 前再做一次 bounded Family-head
复核，若 head 已变化则直接投影 `BASE_HEAD_CHANGED` read-only conflict；跨进程 writer lease 仍是后续独立证据门。

## Renderer-safe view

view 是深度冻结的 JSON-safe v1 对象，只保留 source selection、metadata、公共 asset identity、commit/review
摘要、failure category、recovery decision、command availability 和事实投影。以下字段永远不出现在 view：

- `sourceRequest`
- `contentPath`、absolute path、staging path
- capture device name、native picker handle、raw OS error
- token、controller、journal、repository、workspace 或 adapter object

`target`、`metadata`、`committedRevision`、`failure`、`permission`、`attention` 与命令对象均按 trusted core
schema 逐字段投影；多余字段不会因 core schema 扩展而自动穿透 renderer boundary。

permission `DENIED`/`UNAVAILABLE` 只公开 capability/status 与 settings guidance：
`guidance.kind=SETTINGS`、`guidance.actionId=CHECK_OS_PERMISSION_SETTINGS`、
`guidance.canTriggerNativePrompt=false`。OS payload、诊断、设备名和路径仍留在 adapter 内。

`facts.contentRevisionSaved`、`facts.buildAuthorized`、`facts.offlineReady` 与未来的
`facts.deviceInstall` 彼此独立。当前 device install 投影为 `status=UNRESOLVED`、`hardwareImpact=NONE`；它不代表
真实设备交付、设备存储掉电能力或任何板卡能力。

## Commands and recovery

服务提供 `createTask`、`resumeTask`、`selectSource`、`acquire`、`submitMetadata`、`commit`、`review`、`retry`、
`cancel`、`abandon` 和通用 `command` dispatch。`cancel` 可中止当前可中止 effect；`COMMITTING` 保持
truth barrier，view 不提供 cancel。

以下状态只读投影 attention，且 `coreMutation=NONE`：

- `ACTION_REQUIRED`：记录仍为 `ACTIVE`，但恢复合同要求用户明确执行 `ABANDON_TASK`；这不是终止记录；
- `CONFLICT`：base Family head 与当前 head 不一致；
- `ADAPTER_MISMATCH`：恢复所需 adapter binding 不匹配；
- `TERMINAL`：completed、cancelled 或 abandoned record；
- `JOURNAL_CORRUPTION`：journal record 被 quarantine 或无法解析。

`ABANDON` 且 `lifecycle=ACTIVE` 只开放 CAS abandon；已经 `lifecycle=ABANDONED` 的记录保持 `TERMINAL`
并且 read-only。每次服务实例只持有一个显式 composition `adapterBindings`；task record 持久化该合同作为
requirements，restart 仍以新实例的 composition 作为 runtime availability，不能用实例内 per-task map 掩盖 mismatch。

`listTasks()` 保留 journal transport order，不声明产品排序，也不以文件 mtime 推断顺序；task retention 与 product sorting
当前均为 `UNKNOWN`。

这些 attention 状态不替代现有 recovery contract，也不选择 Electron、Tauri 或其他渲染框架。框架选择继续
等待 durable service、restart/fault、permission、process ownership、IPC、single-writer 和 packaged artifact
证据门全部闭合。

## Verification

确定性 runner（当前 93/93）：

```text
node apps/companion-app/src/desktop-authoring/run-desktop-authoring-task-acceptance.mjs
```

它使用真实本地 journal 文件和现有 FamilyRevision v1 fixture，覆盖 fresh durability、restart-before-first-source、
sourceRequest restart、metadata/retry persistence、canonical payload single-flight、malformed Promise entry、
live CAS conflict/newer-writer identity、cached controller identity re-open、final abandon head recheck、permission settings guidance、TTS selection/auto-metadata durability、
review interruption fresh retry over the same durable revision、async checkpoint settlement、disk identity、privacy boundary、
COMMITTING barrier、CAS stale abandon、conflict/adapter mismatch/terminal/corruption attention 与
`CONTENT_REVISION_SAVED`/authorization/offline/device facts 分离。TTS provider qualification 与真实 OS permission 仍由
各自既有 adapter runner 持有；本 runner 只证明 desktop composition hook 的 durable seam。
