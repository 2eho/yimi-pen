# 益米主题包规范 · Pack Spec

`packFormat`: **1**

## 目录布局

```
my-pack/
  pack.meta.json      # 必填：索引与版权
  books/
    <bookId>/
      book.json       # 必填：与引擎 Book 模型一致
  audio/
    <bookId>/
      *.mp3           # 路径对应 clip.uri
  assets/             # 可选：封面、预览图
  README.md           # 可选：作者说明
```

安装到设备/仓库时，可扁平合并进：

```
content/books/<bookId>/
content/audio/...
```

## pack.meta.json

```json
{
  "packFormat": 1,
  "id": "community-hello-forest",
  "title": "你好，小森林",
  "description": "原创认知短故事",
  "version": "1.0.0",
  "authors": ["your-name"],
  "rightsHolder": "your-name",
  "license": "CC-BY-4.0",
  "ageMin": 2,
  "ageMax": 5,
  "languages": ["zh-CN"],
  "tags": ["story", "cognition", "community"],
  "ipId": null,
  "bookIds": ["hello-forest-01"],
  "homepage": "https://github.com/you/your-pack",
  "yimi": {
    "minEngine": "0.1.0",
    "miHomeFriendly": false
  }
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| packFormat | 是 | 现为 `1` |
| id | 是 | 全局唯一，小写+连字符 |
| license | 是 | SPDX 或常见短名（MIT, CC-BY-4.0, CC0-1.0…） |
| rightsHolder | 是 | 版权责任方 |
| bookIds | 是 | 包内书 id 列表 |
| ageMin/Max | 建议 | 月龄/年龄提示 |
| yimi.minEngine | 建议 | 最低引擎版本 |

## book.json

见 [content-format.md](./content-format.md) 与 [domain-kids-ip.md](./domain-kids-ip.md)。

幼儿 IP 推荐填写：`kind`、`playPolicy`、`mediaType`、`weight`。

## 校验

```bash
npm run validate:books
```

未来：`yimi pack check ./my-pack`（校验 meta + 音频存在 + OID 唯一）。

## 许可证建议

| 场景 | 建议 |
|------|------|
| 代码周边工具 | Apache-2.0 |
| 原创绘本+音频 | CC-BY-4.0 或 CC-BY-NC-4.0 |
| 公共领域素材汇编 | CC0-1.0（仍需确认素材来源） |

## 禁止

- 无 license / 无 rightsHolder  
- 未授权商业角色与商标  
- 可执行脚本、加密锁死仅单厂可解的私有 blob（可另附开放映射表则除外）  
