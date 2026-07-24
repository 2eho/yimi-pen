# GitHub 技术缺口细分调研

> 日期：2026-07-24  
> 范围：数值 / 选型 / 行动（对照 `gaps.md` + 三专题）  
> 方法：GitHub Search / API（仓库名、描述、star、许可）  
> **不是**供应链报价或法务意见；OID 芯片授权仍须商务 RFQ。

---

## 0. 总览：开源能补什么、不能补什么

| 缺口域 | GitHub 密度 | 对益米的含义 |
|--------|-------------|--------------|
| A. 点读笔固件 / OID 产线 | **极稀** | 物理码与芯片几乎无现成开源全家桶 |
| B. 亲情音色 / 声音复刻 TTS | **极密** | 选型主战场；可定「本地弱 / 云强」阶梯 |
| C. 轻量本地 TTS（非复刻） | **密** | Piper 等可作默认「系统音」与离线兜底 |
| D. 内容安全过滤 | **中** | 有毒评论/PII 工具可借，**幼儿专用词表仍要自建** |
| E. 码与打印（通用条码） | **密但错位** | 二维码/PDF417 多；**OID 点码图案**几乎无开源 |
| F. 装包 / 音频打包 | **稀（旧货）** | TalkingPen 打包工具可参考形态，不可当现代栈 |
| G. MQTT / HA 桥 | **密** | 米家友好桥可抄模式，不必自研发现协议 |
| H. 商标 / 3C / dB | **不在 GH** | 须商标局、实验室、检测院 |

---

## 1. 域 A · 点读笔 / OID / 固件

### 1.1 检索命中（有效）

| 仓库 | Stars | 语言 | 备注 |
|------|------:|------|------|
| [labrick-lib/TalkingPen](https://github.com/labrick-lib/TalkingPen) | 5 | C | 固件痕迹 + **ArchTool 音频打包**（Siren7/wav、conf、Flash 格式图） |
| [labrick-lib/HWHeader](https://github.com/labrick-lib/HWHeader) | 0 | — | 硬件模块/封装相关 |
| [shenya0203/ReadPenServer](https://github.com/shenya0203/ReadPenServer) | 4 | C | 名「点读笔」；实为 **airkiss 配网 + 简易 HTTP**，非点读引擎 |
| [umaribn681/oidproducer](https://github.com/umaribn681/oidproducer) | 0 | — | 名含 sonix2；内容近空，**不可依赖** |
| Anoto / Livescribe 开源 | ≈0 可用 | — | 学术/笔记向，非幼儿发声笔 |

### 1.2 TalkingPen 可借鉴点（选型参考，非直接 fork 商用）

从目录结构可见 legacy 产线形态：

- `ArchTool`：wav → 专有压缩（Siren7 `.s7`）、索引、`conf.ini`、整包写入 Flash  
- `Hardware/`：ISD9XXX、Nu_Link、ADPCM、camera 等 **Nuvoton/语音芯片年代**方案  
- 文档：中文说明书、存储格式示意  

**数值/形态假设（来自形态推断，非官方规格）：**

| 项 | 观察 |
|----|------|
| 音频 | 先本地文件，再专用编码进笔 |
| 工具链 | PC 打包工具 + 固件，而非现代 monorepo |
| 年代 | ~2013–2014 变更日志风格 → 许可与驱动过时风险高 |

### 1.3 结论（选型）

| 选项 | 建议 | 理由 |
|------|------|------|
| 把 TalkingPen 当 Gen1 固件底座 | **否** | star 低、文档乱码、闭源工具链痕迹、芯片过时 |
| 把「PC 打包 → 本地音频索引」当装包 UX 参考 | **是** | 与益米 Pack 灌笔叙事一致 |
| 逻辑 OID 继续自研字符串层 | **是** | 开源侧只有逻辑层可控 |
| 物理点码 / Sonix OID 解码 | **商务 RFQ** | GitHub **补不了**授权与码图算法 |

### 1.4 行动项 A

1. 列出 2–3 家国内点读笔方案商（Sonix/凌通/纽威等）做 **NDA 规格书**，不问开源。  
2. 益米开源仓只保证：**逻辑 OID + Pack + 模拟器**；物理解码作可选闭源驱动接口（H6）。  
3. 可选：只读研究 TalkingPen 的 `conf.ini`/索引结构，写「legacy 对照笔记」，不引进二进制 DLL。

---

## 2. 域 B · 亲情音色（声音复刻）

### 2.1 头部开源（选型短名单）

| 项目 | Stars（约） | 许可（API 显示） | 特点 | 益米适配 |
|------|------------:|------------------|------|----------|
| [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | ~60k | MIT | 少样本克隆（宣传 1 min 级） | **家用 PC/NAS 实验首选** |
| [CorentinJ/Real-Time-Voice-Cloning](https://github.com/CorentinJ/Real-Time-Voice-Cloning) | ~60k | — | 经典 5s 克隆 demo；偏研究 | 参考，维护与中文弱于新栈 |
| [myshell-ai/OpenVoice](https://github.com/myshell-ai/OpenVoice) | ~37k | MIT | Instant clone；MIT 友好 | **服务端 API 封装友好** |
| [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) | ~31k | NOASSERTION | SOTA 向开源 TTS | 需核清模型权重条款 |
| [FunAudioLLM/CosyVoice](https://github.com/FunAudioLLM/CosyVoice) | ~22k | Apache-2.0 | 多语、训练推理部署全栈 | **中文产品向强；注意权重与商用说明** |
| [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | ~12k | — | 通义系开源 TTS/克隆能力 | 跟官方商用条款 |
| [jamiepine/voicebox](https://github.com/jamiepine/voicebox) | ~46k | — | 开源 AI 语音工作室 | 体验参考，非嵌入式 |
| [jianchang512/clone-voice](https://github.com/jianchang512/clone-voice) | ~9k | — | Web UI 克隆 | 快速 PoC UI |

### 2.2 阶梯选型（建议拍板草案）

| 阶梯 | 技术 | 硬件假设 | 延迟/体验 | 何时用 |
|------|------|----------|-----------|--------|
| **L0 系统音** | Piper / edge 类 | CPU 手机/PC | 快、不像爸妈 | 默认、无档案 |
| **L1 本地复刻** | GPT-SoVITS 或 CosyVoice 本地 | 有独显 PC/NAS | 秒级合成 → **必须缓存再入笔** | 发烧友/家庭服务器 |
| **L2 云复刻** | OpenVoice/Cosy/商业 API | 手机 App | 依赖网；缓存后离线点 | 可选订阅（B2/B4） |

**与 H8 对齐：** 笔上只播 **已缓存 wav/mp3**；禁止点按现场等 GPU 2s。

### 2.3 数值建议（工程目标，待实测校准）

| 指标 | 建议起点 | 依据 |
|------|----------|------|
| 录入样本时长 | 合计 **30–90s** 有效语音（5–10 句） | 与 GPT-SoVITS「少样本」叙事同量级；OpenVoice 可更短作 PoC |
| minSamples（产品） | **5**（已在 `VoiceProfile` 默认） | 平衡体验与失败率 |
| 单句合成超时 | App 侧 **≤15s** 可接受；超时用 L0 | 幼儿场景家长可等，笔侧不等 |
| 缓存策略 | 文本 hash + voiceId → 文件；改字失效 | 省存储与重复算力 |
| 相似度验收 | 家长 1–5 分，**≥3** 才标 ready | 无开源统一指标，产品自定 |

### 2.4 行动项 B

1. **PoC 分支**（不进 main 默认依赖）：Docker 跑 OpenVoice **或** CosyVoice 其一，输入妈妈 3 段 wav + 香蕉文案 → 出 mp3。  
2. 文档写清：权重许可与「家庭非商用 / 商用」边界（fish-speech 的 NOASSERTION 优先核）。  
3. 益米接口保持：`voiceProfileId` + `diy:tts:` → 以后换后端不改 Pack。

---

## 3. 域 C · 轻量 TTS（非复刻兜底）

| 项目 | Stars | 许可 | 用途 |
|------|------:|------|------|
| [rhasspy/piper](https://github.com/rhasspy/piper) | ~11k | MIT | **嵌入式/本地快 TTS**；无克隆也适合 L0 |
| openedai-speech 等 | 中 | — | OpenAI 兼容壳 + piper/xtts |
| edge-tts 生态 | 多 fork | — | 调用微软公网音，**合规与稳定性需自担** |

**选型建议：**  
- Gen0 模拟器/App：**Piper 中文模型** 作系统音。  
- 不把 edge-tts 当唯一生产路径（账号/ToS 风险）。

**行动项 C：** 在 `apps/` 增加可选 `tts-piper` 脚本：stdin 文本 → wav → 挂到 DIY clip（替换 stub）。

---

## 4. 域 D · 内容安全 / 过滤

| 项目 | Stars | 用途 | 局限 |
|------|------:|------|------|
| [unitaryai/detoxify](https://github.com/unitaryai/detoxify) | ~1.3k | 英文毒评分类 | **中文幼儿词表弱** |
| [presidio](https://github.com/data-privacy-stack/presidio) | ~10k | PII 脱敏 | 偏隐私，不治惊吓故事 |
| Llama-Guard 等 | 生态散 | LLM 护栏 | 重、要 API |

**结论：**  
开源给的是「成人社区毒评/PII」能力，**益米必须自建：**

- 中文幼儿黑名单词表（惊吓、死亡细节、性、毒品、广告诱导）  
- 高风险物体标签表（药/清洁剂）— 已在 safety 理论  
- 年龄档规则引擎（轻量 if-else 即可 Gen1）

**行动项 D：**  
1. 新建 `packages/safety-lite` 或 `content/safety/lexicon-zh.json` 骨架（词表 + riskClass）。  
2. Detoxify 仅作英文包可选，不设为默认。

---

## 5. 域 E · 贴纸印刷与「码」

| 开源能力 | 代表 | 与 OID 关系 |
|----------|------|-------------|
| 二维码/条码生成 | bwip-js、pdf417-* | **调试标签**可用；非光学点码 OID |
| PDF 排版 | 多 | 绘本 DIY 页可用 |
| 真正 OID 点阵生成 | **基本无** | 仍绑方案商工具 |

**选型建议：**

| 阶段 | 做法 |
|------|------|
| 现在 | 逻辑 OID 字符串 + 调试用 **QR 印贴纸**（App 扫码绑定，笔以后换真 OID） |
| Gen1 笔 | 方案商码图 + 官方空白贴 |
| 并行 | QR/逻辑双模：`YIMI-DIY-*` 与二维码 payload 同一 ID |

**行动项 E：**  
- 写 `docs/research/print-debug-qr.md` 一页：用任意 QR 库生成「OID 字符串」贴纸 PDF 模板（调试专用，声明非量产 OID）。

---

## 6. 域 F · 装包与协议安全

| 来源 | 可借鉴 |
|------|--------|
| TalkingPen ArchTool | 索引 + 音频批处理 + 写存储镜像 |
| 通用实践 | SHA256 checksum、minisign/cosign 签名、JSON schema |

GitHub **无**「益米 Pack 签名」现成标准 → 自研轻量：

```
pack.tgz + pack.sha256 + optional pack.sig
```

**行动项 F：**  
- `scripts/pack-checksum.mjs`：对 `content/books/*` 算 hash。  
- 协议加 `install` 消息草案（可后做）。

---

## 7. 域 G · MQTT / 米家友好

大量 `*-mqtt-ha` / discovery 库（star 数十级即可抄模式）。

**选型：**  
- 用 **MQTT + HA discovery JSON** 标准，不碰小米私有云。  
- 载荷已在 `mi-home-friendly.md` 草案。

**行动项 G：** 低优先级；有用户要再做 `apps/bridges/mqtt-bridge`。

---

## 8. 域 H · 不在 GitHub 的「数值与行动」

| 项 | 建议行动 | 不靠 GH |
|----|----------|---------|
| 商标「益米」「Yimi」 | 中国商标网检索 + 代理申请 | ✓ |
| 童锁 dB | 送检或简易声级计标定，写入规格 | ✓ |
| 3C/电玩具 | 咨询检测机构清单与周期 | ✓ |
| OID 授权费 | 方案商 RFQ | ✓ |
| 食品级背胶 | 材料商规格书 + 必要时检测 | ✓ |
| 声音权条款 | 律师审 ToS 模板 | ✓ |

---

## 9. 综合推荐：近 90 天技术路线（可执行）

```
W1–2  调研消化（本文）+ PoC 目录 docs/research/
W3–4  Piper L0 真出声挂 DIY
W5–8  OpenVoice 或 CosyVoice 本地复刻 PoC（缓存 mp3）
并行  商标检索；方案商 OID 询价（商务）
W9–12 safety-lite 词表 + pack checksum
之后  QR 调试贴纸模板；mqtt 按需
```

**刻意不做：** 把 GPT-SoVITS 打进笔固件；依赖 oidproducer 空仓；把 TalkingPen DLL 链进主仓。

---

## 10. 候选依赖许可速查（接入前再核）

| 组件 | SPDX/备注 | 接入姿态 |
|------|-----------|----------|
| Piper | MIT | 优先 |
| GPT-SoVITS | MIT | PoC OK |
| OpenVoice | MIT | PoC OK |
| CosyVoice | Apache-2.0 | 优先核权重 |
| fish-speech | NOASSERTION | **先读 LICENSE 全文** |
| TalkingPen | 未清晰 | **只读不链** |

---

## 11. 与益米仓库的映射

| 调研结论 | 落点 |
|----------|------|
| 逻辑 OID 自研 | 已有 `DiyBindStore` |
| VoiceProfile | 已有模型；接 L1/L2 后端 |
| 系统音 L0 | 待接 Piper |
| 安全词表 | 待建 |
| 物理 OID | 仓外 RFQ |
| 装包工具 | 形态参考 TalkingPen，实现自研 |

---

## 12. 修订

| 版本 | 说明 |
|------|------|
| 2026-07-24 | 首版 GitHub 细分调研 |

**声明：** Star 数为检索当日近似值；项目许可与模型权重以仓库当时文件为准，接入前复查。
