# 益米点读笔 · Yimi Pen

开源「万物可点」平台：**实体贴纸 DIY + 绘本 DIY + 社区主题包**，笔端与内容解耦。

体验可好玩如发声书，供给靠 **自创与公版**，不靠锁区商业库。

> **非学段教辅笔** · **非小米官方产品**  
> 护城河 = 开放生态 + 双 DIY + 可选 IoT/AI · **禁止商业点读包盗传**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

## 为什么做开源

商业点读笔内容常被锁死在单一品牌/芯片方案里。益米把三件事拆开：

| 层 | 开源什么 | 社区能做什么 |
|----|----------|--------------|
| **引擎** | 热区解析、播放策略、协议 | fork、改玩法、接新硬件 |
| **格式** | `book.json` / 主题包规范 | 做任意 IP/原创绘本包 |
| **工具** | 模拟器、校验、内容后台 | 贡献编辑器、装包器、商店索引 |

目标：**点读资源广** —— 官方样例少而精，社区包多而活。

## 产品形态

```
[益米笔 / 模拟器]  ←协议→  [本地主题包仓库]
        ↑                        ↑
   家长端(可选)              社区 Pack Hub
        ↑                        ↑
  米家友好桥接(可选)         作者投稿 / CI 校验
```

- 体验：点角色说话、点物体音效、听故事、唱儿歌、彩蛋（玩具感）
- 内容：社区贡献的主题包（CC 协议自选 + 版权自担）
- 生态：可选 MQTT/HTTP 状态上报，方便 Home Assistant / 自建网关（**米家友好 ≠ 米家官方**）

## 快速开始

```bash
git clone https://github.com/2eho/yimi-pen.git
cd yimi-pen
npm install --include=dev
npm run dev:sim      # 笔模拟器
npm run dev:admin    # 内容浏览 http://127.0.0.1:5173
npm run validate:books
```

模拟器（含 DIY 贴纸）：

```text
diy
tap oid:YIMI-DIY-BANANA
bind YIMI-DIY-001 水杯 咕咚咕咚喝水啦
tap oid:YIMI-DIY-001
tap oid:JOJO-0101
```

详见 [docs/diy-bind.md](docs/diy-bind.md)。

## 仓库结构

```
yimi-pen/
├── apps/device-sim     # 设备模拟
├── apps/admin-web      # 内容浏览/管理
├── apps/companion-app  # 家长端占位
├── packages/core       # 点读引擎
├── packages/content    # 包格式读写
├── packages/audio      # 播放队列
├── packages/protocol   # 笔通信协议
├── content/books       # 样例书
├── content/packs       # 社区包索引与约定
├── docs/               # 产品与规范
└── community/          # 贡献指南、行为准则
```

## 文档

| 文档 | 说明 |
|------|------|
| [**产品理论定稿**](docs/theory.md) | **想法与原则冻结版 · 先读这个** |
| [安全定稿](docs/safety.md) | 儿童/内容/亲情音色安全 |
| [硬件与 OID](docs/hardware-oid.md) | 笔、贴纸、延迟、装包 |
| [商业边界](docs/business-boundary.md) | 开源免费 vs 可收费 |
| [缺口清单](docs/gaps.md) | 尚未尽事项 |
| [GitHub 技术调研](docs/research/github-survey-2026.md) | 选型/数值/行动细分 |
| [L0 系统音 TTS](docs/tts-l0.md) | edge-tts 缓存出声 |
| [产品定位](docs/product-vision.md) | 对标 JoJo / 非讯飞路线 |
| [社区与内容生态](docs/community-ecosystem.md) | Pack Hub、版权、发现 |
| [双 DIY 路径](docs/diy-dual-path.md) | 贴纸万物点读 + 拍照成书 |
| [亲情音色](docs/voice-profile.md) | 爸妈声复述打字/AI 文案 |
| [DIY 绑定](docs/diy-bind.md) | OID 绑定命令 |
| [社区红线](docs/community-rules.md) | 禁止商业点读包传播 |
| [主题包规范](docs/pack-spec.md) | 社区投稿格式 |
| [米家友好说明](docs/mi-home-friendly.md) | 可选桥接与免责 |
| [领域模型](docs/domain-kids-ip.md) | kind / playPolicy |
| [架构](docs/architecture.md) | 模块关系 |
| [上手](docs/getting-started.md) | 安装与命令 |

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [community/CODE_OF_CONDUCT.md](community/CODE_OF_CONDUCT.md)。

欢迎：样例包、翻译、OID 工具、编辑器插件、固件适配、Pack Hub 爬虫/索引。

## 商标与免责

- **益米 / Yimi Pen** 为本开源社区品牌，与小米、米家、MIUI 无隶属关系。  
- 请勿在未授权情况下使用小米/米家官方标识宣传本项目。  
- 社区内容版权由投稿者负责；侵权包将被移除。  
详见 [NOTICE](./NOTICE)。

## License

源码：[Apache License 2.0](./LICENSE)  
样例内容见各自目录声明；社区包在 `pack.meta.json` 中自声明许可证。
