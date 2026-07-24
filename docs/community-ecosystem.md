# 社区与内容生态

益米的核心竞争力不是封闭题库，而是 **开源引擎 + 开放包格式 + 社区 Pack Hub**。

## 目标

**点读资源广**：任何人可制作、分享、安装主题包；笔只认标准包，不认单一出版社。

## 三角色

| 角色 | 做什么 |
|------|--------|
| 作者 | 用规范做 `book.json` + 音频，声明许可证 |
| 用户 | 装包到笔/模拟器，点读玩耍 |
| 维护者 | 引擎兼容、校验工具、registry 审核、侵权下架 |

## Pack Hub（规划）

```
registry.json          # 包索引（本仓或独立 hub 仓）
  └── pack entry
        id, title, age, tags, license
        source: git url | 本仓 path
        checksum, packFormat
```

阶段：

1. **v0** 本仓 `content/packs/` + 人工 PR  
2. **v1** 独立 `yimi-packs` 仓库 + CI 校验  
3. **v2** 简易网页索引 / 家长端一键装包  

## 版权红线

**第一条：禁止传播任何受版权保护的商业点读包。**

- 商业 IP（含未授权仿绘）不得入库  
- 音频需原创、授权或公共领域  
- 每个包必须有 `license` 与 `rightsHolder`  
- DIY 家庭包默认可仅本地；公开分享须权利勾选  
- 举报侵权 → 维护者下架并记入 NOTICE  

合法「资源广」靠：公版名著、自制绘本、**贴纸/拍照双 DIY 生成**，不靠兼容盗版库。详见 [diy-dual-path.md](./diy-dual-path.md)。

## 发现与标签

推荐 tags：`story` `song` `cognition` `bedtime` `zh-CN` `en` `age:2-4` `community` `official-sample`

## 与商业产品的关系

益米是 **开放底座**。品牌方可基于 Apache-2.0 做自己的笔与商店，但：

- 社区包默认不被闭源商店独占（除非作者另选协议）  
- 官方样例保持可 fork  

## 指标（社区健康）

- 独立 pack 数量、可安装率  
- 校验 CI 通过率  
- 侵权下架次数（越低越好）  
- 外链 pack 仓库活跃度  
