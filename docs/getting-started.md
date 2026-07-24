# Getting Started · 益米点读笔

开源幼儿 IP 点读（小鸡球球 / 宝贝 JoJo 向）+ 社区主题包。

## 环境

- Node.js ≥ 18  
- npm 9+  

## 安装

```bash
cd yimi-pen
npm install --include=dev
```

## 设备模拟器

```bash
npm run dev:sim
```

```text
books
diy
tap oid:YIMI-DIY-BANANA
bind YIMI-DIY-001 水杯 咕咚咕咚喝水啦
say  YIMI-DIY-001 我是小水杯
tap oid:YIMI-DIY-001
tap oid:JOJO-0101
mode free
```

DIY 绑定见 [diy-bind.md](./diy-bind.md)。

### L0 系统音（真出声）

```bash
pip install edge-tts
npm run diy:speak -- --oid YIMI-DIY-BANANA
npm run dev:sim
# tap oid:YIMI-DIY-BANANA
```

详见 [tts-l0.md](./tts-l0.md)。

WebSocket：`ws://127.0.0.1:7788`

## 内容台

```bash
npm run dev:admin
```

http://127.0.0.1:5173

## 校验图书

```bash
npm run validate:books
```

## 社区投稿

见 [pack-spec.md](./pack-spec.md) 与根目录 `CONTRIBUTING.md`。

## 商标提醒

本项目非小米/米家官方产品。表述规范见 [mi-home-friendly.md](./mi-home-friendly.md)。
