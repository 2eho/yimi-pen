# Family Build Adapter v1

该工具把 [`FamilyRevision / BuildRequest v1`](../../hardware/evt0/family-repository-v1/)
投影为现有 Family Alpha 编译器的兼容输入。核心函数接收普通对象；资产读取通过注入的
`AssetReader` port 完成，文件系统只存在于 runner adapter。

## API

| API | 作用 |
|---|---|
| `computeFamilyRevisionId(revision)` | 计算排除 `revisionId` 自身后的 JCS 身份 |
| `projectCompileDraft({ familyRevision, buildRequest })` | 校验 Schema/跨表语义并返回不可变投影 |
| `verifyBuildAssets({ buildRequest, assetReader })` | 通过端口验证 resolved asset bytes/hash |

运行：

```powershell
npm run test:family-build-adapter
```

Runner 使用带精确所有权 marker 和独占 lock 的
`build/family-build-adapter-validation/`。它把投影与现有 Alpha draft 逐字节比较，再调用原
preview 实现核对 confirmation；20 个负向场景在每次失败前后比较输出树摘要。

此 adapter 是防腐层：FamilyRepository 和新 App 只理解 FamilyRevision/BuildRequest，旧
Alpha 编译器继续消费兼容投影。后续编译器原生消费新合同后，可删除投影层而不改家庭库。
