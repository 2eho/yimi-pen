# Confirmation Trust v1：预听确认、签名与一次性构建授权

> 状态：host 合同已关闭；生产 provider qualification 与真实家庭账号权威仍保持证据门。  
> 机器合同：[`confirmation-trust-v1`](../hardware/evt0/confirmation-trust-v1/) · [`BuildPlan / BuildAuthorization`](../hardware/evt0/family-repository-v1/)  
> 回归入口：`npm run test:confirmation-trust`

## 1. 为什么拆成两个层级

旧 `BuildRequest v1` 同时要求目标构建参数和未来才会产生的 confirmation，形成：

```text
BuildRequest → draft → preview → confirmation → BuildRequest.confirmation
```

v1.1 路线保持旧黄金输入兼容，但真实流程改为：

```text
FamilyRevision + BuildPlan（无 confirmation）
→ draft → preview
→ 一次性 challenge
→ 完整预听 transcript
→ confirmation
→ Ed25519 proof 验证并原子消费 challenge
→ BuildAuthorization
→ 授权后的候选编译
```

`BuildPlan` 对除 `buildSubjectSha256` 外的完整 JCS 对象取 SHA-256；target、物理映射、codec、
资产目录或投影预期任一变化都会得到新 subject。`BuildAuthorization` 只授权这一个 subject，
不会变成可复用布尔开关。

## 2. 产品发布门与逐构建授权分离

两类证据用途不同：

| 层级 | 工件 | 证明内容 |
|---|---|---|
| 产品版本 | `RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED` | 已部署 provider、生产 keyring、authority resolver 与 replay store 对当前产品 release 合格 |
| 每次家庭构建 | `BuildAuthorization` | 某个受信监护权威完成这一个 BuildPlan/preview 的预听和确认 |

host fixture 只关闭 `RG-HOST-CONFIRMATION-TRUST-CONTRACT-PASSED`。生产门要求 gate-specific verifier；
普通自洽 `EvidenceReceipt`、任意工件 hash 或调用方自报 producer 都不会关闭它。当前黄金策略和 RFC
测试密钥固定 `fixtureOnly: true`，生成的 authorization 不携带产品 ReleaseDecision 引用。

## 3. 签名 profile

当前仓库仍支持 Node `>=18`，本机主路径是 Node 22，因此首版固定：

```text
profile: Ed25519+JCS-prefix-v1
algorithm: Ed25519
domain bytes: ASCII("org.yimi.pen/family-confirmation-proof/v1\0")
signing input: domain bytes || UTF8(RFC8785-JCS(claims))
signature: 64-byte Ed25519, unpadded base64url
```

这不是 Ed25519ctx。若以后把最低运行时冻结到原生支持 Ed25519ctx 的版本，会新增互斥 profile，
不会让两个 profile 互相验签。proof 的 `kid` 是 RFC 7638/9278 JWK thumbprint URI；信任只来自
本地 policy keyring，proof 不携带可改变信任根的公钥。

一手依据已按 URL、字节数和 SHA-256 锁在
[`evidence-lock.json`](../hardware/evt0/confirmation-trust-v1/evidence-lock.json)：RFC 7517、7519、
7638、8032、8037、8410、8725、8785、9278、9449 与 Node crypto 文档。

## 4. 绑定范围

签名 claims 至少绑定：

- `buildPlanId / buildSubjectSha256 / familyRevisionId`；
- `previewId / sourceSha256 / presentationPolicyVersion`；
- 完整 presentation transcript 的语义 SHA-256；
- confirmation ID、语义 SHA-256、决定、范围和时间；
- 假名化 guardian subject、role 与不可变 authority revision；
- 128-bit challenge nonce、challenge ID、签发与到期时间；
- provider、policy、算法 profile、audience 和 purpose。

presentation verifier 按 preview 的 binding/clip 数组顺序要求：先打开 preview、每个 required clip
完成播放、最后显式确认。缺 clip、替换 clip hash、顺序漂移、确认发生在播放完成前或超出 challenge
窗口都会失败。

proof 和发布证据不保存姓名、邮箱、账号 token、私钥、原始录音或认证凭据。设备 Snapshot 只接收
最终 `BuildAuthorization`/proof identity 的最小引用。

## 5. Replay 与崩溃语义

challenge nonce 是 16 字节不可预测值。store 状态为：

```text
ISSUED → CONSUMED
       ↘ EXPIRED / SUPERSEDED
```

验证全部通过后，`CONSUMED + verificationResult + operationJournal` 在同一事务写入。失败不消费 nonce，
不生成 result，也不改输出树。相同 proof/subject 重试返回首次持久化 result；同一 challenge 的不同
有效 proof 并发只有一个赢家。Memory 与 Atomic JSON adapter 使用同一语义，黄金回归覆盖 reopen 后
重试、并发、响应丢失和零副作用失败。

## 6. 当前证据边界

已完成：

- confirmation-free BuildPlan 到既有 Alpha draft 逐字节一致；
- RFC 8032 公共测试向量的 Ed25519/JCS/prefix 黄金 proof；
- preview、presentation、confirmation、authority、key window 与 proof 的交叉绑定；
- active/retired/revoked key 语义、128-bit challenge、幂等和原子消费；
- fixture BuildAuthorization 与产品 ReleaseDecision 分离；
- 17/17 负向场景全部保持 ledger 和输出树零副作用；
- 生产 confirmation gate 对自报 receipt 采用 gate-specific fail-closed verifier。

仍需真实证据：

1. 家庭账号系统给出的不可变 authority revision 与认证事件；
2. 生产私钥的受控存储、轮换、吊销和审计；
3. 产品环境 Atomic DB/事务 adapter 的多进程与崩溃验证；
4. 当前 product release 的 provider qualification 工件；
5. 真实 `release-candidate`、ReleaseDecision 与 BuildAuthorization 的端到端编译。

这些证据到位前，旧 `BuildRequest v1` release 路径和 Family Alpha 的 `release-candidate` 输出继续保持关闭。
