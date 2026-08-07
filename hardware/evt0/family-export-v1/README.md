# Family Export v1

`family-export-v1` 是家庭内容的完整、可迁移目录包；它组合既有
`FamilyRepositoryBackup` 与所有历史 revision 引用的资产字节：

```text
manifest.json
repository-backup.json
assets/<sha256>.bin
```

## 合同所有权与消费者

- 纯语义身份与资产引用不变量由
  [`contracts/family-export-v1.mjs`](../../../contracts/family-export-v1.mjs) 唯一持有；
- 目录 manifest 的机器格式由
  [`family-export-manifest.schema.json`](./family-export-manifest.schema.json) 唯一持有；
- 当前产品消费者是
  [`apps/companion-app/src/local-family-export.mjs`](../../../apps/companion-app/src/local-family-export.mjs)；
- [`apps/companion-app/src/run-acceptance.mjs`](../../../apps/companion-app/src/run-acceptance.mjs)
  以完整导出、独立检查、干净恢复、重建 preview 和篡改零副作用场景执行合同；
- FamilyRepository backup 的 schema、`backupId`、scope 和 state 语义继续归
  [`family-repository-v1`](../family-repository-v1/) 所有，本合同只组合并验证，不复制第二份定义。

## 身份与边界

- `exportId` 是移除自身后的 manifest JCS SHA-256，用作内容身份和完整性索引；它不承担来源签名、
  监护人授权或防恶意重新打包；
- repository backup 继续由 FamilyRepository v1 校验 `backupId` 与 state；
- 每个资产同时绑定 `assetId / bytes / sha256 / content-addressed path`；
- `path` 必须严格等于 `assets/<asset.sha256>.bin`，同一 `assetId` 在历史 revision 中更新字节时
  以 `(assetId, sha256)` 保存多个身份，当前 head 的路径另行投影；
- export 根目录与 `assets/` 都实行精确文件闭包，额外文件、目录或链接会使检查失败；
- inspect/restore 要求调用方显式传入资源策略，在读取文件前先核对声明长度、单文件、总字节与条目上限；
- restore 先验证全部 schema、身份、scope、引用闭包与文件字节，再创建目标目录；
- restore 使用 FamilyRepository `restorePortable`，为新副本旋转 outbox epoch，且在 staging 内完成
  head、cursor 与资产 vault 复核后才发布目标目录；
- 多个 assetId 可引用同一内容寻址文件，但同一路径只允许一个字节身份；
- v1 是本地目录格式，不绑定 zip、SQLite、云账号、设备 transport 或 App UI。

当前合格门为：

```powershell
npm run test:companion-host
```

主机 acceptance 使用 Family Alpha 的10个资产，并覆盖同一 assetId 跨 revision 更新、干净恢复、
源/恢复 cursor 隔离、路径哈希绑定、精确目录闭包、资源门、已有输出保护和资产篡改负例。
当前目录发布提供进程内 staging/rename 边界；异常退出遗留 staging 的回收、父目录 fsync、
真实录音 callback 与产品介质掉电耐久仍由后续实物/runtime 门验收。
