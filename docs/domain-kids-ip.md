# 幼儿 IP 点读领域模型

在通用 Book/Page/Hotspot 之上，增加 IP 娱乐向字段与模式。

## 实体

### IpBrand（IP）

| 字段 | 说明 |
|------|------|
| id | 如 `chick-ball` |
| name | 展示名 |
| mascot | 主角色 id |
| voiceProfile | 默认音色/语速标签 |

### Series（书系）

| 字段 | 说明 |
|------|------|
| id | `series-bedtime` |
| ipId | 所属 IP |
| title | 睡前故事 |
| ageMin / ageMax | 建议月龄/年龄 |
| books | 册列表 |

### Book（扩展）

| 字段 | 说明 |
|------|------|
| seriesId | 书系 |
| theme | `story` / `cognition` / `song` / `scene` |
| playModes | 支持的模式列表 |

### Hotspot（扩展）

| 字段 | 说明 |
|------|------|
| kind | `character` / `object` / `word` / `song` / `story` / `egg` / `ui` |
| characterId | 角色点读时关联 |
| playPolicy | `replace`（打断重播，默认）/ `queue` / `random_one` |
| cooldownMs | 防连点刷屏 |

### Clip（扩展）

| 字段 | 说明 |
|------|------|
| mediaType | `voice` / `sfx` / `song` / `bgm` / `narration` |
| weight | 随机权重 |
| emotion | `happy` / `surprise` / …（可选） |

## 播放模式

| mode | 行为 |
|------|------|
| free | 点哪播哪，新点打断旧点（玩具默认） |
| story | 按页/书预定序列旁白，点「下一页」热区推进 |
| song | 歌曲优先，可循环 |
| explore | 引导：「找一找红色的球」类任务（后续） |

## 点读管线（幼儿向）

```
Tap → 解析 Hotspot → 按 playPolicy 选 Clip
    → free 模式 playNow（打断）
    → story 模式可 enqueue 旁白队列
    → 上报 session 事件（可选，家长端）
```
