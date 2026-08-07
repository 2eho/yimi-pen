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
npm run validate:architecture  # 依赖方向、合同所有权、Rust/TS 适配边界
npm run validate:hardware-system  # 稳定硬件拓扑、目标证据绑定与EDA入口门
npm run validate:golden-24-projection  # 24码真源→Snapshot/Family 投影漂移门
npm run validate:fast  # 日常快速依赖/生成/类型门
npm run validate:contracts  # 跨 Node/Rust 合同门
npm run validate:full  # 完整产品研发回归
npm run test:family-build-adapter  # FamilyRevision+BuildRequest→Alpha 编译投影
npm run test:family-repository  # Memory/Atomic JSON 共用 FamilyRepository transcript
npm run validate:family-repository-contracts  # Family 构建+仓库聚合门
npm run test:companion-host  # 家庭授权编译 + 完整导出/portable restore 主机纵切
npm run test:companion-capture-authoring  # DirectShow CapturePort→同一Family创作/预听/授权/Snapshot链
npm run test:companion-authoring-task-recovery  # 本地 authoring task journal→精确恢复/重放
npm run test:companion-tts-source-adapter  # SYSTEM_TTS私有bytes→App staging→FamilyWorkspace CAS与审计receipt
npm run test:companion-asset-vault-recovery  # 持久journal→进程退出→FamilyWorkspace启动恢复
npm run test:companion-family-workspace  # 单一repository/vault/coordinator/source组合根与portable adoption
npm run test:companion-desktop-authoring-task  # framework-neutral桌面创作task service/view与本地journal验收
npm run verify:companion-real-authored -- --source FILE.wav --transcript "TEXT"  # 本地创作→真实预听→授权design Snapshot
npm run verify:companion-real-authored -- --record-device "MIC_DEVICE" --record-seconds 3 --transcript "TEXT"  # 麦克风走同一主链
npm run test:execution-model  # Snapshot→Node/Rust稠密执行表与点读轨迹
npm run validate:release-gates  # Catalog/Receipt/Decision合同与负例
npm run evaluate:release-gates  # 复用最近一次密封full run，聚合host/物理receipt并复算发布判定
npm run validate:product-rd  # 新鲜重跑全部host门、密封源码/报告身份并生成发布判定
npm run test:family-alpha-compiler  # 家庭编辑→确认→Snapshot 的主机合同
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
├── apps/companion-app  # FamilyWorkspace、预听授权、设计 Snapshot 与完整导出/恢复组合根
├── packages/core       # 点读引擎
├── packages/content    # 包格式读写
├── packages/audio      # 播放队列
├── packages/protocol   # 笔通信协议
├── contracts           # 跨 adapter 复用的目标无关语义校验
├── hardware/evt0       # Snapshot/DeviceLink/Family 等机器合同与证据模板
├── tools               # 编译器、模拟器和 conformance runners
├── content/books       # 样例书
├── content/packs       # 社区包索引与约定
├── docs/               # 产品与规范
└── community/          # 贡献指南、行为准则
```

## 文档

| 文档 | 说明 |
|------|------|
| [**产品理论定稿**](docs/theory.md) | **想法与原则冻结版 · 先读这个** |
| [**系统构思 v0.2**](docs/system-concept.md) | **产品、硬件、固件、家长端与内容的端到端研发蓝图** |
| [高复用、低维护架构](docs/reuse-maintainability.md) | 稳定内核、端口适配、单一合同所有者、变更预算与机器依赖门 |
| [家庭协调层消费者审计](docs/family-coordination-consumer-audit.md) | companion 产品纵切、账号/权威边界与完整家庭导出/恢复证据 |
| [Family Authoring v1](docs/family-authoring-v1.md) | 本地资产导入、target-neutral revision、CAS/replay、真实预听、逐构建授权与 design Snapshot 纵切 |
| [Authoring Product Shell v1](docs/authoring-product-shell-v1.md) | framework-neutral source/permission/metadata/commit/review 会话、精确重放与产品失败语义 |
| [Authoring Task Recovery v1](docs/authoring-task-recovery-v1.md) | canonical 本地任务 journal、CAS、corruption quarantine、commit truth barrier 与精确恢复 |
| [Desktop Authoring UI Adapter v1](docs/desktop-authoring-ui-adapter-v1.md) | framework-neutral durable task service、纯 view projector、同步持久化与恢复 attention |
| [System TTS Source Adapter v1](docs/tts-source-adapter-v1.md) | 固定fixture身份、无provider路径能力、canonical WAV、监督取消/资源/审计与稳定内核零修改门 |
| [Family Asset Vault Maintenance v1](docs/asset-vault-maintenance-v1.md) | 全历史引用 mark、dry-run、保留期、稳定引用租约与条件 orphan 清理 |
| [Asset Vault Recovery v1](docs/asset-vault-recovery-v1.md) | 持久 maintenance journal、启动恢复与 child-process 中断证据 |
| [FamilyWorkspace v1](docs/family-workspace-v1.md) | 单一 Atomic repository/vault/coordinator/source 组合根、capability API 与 canonical portable adoption |
| [HardwareSystem v1](docs/hardware-system-architecture.md) | 12个稳定逻辑块、18条接口、主板/OID证据绑定与嘉立创EDA准入门 |
| [EVT-0 黄金产品切片](docs/product-slice-evt0.md) | 24码逻辑 fixture、成熟产品基准协议与需求—测试追踪 |
| [Content Snapshot v1](docs/snapshot-v1.md) | 设备只读内容快照、完整性、原子激活与回滚契约 |
| [ExecutionModel v1](hardware/evt0/execution-model-v1/README.md) | Snapshot key→稠密 slot、逐 action cooldown、播放计划与 Node/Rust 黄金轨迹 |
| [ReleaseGateCatalog v1](hardware/evt0/release-gates-v1/README.md) | 稳定 RG gate、EvidenceReceipt、确定性 ReleaseDecision 与物理证据边界 |
| [DeviceLink v1](hardware/evt0/device-link-v1/README.md) | manifest-first 分块、幂等、断连、CAS 与 Node/Rust transcript |
| [Family Alpha v1](docs/family-alpha-v1.md) | 家庭 draft、可审计预览、精确确认与 Snapshot 编译合同 |
| [FamilyRevision / BuildRequest / Repository v1](hardware/evt0/family-repository-v1/README.md) | target-neutral 家庭事实、目标构建请求、revision/CAS、epoch outbox、backup/recovery 与共用 conformance |
| [Family Export v1](hardware/evt0/family-export-v1/README.md) | RepositoryBackup、全部历史资产、内容寻址清单、精确闭包与 portable restore |
| [Rust 固件可行性](docs/research/rust-firmware-feasibility-2026.md) | Rust主体 + 窄 C ABI、运行时互斥路线、C/Rust差分与板卡证据门 |
| [Rust 固件工作区](firmware/README.md) | `no_std` 核心、single-owner C ABI、DeviceLink/TestResult与主机/跨架构检查 |
| [主板 Port 证据包](hardware/evt0/board-port-evidence-v1/README.md) | 供应商材料、ABI/HIL门、双板 C/Rust 同测顺序 |
| [安全定稿](docs/safety.md) | 儿童/内容/亲情音色安全 |
| [硬件与 OID](docs/hardware-oid.md) | 笔、贴纸、延迟、装包 |
| [Gen1 EVT-0 单件目标样机](docs/hardware-gen1-p0.md) | 真实 OID、同版 PCB/BOM、单件采购、结构与目标质量验收 |
| [嘉立创EDA Pro × Codex](docs/jlceda-codex.md) | 本机桥接、只读硬件评审、EDA/GitHub 发布边界 |
| [商业边界](docs/business-boundary.md) | 开源免费 vs 可收费 |
| [缺口清单](docs/gaps.md) | 尚未尽事项 |
| [GitHub 技术调研](docs/research/github-survey-2026.md) | 选型/数值/行动细分 |
| [成熟产品对标](docs/research/mature-products-gen1-p0.md) | 小鸡球球、宝贝 JoJo、讯飞与采购拆解清单 |
| [证据门审计 2026-08-03](docs/research/evidence-gate-audit-2026-08-03.md) | 桌面证据闭合边界、`BOARD_TARGET` BT-0..BT-6 与下一步实物包 |
| [EVT-0 单件采购](docs/research/gen1-evt0-single-buy.md) | 同一目标料号的单买顺序、下单门和来料检查 |
| [OID/主板 RFQ](docs/research/gen1-p0-oid-rfq.md) | 当前 M01-M08 预询证，以及 EVT-0 后续码空间、授权、批量交付和报价问卷 |
| [MB1 付款前询证包](docs/research/gen1-mb1-prepay-pack.md) | 两家完整 PCBA/OID 候选、松翰原厂交叉核对、可直接发送正文与付款门 |
| [L0 系统音 TTS](docs/tts-l0.md) | edge-tts 缓存出声 |
| [L1 亲情音色 PoC](docs/tts-l1.md) | 复刻接口/探测（可选重依赖） |
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
| [架构方案比较](docs/architecture-options.md) | 本地、云端、混合与微服务方案决策 |
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
