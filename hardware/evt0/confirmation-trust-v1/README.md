# Confirmation Trust v1

本目录持有家庭预听确认的版本化机器合同：

- `common.schema.json`：跨 proof/challenge/result 复用的 ID、时间和 base64url 类型；
- `trust-policy.schema.json`：本地受信 provider、Ed25519 JWK keyring 与假名 guardian authority；
- `challenge.schema.json`：单一 BuildPlan/preview 的 128-bit 一次性 challenge；
- `presentation-transcript.schema.json`：preview 打开、逐 clip 播放完成和显式确认；
- `proof.schema.json`：`Ed25519+JCS-prefix-v1` 签名 proof；
- `verification-result.schema.json`：原子消费后持久化的逐构建验证结果；
- `replay-ledger.schema.json`：challenge 状态、operation journal 与 result 同事务存储；
- `evidence-lock.json`：一手标准和 Node crypto 文档的 URL/字节/hash 锁；
- `golden/`：仅使用 RFC 8032 公共测试密钥的 fixture 向量。

设计与证据边界见 [`docs/confirmation-trust-v1.md`](../../../docs/confirmation-trust-v1.md)。

```powershell
npm run test:confirmation-trust
```

黄金工件固定 `fixtureOnly: true`；目录中没有生产私钥、账号凭据或真实家庭身份。
