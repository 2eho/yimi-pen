# FamilyRepository v1 reference implementation

本目录实现 `FamilyRepository v1` 的目标无关聚合规则和两个适配器。它服务家庭内容库，
不读取 BuildRequest 的板卡、物理码、codec 或文件路径。

## 分层

| 文件 | 责任 |
|---|---|
| `repository-core.mjs` | revision/CAS、幂等 operation、backup/restore/recovery、outbox 与状态身份 |
| `memory-adapter.mjs` | 无 IO 的测试/用例适配器 |
| `atomic-json-adapter.mjs` | 开发与黄金回归用的原子 JSON 适配器 |
| `run-conformance.mjs` | 两适配器共用 transcript、语义负例与文件故障注入 |

共享的 FamilyRevision 语义与严格 RFC 3339 校验位于
[`contracts/`](../../contracts/)，避免 build adapter 和 repository 各维护一份规则。

## 聚合端口

```text
open / loadHead / loadRevision
commit(expectedHeadRevisionId, operationId, revision)
createBackup / restore
restorePortable(replicaInstanceId) -> new replica epoch
readOutbox -> { epoch, nextSequence, events[] }
```

原子 JSON adapter 另有显式 `initialize`、损坏恢复和格式归一化生命周期操作。新目录必须
先初始化；初始化后的 `state.json` 缺失会判为损坏，不会伪装成空库。

所有产生事件的命令和幂等重放都返回：

```json
{
  "eventCursor": {
    "epoch": "epoch:sha256:...",
    "sequence": "1"
  }
}
```

同一 replica 内的普通 `restore` 保持当前 epoch，并以追加事件移动 active head；完整家庭包导入
使用新增的 `restorePortable`，要求全新空库和唯一 `replicaInstanceId`，创建与源库不同的新 epoch，
从 sequence 1 开始。损坏恢复同样旋转 epoch。这样源库和恢复副本不会产生相同
`(epoch, sequence)`、不同事件；同一 portable restore 在响应丢失后仍可幂等重放。

## 不变量

- `repositoryId` 固定一个仓库身份；首次 revision 后 `familyLibraryId` 固定；
- revision store 只追加不可变实体；restore 只移动 active head 并合并 backup 中缺少的实体，
  不删除 restore 之后的本地 revision；
- revision number/parent 连续，revision 时间不倒退；
- binding 内容不变时 bindingRevision 不变，内容变化时恰好加一，新 binding 从一开始；
- commit 时间不早于 revision 与当前事件时间线；
- state、operation journal 与 outbox 同一事务推进；
- `stateIntegritySha256` 覆盖 live state，backup 再以 state 摘要与 `backupId` 封装；
- restore 使用 repository/family scope，旧 operation 重放同时返回当前 head 和历史 outcome；
- portable restore 只接收全新空库，并把显式 replica 实例身份绑定进新 outbox epoch；
- backup 身份基于语义内容，JSON 空白不影响导入；owned `state.json` 则要求固定字节格式；
- 语义有效但格式漂移的 state 只做 raw-SHA CAS 归一化，不走旧 backup 回退。

## 验证

```powershell
npm run test:family-repository
npm run validate:family-repository-contracts
```

机器报告：`build/family-repository-validation/report.json`。当前 gate 覆盖两适配器各 16 条
transcript、13 条原子 JSON 边界和 14 条 core 语义边界；报告本身是计数与摘要的权威来源。

## 证据边界

Atomic JSON 是开发/黄金 adapter。现有测试证明同进程 adapter 重建、文件 fsync 后 rename
前故障保持旧状态、并发单赢家、损坏/格式漂移/backup scope 等行为。进程崩溃、父目录
fsync、遗留 lock 自动处置、目标存储耐久和实物掉电仍保持独立证据门；产品端出现第二个
真实存储消费者后实现 SQLite adapter，并复用同一 conformance suite。
