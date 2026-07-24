# DIY 绑定（已实现 MVP）

贴纸 OID → 物体名 → 台词/录音 → 笔一点就响。

## 数据

```
content/diy/bindings.json
```

形状见 `DiyBindStore`（`@yimi-pen/core`）。

## 引擎

`PointReadEngine` 在 OID 查找时：

1. 书内 hotspot（默认优先）  
2. DIY bindings（书没有该 OID 时）  

`preferDiy: true` 时可反过来（一般不用）。

## 模拟器命令

```text
diy
bind YIMI-DIY-001 香蕉 我是一根香香的香蕉
say  YIMI-DIY-001 嘿，别捏软我
tap oid:YIMI-DIY-001
unbind YIMI-DIY-001
```

样例预置：`YIMI-DIY-BANANA`（香蕉）。

## Clip URI

| URI | 含义 |
|-----|------|
| `diy:tts:<id>` | 仅文案，模拟器打印「📢」并 stub 播放（无 mp3） |
| `diy/<oid>/xxx.mp3` | 真实文件，放在 `content/audio/` 下 |

## 亲情音色

贴纸可指定 `voiceProfileId`（妈妈/爸爸）。打字台词之后用该音色 TTS 复述。  
详见 [voice-profile.md](./voice-profile.md)。

```text
voices
voice set YIMI-DIY-BANANA voice-mom
bind YIMI-DIY-002 小熊 晚安 @voice-mom
```

## 下一步（未做）

- 麦克风录入样本（真 wav）  
- 真·声音复刻 TTS  
- 家长端 UI  
- 拍照填 objectTag  
