# L1 亲情音色复刻 · PoC

> 状态：接口 + 探测骨架（2026-07-24）  
> 上级：调研 [research/github-survey-2026.md](./research/github-survey-2026.md) 域 B；产品 [voice-profile.md](./voice-profile.md)  
> **不**替代 L0；**不**进笔端实时推理。

---

## 目标

```
VoiceProfile 样本 wav
    → L1 后端（OpenVoice / CosyVoice / GPT-SoVITS 等）
    → 缓存 mp3/wav
    → DIY clip.uri（与 L0 相同消费路径）
```

验收（PoC）：

1. CLI 能说明缺什么依赖  
2. 有样本路径 + 文本时，**若后端已装**则产出音频  
3. 未装后端时 **明确失败**，自动可回落 L0（diy-speak）  
4. 不破坏 `npm run diy:speak`（L0）

---

## 阶梯回顾

| 级 | 含义 | 状态 |
|----|------|------|
| L0 | 系统音 edge-tts / SAPI | **已交付** `docs/tts-l0.md` |
| L1 | 本地/侧车复刻 | **本 PoC** |
| L2 | 云 API 复刻 | 未做 |

笔侧原则不变：只播**已缓存**文件（H8）。

---

## 命令

```bash
# 探测后端
npm run tts:l1 -- --probe

# 复刻合成（需已安装可选后端 + 参考音频）
npm run tts:l1 -- --text "我是香香的香蕉" --ref content/audio/voices/voice-mom/sample-1.wav --out content/audio/diy/cache/l1-demo.wav

# 指定后端
npm run tts:l1 -- --backend openvoice --text "..." --ref sample.wav --out out.wav
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `YIMI_L1_BACKEND` | `auto` \| `openvoice` \| `cosyvoice` \| `gpt-sovits` \| `none` |
| `YIMI_L1_PYTHON` | Python 可执行文件，默认 `python` |

---

## 后端状态（PoC）

| backend | 脚本 | 说明 |
|---------|------|------|
| `openvoice` | `scripts/l1/backends/openvoice_infer.py` | 若 `import openvoice` 成功则调；否则 exit 2 |
| `cosyvoice` | `scripts/l1/backends/cosyvoice_infer.py` | 同上，占位探测 |
| `gpt-sovits` | `scripts/l1/backends/gptsovits_infer.py` | 占位；需用户自备 WebUI/API |
| `none` | — | 仅探测，不合成 |

安装示例（**可选、体积大、可能要 GPU**，勿写进默认 `package.json` deps）：

```bash
# 仅文档示例 — 请按上游 README 安装，勿盲装
# OpenVoice / CosyVoice 见各自 GitHub
```

---

## 与 VoiceProfile 对齐

`content/diy/voices.json`：

- `samples[].uri` → 相对 `content/audio/`  
- `status: ready` 且有样本才建议跑 L1  
- 合成结果仍写 `content/audio/diy/cache/`，`bindings.json` 的 `uri` 指向缓存文件  

L1 成功时 clip 可带 `voiceProfileId`；失败则：

```bash
npm run diy:speak -- --oid <oid>   # L0 回落
```

---

## 安全（强制）

- 录入与合成前须 `consentAt`（产品层；脚本可 `--require-consent` 检查 voices.json）  
- 不把参考音频默认上传公共仓  
- 禁止用公开人物声做官方样例  

---

## 非目标（PoC）

- 笔内实时克隆  
- 默认 `npm install` 拉齐全部 ML 依赖  
- 宣称「已像妈妈 95 分」无听感验收  

---

## 下一步（PoC 之后）

1. 选一台有 GPU 的机器按上游装好 OpenVoice 或 CosyVoice  
2. 填 `samples` 真 wav + `voice consent`  
3. 接通 `diy-speak --engine l1`  
4. 家长听感 ≥3 分才标 profile ready  
