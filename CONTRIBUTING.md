# 贡献指南 · Contributing to Yimi Pen

感谢参与 **益米点读笔** 开源社区。

## 你可以贡献什么

| 类型 | 路径建议 | 说明 |
|------|----------|------|
| 主题包 / 点读书 | `content/packs/` 或独立仓库 + PR 索引 | 最欢迎：让资源变广 |
| 引擎 / 协议 | `packages/*` | 玩法、随机策略、新 kind |
| 模拟器 / 后台 | `apps/*` | 体验与作者工具 |
| 文档 / 翻译 | `docs/` | 中英皆可 |
| 米家友好桥接 | `docs/mi-home-friendly.md` + 可选 `apps/bridges/` | 仅社区桥，非官方 SDK |
| 固件适配 | `firmware/` | 标明芯片与协议版本 |

## 主题包投稿（内容广的核心）

1. 阅读 [docs/pack-spec.md](docs/pack-spec.md)
2. 准备 `book.json` + 音频 + `pack.meta.json`（许可证、年龄、标签）
3. 本地校验：`npm run validate:books`
4. 确保 **你有权发布** 文字/插画/音频/IP（原创或已获授权）
5. 提交 PR：把包放进 `content/packs/<pack-id>/` 或在 `content/packs/registry.json` 登记外链仓库

**拒绝 / 红线**：

1. **禁止传播任何受版权保护的商业点读包**（破解、镜像、未授权录制）  
2. 未授权商业 IP 搬运、侵权音频  
3. 成人/暴力内容、恶意脚本  

鼓励：公版、自制、**DIY 贴纸绑定与拍照绘本**（见 `docs/diy-dual-path.md`）。

## 开发流程

```bash
npm install --include=dev
npm run validate:books
# 改 packages 后
npx tsc -p packages/core/tsconfig.json
npm run dev:sim
```

- 默认分支：`main`
- PR 请说明：动机、行为变化、是否破坏 `book.json` 兼容
- 破坏性变更：升 `packFormat` 主版本并写迁移说明

## 行为准则

参与者须遵守 [community/CODE_OF_CONDUCT.md](community/CODE_OF_CONDUCT.md)。

## 许可

代码贡献默认以 **Apache-2.0** 授权。  
内容包按你在 `pack.meta.json` 中声明的许可证授权。

## 商标

请勿在贡献物中冒充小米/米家官方；「米家友好」仅表示可选互操作文档或社区桥接。
