# Authoring Task Recovery v1

本合同覆盖 `companion-app` 的本地、target-neutral authoring task journal。它保存的是
可验证的 session/recovery 事实，不把硬件、设备交付、云账号或 UI 状态偷偷写进
`FamilyRevision`。

## 1. 用户可见保证

标签说明：`INFERENCE` 是工程推导，不是成熟产品的官方承诺；`IMPLEMENTED` 表示本仓库
已有合同和验收 runner 覆盖。

- **[INFERENCE / IMPLEMENTED]** 在 canonical asset 发布前中断时，若 source request 已落盘，
  重启会回到 source acquisition；若 request 缺失，则明确进入 abandon，不猜测输入。
- **[INFERENCE / IMPLEMENTED]** 已发布的 asset 不会因为 source adapter 不在而被要求重新录制；
  会从 metadata/commit 边界继续。
- **[INFERENCE / IMPLEMENTED]** frozen commit command 是唯一重放输入；重试不能改动
  `operationId`、base head、asset、metadata 或 producer。
- **[INFERENCE / IMPLEMENTED]** `COMMITTING` 是不可取消的 truth barrier。UI 的取消不会把
  未知的 repository 结果伪装成回滚；恢复会用同一 command 查询/重放结果。
- **[INFERENCE / IMPLEMENTED]** review 中断只创建新的 review attempt，并重新绑定完整的
  committed revision；不会再次提交 FamilyRevision。
- **[INFERENCE / IMPLEMENTED]** adapter id/version/profile 不匹配，尤其是 hardware-facing
  binding 不匹配时，恢复停止在 `ReleaseGate(BLOCKED)`，核心 session 不做 mutation。
- **[INFERENCE / IMPLEMENTED]** journal 损坏会保留原始字节、生成 corruption receipt 并阻断
  恢复；不会用“最后看起来像真的状态”继续执行。

## 2. Phase / recovery matrix

| Session phase | 已有 durable fact | recovery decision | 恢复动作 |
|---|---|---|---|
| `AWAITING_SOURCE` | 只有目标；可能有 source selection | 有 `sourceRequest`=`RESTART_SOURCE`；否则 `ABANDON` | 回到 `READY_TO_ACQUIRE` 或明确结束 |
| `READY_TO_ACQUIRE` | source identity 已选 | `RESTART_SOURCE` | 重建 source adapter/private request |
| `AWAITING_PERMISSION` | source request；permission attempt 可能未结算 | `RESTART_SOURCE` | 清除旧 permission receipt/active attempt，再请求 capability |
| `ACQUIRING_SOURCE` | source request；canonical asset 尚未进入 snapshot | `RESTART_SOURCE` | 旧 effect 只作为中断证据，重新 acquisition |
| `AWAITING_METADATA` | `importedAsset` 与 publication fact | `CONTINUE` | 继续编辑 metadata |
| `PREPARING_COMMIT` | asset + metadata；command 尚未冻结 | `CONTINUE` | reset preparation，回到 `READY_TO_COMMIT` |
| `READY_TO_COMMIT` | asset + metadata；可能已有 frozen command | 无 command=`CONTINUE`；有 command=`REPLAY_FROZEN_COMMIT` | 新建 command 或精确重放 frozen command |
| `COMMITTING` | frozen command；外部 commit 结果未知 | `REPLAY_FROZEN_COMMIT` | 先进入 replay-ready，再用同一 command |
| `READY_TO_REVIEW` | full committed revision + commit receipt | `CONTINUE` | 启动 review |
| `REVIEWING` | committed revision；review attempt 未结算 | `FRESH_REVIEW_RETRY` | 丢弃旧 attempt identity，创建新 review attempt |
| `FAILED` | failure receipt | 按 stage：source restart、commit replay、fresh review 或 safe retry | 只按已记录的 `resumePhase` 复原 |
| `REJECTED` | review rejection receipt | `FRESH_REVIEW_RETRY` | 重新 review，不重写已提交 revision |
| `CONFLICT` | CAS/base-head conflict | `CONFLICT` | 无 controller；要求用户处理，不静默 rebase |
| `CANCELLED` / `COMPLETED` | terminal lifecycle | `TERMINAL` | 只读结束态 |

`currentHeadRevisionId` 与 pre-commit target head 不同会生成 `BASE_HEAD_CHANGED` conflict。
已冻结 commit 的恢复不以当前 head 做静默 rebase，而是交给 repository 的 CAS/idempotency
语义决定 `committed` 或 `replayed`。

## 3. Canonical journal、CAS 与 corruption invariants

- Recovery record 是 schema/profile `authoring-task-recovery-v1`，固定字段集合；`recordId`
  是删除自身字段后的 JCS canonical SHA-256。
- Session state 的 `stateId` 同样是删除自身字段后的 canonical SHA-256。record 的
  `expectedStateId` 必须等于 snapshot 的 `stateId`。
- 文件字节严格为 `canonicalize(record) + "\\n"`；额外字段、非 canonical JSON、坏身份和
  超过默认 8 MiB 的记录都拒绝。
- task 文件名为 `task-<sha256(taskId)>.json`，只能位于绝对、非 symlink 的 journal root。
- 新记录从 `journalRevision=0` 开始；更新必须递增一，CAS expectation 精确匹配
  `(journalRevision, recordId, expectedStateId)`。相同 `recordId` 的重复 create 是幂等的。
- writer 用 `.authoring-task-journal.lock` 的 exclusive create 形成 best-effort 单写者门；
  冲突返回 busy，不覆盖别人的记录。
- 写入先创建随机 `.next-*` 临时文件，写完后调用 file-handle `sync()`，关闭后 rename 到
  canonical target；失败时清理临时文件。
- 读取先检查 regular/non-empty/non-symlink、大小、JSON、canonical bytes 和完整 schema。
  失败时原文件移入 `quarantine/`，以源字节 SHA 命名，并写入
  `authoring-task-journal-corruption-receipt-v1`；corrupt evidence 存在时 load/recovery/write
  都保持阻断。
- `sourceRequest` 必须是 plain JSON；`eventSequence` 是 event cursor，至少覆盖 session
  revision；`attemptSequence` 是独立的 attempt cursor，只要求为非负 safe integer，不能把
  effect 次数错误地等同于 session event 数。

## 4. COMMITTING truth barrier 与 exact replay

1. `COMMIT_PREPARATION_STARTED` 之前，command factory 是可中止 effect；准备成功后
   `COMMIT_PREPARED` 把完整 command 写入 session snapshot。
2. `COMMIT_STARTED` checkpoint 先于 `authoringPort.commitReplacement`，此时 phase 为
   `COMMITTING`，active effect 的 `abortable=false`。
3. `cancel()` 在 `COMMITTING` 或 commit effect active 时直接拒绝；必须等 commit result
   settle。这样不会把“进程没有返回”误报为“repository 没有提交”。
4. `COMMIT_SUCCEEDED` 只接受与 frozen command 完全一致的 FamilyRevision、asset catalog
   和 commit outcome；outcome head 必须等于 revision identity，状态只能是 `committed` 或
   `replayed`。
5. 重启遇到 `COMMITTING` 或带 frozen command 的 commit failure 时，先保留 command，进入
   `READY_TO_COMMIT`，随后用完全相同的 command 调用 repository。验收证明 response-loss
   replay 不增加 revision、outbox 或 head。

因此 commit 的用户文案应是“正在确认提交结果/可重试精确提交”，而不是“已回滚”。

## 5. Fresh review retry

Review receipt 必须绑定 `sessionId`、`familyRevisionId`、`bindingId`、`clipId`、`assetId`
和 asset SHA。`REVIEWING` 恢复清除旧 active review attempt，但保留 full committed
revision；下一次 `review()` 生成不同的 attempt id。review rejection/failure 只影响
review phase 和 receipt，不复制或修改已 durable 的 FamilyRevision。`fixtureOnly=true` 也
不会把 `buildAuthorized` 置为 true。

## 6. Pre-durable `RESTART_SOURCE`

source selection、private `sourceRequest` 和 active attempt 可持久化；canonical imported
asset 未进入 session snapshot 前，不把 staging 文件当成 durable content identity。
`AWAITING_PERMISSION` 恢复会清除旧 capability receipt，`ACQUIRING_SOURCE` 恢复会清除旧
effect，二者都回到 `READY_TO_ACQUIRE`。缺 source request 时恢复结果是 `ABANDON`，而不是
猜一个路径、设备或 transcript。source adapter/profile/source-kind 不匹配则在 effect 之前
触发 ReleaseGate。

## 7. Adapter / hardware ReleaseGate

Recovery record 的 adapter binding 只有 `source`、`permission`、`authoring`、`commitCommand`、
`review`、`hardware` 六个字段；每个 binding 固定 `id`、semver `version` 和 v1 `profile`。
要求的 binding 会随 phase 变化，pre-durable source 还会检查可用 source port 的
`sourceKind`。

匹配失败返回：

```text
status=BLOCKED
code=ADAPTER_BINDING_MISMATCH
coreMutation=NONE
requiredBindings=[...]
providedBindings=[...]
```

session snapshot 的 target 只有 `familyLibraryId`、base revision、binding 和 clip；没有
board、firmware、物理 OID 或设备路径。硬件线保持只读；未来 hardware-facing adapter 只在
绑定、版本和 ReleaseGate 处接入，不把硬件事实写入恢复核心。

## 8. Official facts / inference / unknown

本节只引用已经出现在 `build/luna-task-recovery-official.log` 的直接官方 URL；官方页面是
成熟产品的可见交互证据，不是本仓库合同的实现证明。

### Official facts

| Ecosystem | Direct official evidence | Narrow fact used here |
|---|---|---|
| Yoto | [How to create a playlist from your own recordings](https://support.yotoplay.com/en_gb/how-to-create-a-playlist-from-your-own-recordings-B1piuFiXGl) | 官方支持页面把“自己的录音”到“playlist”作为一个用户可见创作流程。 |
| Ravensburger tiptoi | [tiptoi audio files](https://www.ravensburger.de/de-DE/entdecken/tiptoi/tiptoi-audiodateien)；[tiptoi Manager](https://www.ravensburger.de/de-DE/entdecken/tiptoi/tiptoi-manager) | 官方入口分别暴露 tiptoi audio-file 内容和 Manager 工具；这证明内容准备/工具操作是可区分的产品阶段。 |
| Tonies | [Creative Tonies](https://tonies.com/en-gb/creative-tonies/)；[Supported audio formats for Creative Tonies](https://support.tonies.com/hc/en-gb/articles/29036563051154-Supported-audio-formats-for-Creative-Tonies) | 官方产品与支持页明确存在 Creative Tonie 用户内容路径及受支持音频格式约束。 |

### Cross-product inference

- **[INFERENCE]** 当产品把录音、内容准备、设备/播放前 review 分成可见步骤时，本地 app
  应保存每个阶段的 durable identity，而不是只保存一个“busy”布尔值。
- **[INFERENCE]** 进程退出或 UI cancel 不能证明外部写入未发生；因此本合同把 commit 设为
  non-abortable truth barrier，并设计 exact replay。
- **[INFERENCE]** review 应是已提交 revision 上的新 attempt；失败 review 不应触发第二次
  content commit。

### Unknown / not evidenced

上述官方页面没有为本项目证明：中断录音的临时文件是否跨重启保留、账号/应用/设备哪个副本
是权威、上传/同步是否原子、discard 是否删除服务端内容、跨设备冲突如何解决、UI cancel
在远端写入后的语义、或任何特定的 fsync/power-loss 保证。本文不把这些未知项写成产品事实，
也不声称本合同复制了这些产品的内部实现。

## 9. Honest storage limits

- 当前本地 adapter 只对“临时文件 sync 后 rename”的进程内路径提供证据；没有 parent-directory
  fsync，因此不承诺突然断电后 rename 一定持久可见。
- lock 是 best-effort local lock file；没有 stale-lock 自动处置、跨进程租约或 crash-proof
  lease 的承诺。
- 没有证明 root directory replacement、卷损坏、介质掉电、跨设备 writer 或 SQLite/cloud
  transaction 的耐久性。
- corruption quarantine 保留可审计字节，但 quarantine/receipt 本身的目录持久性仍受同一
  fsync/power-loss 限制。
- `COMMITTING` barrier 解决的是语义上的未知结果与精确重放，不等于物理介质已经完成掉电
  级 durability；repository adapter 仍需给出自己的 durable commit evidence。

## 10. Closeout evidence

| Runner | Result | Report SHA-256 |
|---|---:|---|
| authoring task recovery | 22/22 | `7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059` |
| authoring product shell | 33/33 | `e4dd6694ece3acfa2bde4ca80d80701c27c1143067eafe70620cd03776d88eeb` |
| system TTS source adapter | 41/41 | `04016c8479eb435c307418a2e8dbcbdae4e3f95d5e7dbee924884ede736293a0` |
| FamilyRepository conformance | memory 16/16; atomic 16/16 | `96433369a8bad64742c53699a259313e3fc738a2609315a3f9828312443b019f` |
| FamilyWorkspace | 34/34 | `094f7607beed195854f4083a1f8851b33af8fcf3bfd62295a66d913e56837254` |
| asset-vault recovery | 70/70 | `65c2923ada29eb98c65b2d4f83d4b7da971b4c4fb1ef588bff75b20880ecb474` |

Hardware inputs were reread for closeout and left untouched. The final sealed `validate:full` gate
is performed after the package source and documentation edits are complete.
