# GitHub 技术缺口细分调研

> 首版日期：2026-07-24
> 复核日期：2026-07-26
> 范围：数值 / 选型 / 行动（对照 `gaps.md` + 三专题）
> 方法：GitHub Search / API（仓库名、描述、star、许可）
> **不是**供应链报价或法务意见；OID 芯片授权仍须商务 RFQ。

---

## 0. 总览：开源能补什么、不能补什么

| 缺口域 | GitHub 密度 | 对益米的含义 |
|--------|-------------|--------------|
| A. 点读笔固件 / OID 产线 | **极稀** | 物理码与芯片几乎无现成开源全家桶 |
| B. 亲情音色 / 声音复刻 TTS | **极密** | 选型主战场；可定「本地弱 / 云强」阶梯 |
| C. 轻量 TTS（非复刻） | **密** | edge-tts/SAPI 已落地；本地候选需重新评估 Piper GPL 变化与 Kokoro |
| D. 内容安全过滤 | **中** | 有毒评论/PII 工具可借，**幼儿专用词表仍要自建** |
| E. 码与打印（通用条码） | **密但错位** | 二维码/PDF417 多；**OID 点码图案**几乎无开源 |
| F. 装包 / 音频打包 | **稀（旧货）** | TalkingPen 打包工具可参考形态，不可当现代栈 |
| G. MQTT / HA 桥 | **密** | 米家友好桥可抄模式，不必自研发现协议 |
| I. 绘本 DIY 图像管线 | **密但偏重** | 检测、分割、角色一致性组件齐；须组合成家长可编辑工作流 |
| J. 拍照识别与误识别安全 | **密** | 模型不是安全裁决；高风险物体必须走规则与家长确认门 |
| K. 交互式点读书格式先例 | **中** | Readium/H5P/TipToi 可借结构，不直接兼容其专有运行时 |
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
| [DreamXLong/OIDPen](https://github.com/DreamXLong/OIDPen) | 0 | — | 2026-07 复核新增命中；仓库仅约 5KB、无有效实现，**不可用** |
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
| 年代 | 主要内容为 ~2013–2015；最后代码推送 2015-12-08 → 许可与驱动过时风险高 |

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

> 2026-07-26 复核：TalkingPen 仍为 5 stars，最后代码推送仍停在 2015 年；补搜 `OID pen` 等关键词没有发现可作为 Gen1 底座的新项目。新增的 `DreamXLong/OIDPen` 为空壳级仓库，不改变“物理 OID 仍需方案商 RFQ”的结论。

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
| **L0 系统音** | 已实现 edge-tts / Windows SAPI；本地候选 Kokoro 或 piper1-gpl | CPU 手机/PC | 先合成并缓存；不像爸妈 | 默认、无档案 |
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
| [rany2/edge-tts](https://github.com/rany2/edge-tts) | ~11.6k | 主体 LGPL-3.0 | 当前 L0 已实现；调用微软在线语音，需持续复核服务条款与稳定性 |
| Windows SAPI | 系统能力 | 随 Windows | 当前离线降级路径；中文音色取决于系统语言包 |
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | ~8.1k | Apache-2.0 | 82M 级本地模型，含中文路径；需实测音质、CPU 延迟及模型权重条款 |
| [rhasspy/piper](https://github.com/rhasspy/piper) | ~11.3k | MIT，**已归档** | 原仓只读，README 已指向后继仓；仅作历史参考 |
| [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) | ~4.9k | **GPL-3.0** | Piper 活跃后继；嵌入/分发前须评估 GPL 边界及各 voice 模型许可 |

**选型建议：**

- Gen0 保持现有 `edge-tts -> Windows SAPI` 阶梯，真实音频缓存后再入笔。
- Gen1 本地 L0 优先做 Kokoro 中文 CPU 基准；Piper 后继作为 GPL 隔离方案评估，不直接并入 Apache-2.0 主发行物。
- edge-tts 不作为唯一生产路径；在线服务变化时，已缓存内容与 SAPI 降级仍可播放。

**行动项 C：** 保持 `scripts/tts-l0.mjs` 的后端接口，增加 Kokoro 探测/基准适配器；若试验 piper1-gpl，放在独立进程或独立发行物中，并记录 voice 模型许可。

---

## 4. 域 D · 内容安全 / 过滤

| 项目 | Stars | 用途 | 局限 |
|------|------:|------|------|
| [unitaryai/detoxify](https://github.com/unitaryai/detoxify) | ~1.3k | 英文毒评分类 | **中文幼儿词表弱** |
| [presidio](https://github.com/data-privacy-stack/presidio) | ~10k | PII 脱敏 | 偏隐私，不治惊吓故事 |
| [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon) | ~3.9k | 通用中文敏感词库（MIT） | 可作词源参考，缺幼儿年龄档与药物/清洁剂风险分类 |
| Llama-Guard 等 | 生态散 | LLM 护栏 | 重、要 API |

**结论：**  
开源给的是「成人社区毒评/PII」能力，**益米必须自建：**

- 中文幼儿黑名单词表（惊吓、死亡细节、性、毒品、广告诱导）  
- 高风险物体标签表（药/清洁剂）— 已在 safety 理论  
- 年龄档规则引擎（轻量 if-else 即可 Gen1）

**行动项 D：**  
1. 新建 `packages/safety-lite` 或 `content/safety/lexicon-zh.json` 骨架（词表 + `riskClass` + `ageBand` + `source`）。
2. 从通用中文词库筛选并人工复核，不整库直接进入儿童默认规则。
3. Detoxify 仅作英文包可选；Presidio 只负责 PII，二者都不作为幼儿安全总开关。

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

## 8. 域 I · 绘本 DIY 图像管线（新增）

> 对应 `gaps.md` 的拍照成书、热区生成、打印套准，以及 theory 的双 DIY 路径 B。

| 项目 | Stars（约） | 许可 | 可借鉴能力 | 边界 |
|------|------------:|------|------------|------|
| [IDEA-Research/GroundingDINO](https://github.com/IDEA-Research/GroundingDINO) | ~10.4k | Apache-2.0 | 文本提示的开放词汇目标检测 | 偏 GPU/服务端；输出候选框，不是成书工具 |
| [facebookresearch/segment-anything](https://github.com/facebookresearch/segment-anything) | ~54.6k | Apache-2.0 | 从点/框生成精细 mask，可转热区 polygon | 模型较重；家长端仍需编辑与确认 |
| [HVision-NKU/StoryDiffusion](https://github.com/HVision-NKU/StoryDiffusion) | ~6.4k | Apache-2.0 | 多页角色一致性与故事图生成参考 | 生成链重，不应进入点读实时路径 |
| [TencentARC/PhotoMaker](https://github.com/TencentARC/PhotoMaker) | ~10.1k | 仓库 API 未明确 | 用参考照片保持人物身份的生成路径 | 家庭照片与权重条款需单独核验 |

**结论：** 开源组件能填补「拍照命名、候选框、精细热区、角色一致性」的局部步骤，但没有一个仓库直接等于益米的“拍照成书”。正确形态是可替换流水线：

```text
原图导入 -> 方向/裁切校正 -> 候选检测 -> 可选分割
        -> 家长改名/删框/调热区 -> 预听与安全确认
        -> book.json + preview + audio -> 打包
```

**行动项 I：**

1. 先做纯手工热区编辑 MVP，再把检测/分割作为“建议”接入，模型失败时工作流仍完整。
2. 增加 `draft-book.json` 草案：保存 `sourceImageHash`、候选 `bounds/polygon`、`label`、`confidence`、`modelRef` 与 `reviewState`。
3. 生成图片与家庭照片默认留在家庭库；上传云模型、发布社区 Pack 均需单独确认。

---

## 9. 域 J · 拍照识别 + 误识别安全（新增）

> 对应 `safety.md` 的药盒误认成果汁等高风险场景。模型置信度只表示模型把握，不表示儿童场景安全。

| 项目 | Stars（约） | 许可 | 适用点 | 风险 |
|------|------------:|------|--------|------|
| [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe) | ~36.3k | Apache-2.0 | 手机端/跨平台视觉任务与轻量推理 | 现成通用模型不覆盖益米风险分类 |
| [IDEA-Research/GroundingDINO](https://github.com/IDEA-Research/GroundingDINO) | ~10.4k | Apache-2.0 | 用中文/英文风险词提示发现开放类别 | 开放词汇结果仍会漏检和误检 |
| [ultralytics/ultralytics](https://github.com/ultralytics/ultralytics) | ~59.9k | AGPL-3.0 | 检测/分割基线和训练工具丰富 | 产品集成前须处理 AGPL 或商业许可 |

**推荐安全门：**

1. 模型只产生候选标签、框和置信度，默认状态为 `unreviewed`。
2. 候选标签同时经过本地高风险类别表：药品、清洁剂、刀具、火源、成人用品等。
3. 命中高风险类别或标签冲突时，禁止自动生成拟人化食用文案，只显示固定警示模板供家长选择。
4. 家长确认后才生成 Clip 并进入装包；记录模型版本、原候选和最终人工标签。
5. 发布前用独立误识别集验证，指标至少区分普通 top-1、危险类漏检率和危险类误放行率。

**行动项 J：** 在 `packages/safety-lite` 先实现与模型无关的 `assessObject(candidate)`；建立药盒、清洁剂、食品、玩具等最小回归图片集，再比较 MediaPipe、本地小模型和服务端开放词汇模型。

---

## 10. 域 K · 交互式点读书格式先例（新增）

| 项目/规范实现 | Stars（约） | 许可 | 可借鉴 | 不直接复用 |
|---------------|------------:|------|--------|------------|
| [readium/webpub-manifest](https://github.com/readium/webpub-manifest) | ~118 | BSD-3-Clause | JSON manifest、reading order、resources、链接关系 | 没有 OID、热区和点读播放策略 |
| [h5p/h5p-interactive-book](https://github.com/h5p/h5p-interactive-book) | ~27 | MIT | 页面聚合、交互内容类型、作者工具思路 | 面向浏览器/LMS，运行时远重于笔端 |
| [entropia/tip-toi-reveng](https://github.com/entropia/tip-toi-reveng) | ~867 | MIT | GME 中 OID、脚本、音频索引的既有点读格式研究 | 面向 TipToi 兼容与逆向，不作为益米格式或固件依赖 |
| [jovermann/ogg2gme](https://github.com/jovermann/ogg2gme) | 1 | 未明确 | 音频集合、OID 图案与单文件打包的 legacy 形态 | 维护弱、许可不清、绑定专有 GME 生态 |

**对益米 Pack 的启发：**

- 保留 Readium 式 `metadata + readingOrder + resources`，但继续使用益米自己的 `pages[].hotspots[]`。
- 热区行为显式保存 `oid/bounds/polygon -> clips + playPolicy`，不要把逻辑埋进文件名或设备脚本字节码。
- 作者态允许丰富草稿，设备态编译为只读索引；二者以版本化 schema 和迁移器衔接。
- 外部格式只做导入器或研究参考，不承诺直接播放商业书库或兼容其硬件。

**行动项 K：** 在 `docs/content-format.md` 后续版本中补 `resources`、`readingOrder`、`schemaVersion` 与导入 provenance；用一个两页绘本做“作者态 JSON -> 设备快照”黄金样例。

---

## 11. 域 H · 不在 GitHub 的「数值与行动」

| 项 | 建议行动 | 不靠 GH |
|----|----------|---------|
| 商标「益米」「Yimi」 | 中国商标网检索 + 代理申请 | ✓ |
| 童锁 dB | 送检或简易声级计标定，写入规格 | ✓ |
| 3C/电玩具 | 咨询检测机构清单与周期 | ✓ |
| OID 授权费 | 方案商 RFQ | ✓ |
| 食品级背胶 | 材料商规格书 + 必要时检测 | ✓ |
| 声音权条款 | 律师审 ToS 模板 | ✓ |

---

## 12. 综合推荐：近 90 天技术路线（可执行）

```
W1–2  加固已实现的 edge-tts/SAPI L0；记录缓存、断网与中文音色基线
W3–4  Kokoro 中文 CPU 基准 + safety-lite 词表/高风险物体规则骨架
W5–8  手工热区编辑 MVP + draft-book.json；检测/分割只作可撤销建议
并行  商标检索；方案商 OID 询价；pack checksum
W9–12 OpenVoice 或 CosyVoice 本地复刻 PoC（缓存 mp3）+ 拍照误识别回归集
之后  作者态到设备快照黄金样例；QR 调试贴纸；MQTT 按需
```

**刻意不做：** 把 GPT-SoVITS 打进笔固件；把 piper1-gpl 直接并入 Apache-2.0 主发行物；依赖空壳 OID 仓库；把 TalkingPen DLL 链进主仓；让视觉模型未经家长确认直接写入点读内容。

---

## 13. 候选依赖许可速查（接入前再核）

| 组件 | SPDX/备注 | 接入姿态 |
|------|-----------|----------|
| edge-tts | 主体 LGPL-3.0；另受在线服务条款影响 | 保持可替换 CLI 后端，不作为唯一生产路径 |
| Kokoro | Apache-2.0；模型权重/音色另核 | 本地 L0 优先基准候选 |
| rhasspy/piper | MIT，已归档 | 历史参考，不再作为新集成目标 |
| OHF-Voice/piper1-gpl | **GPL-3.0**；voice 模型逐一核 | 独立进程/独立发行物评估 |
| GPT-SoVITS | MIT | PoC OK |
| OpenVoice | MIT | PoC OK |
| CosyVoice | Apache-2.0 | 优先核权重 |
| fish-speech | NOASSERTION | **先读 LICENSE 全文** |
| GroundingDINO / SAM / MediaPipe | Apache-2.0 | 图像候选流水线可评估 |
| Ultralytics | AGPL-3.0 / 商业许可 | 产品集成前先定许可路径 |
| Sensitive-lexicon | MIT | 仅作词源，人工筛选后导入 |
| Readium WebPub Manifest | BSD-3-Clause | 格式结构参考 |
| H5P Interactive Book | MIT | 作者工具与交互结构参考 |
| tip-toi-reveng | MIT | 只读研究点读格式先例 |
| TalkingPen | 未清晰 | **只读不链** |

---

## 14. 与益米仓库的映射

| 调研结论 | 落点 |
|----------|------|
| 逻辑 OID 自研 | 已有 `DiyBindStore` |
| VoiceProfile | 已有模型；接 L1/L2 后端 |
| 系统音 L0 | `scripts/tts-l0.mjs` 已实现 edge-tts/SAPI；后端接口可接 Kokoro 基准 |
| 安全词表 | 待建 `packages/safety-lite` 或 `content/safety/lexicon-zh.json` |
| 绘本 DIY 图像管线 | `apps/companion-app` 待实现手工热区编辑；先定义 `draft-book.json` |
| 拍照误识别安全 | `packages/safety-lite` 待实现 `assessObject` 与危险类回归集 |
| 交互书格式先例 | 已有 `Book/Page/Hotspot` 与 Pack 规范；待补 `schemaVersion/resources/readingOrder/provenance` |
| 物理 OID | 仓外 RFQ |
| 装包工具 | 形态参考 TalkingPen，实现自研 |

---

## 15. 修订

| 版本 | 说明 |
|------|------|
| 2026-07-24 | 首版 GitHub 细分调研 |
| 2026-07-26 | 复核域 A；更新 Piper 归档与 GPL 后继、edge/SAPI/Kokoro L0 阶梯；补中文词库；新增域 I/J/K；同步路线、许可与仓库映射 |

**声明：** Star 数为检索当日近似值；项目许可与模型权重以仓库当时文件为准，接入前复查。
