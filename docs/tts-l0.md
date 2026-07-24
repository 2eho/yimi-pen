# L0 系统音 TTS（已实现）

对照调研 [research/github-survey-2026.md](./research/github-survey-2026.md)：  
**L0 = 系统音（快、不像爸妈）** → 真文件缓存 → 笔/模拟器离线播。

## 依赖

```bash
pip install edge-tts
# 可选：系统已装中文 SAPI 时，可 --engine sapi 离线
```

## 命令

```bash
# 单句合成
npm run tts -- --text "我是香香的香蕉" --out content/audio/diy/cache/demo.mp3

# 给某个 DIY 绑定的全部 transcript 出声，并写回 bindings.json 的 uri
npm run diy:speak -- --oid YIMI-DIY-BANANA

# 全部绑定 + 合成后本机试听
npm run diy:speak -- --all --play
```

## 引擎

| engine | 说明 |
|--------|------|
| `auto`（默认） | 先 edge-tts，失败再 Windows SAPI |
| `edge` | 微软神经网络中文（需网络） |
| `sapi` | 本机 Speech API（离线，中文视系统语言包） |

## 与亲情音色关系

- L0 **不**做声音复刻；`voiceProfileId` 仅写入元数据，便于以后换 L1/L2。  
- L1/L2（GPT-SoVITS / CosyVoice / OpenVoice）见调研文档，尚未接入。

## 模拟器

合成后 `uri` 形如 `diy/cache/<hash>.mp3`。  
`npm run dev:sim` 再 `tap oid:YIMI-DIY-BANANA` 会走真实文件路径（Console 后端仍打印 play；可外接播放器）。
