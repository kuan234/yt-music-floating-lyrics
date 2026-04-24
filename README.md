# YouTube Music Floating Lyrics (Windows 11)

一个面向 Windows 11 的低占用悬浮歌词原型：

- Chrome 扩展采集 `music.youtube.com` 的播放状态
- 本地 Host 接收事件、拉取同步歌词并通过 SSE 推送
- 桌面悬浮窗或浏览器 Overlay 实时显示 `artist / title / 当前秒数 / 当前歌词行`

## 当前状态

现在不是只吃本地 `lyrics.json` 了。

当前歌词策略是：

1. 优先从在线同步歌词源抓取带时间轴的原文歌词
2. 若在线源没有命中，再回退到本地样例歌词
3. 若两边都没有命中，Overlay 会显示 `No synced lyrics found.`

显示策略也已经改成：

- 华语歌显示华语原文
- 日语歌显示日语原文
- 英文歌显示英文原文
- 不额外做翻译
- Overlay 本地自己按时间轴推进，不再只靠 Host 每秒推一次当前行

## 目录结构

- `chrome-extension/`
  采集 YouTube Music 播放状态
- `native-host/`
  本地 HTTP + SSE 服务，以及歌词 provider / 缓存 / 同步逻辑
- `overlay-app/`
  浏览器中的 Overlay 页面和本地静态服务
- `desktop-overlay/`
  Windows 桌面透明置顶悬浮窗
- `scripts/smoke.mjs`
  一键本地联调验证

## 前置条件

1. 安装 Node.js 18+
2. 安装 Chrome
3. 能访问 `https://music.youtube.com`

## 常用命令

项目根目录执行：

```bash
npm run check
npm run start:host
npm run desktop
npm run start:overlay
npm run smoke
```

## 启动方法

### 方式 A（推荐）：桌面悬浮歌词

直接在项目根目录运行：

```bash
npm run desktop
```

预期日志：

```text
[desktop] reusing existing native host
[desktop] launching desktop overlay
```

你会得到一个：

- 在 Chrome 外部独立存在的桌面窗
- 默认半透明
- 默认点击穿透，不抢鼠标焦点
- 默认置顶，适合边用别的 app 边看歌词

桌面悬浮窗快捷键：

- `Alt+Shift+M`：切换点击穿透 / 可交互模式
- `Alt+Shift+Up`：提高不透明度
- `Alt+Shift+Down`：降低不透明度
- `Alt+Shift+C`：重置到底部居中
- `Alt+Shift+H`：隐藏 / 显示
- `Alt+Shift+Q`：退出桌面悬浮窗

### 方式 B：浏览器 Overlay（调试用）

#### 1) 启动 Host

```bash
npm run start:host
```

预期日志：

```text
[native-host] listening on http://127.0.0.1:42819
```

健康检查：

```bash
curl http://127.0.0.1:42819/health
```

#### 2) 启动 Overlay 本地页面服务

另开一个终端：

```bash
npm run start:overlay
```

预期日志：

```text
[overlay] open http://127.0.0.1:43100
```

然后在 Chrome 打开：

```text
http://127.0.0.1:43100
```

#### 3) 安装 Chrome 扩展

1. 打开 `chrome://extensions`
2. 打开右上角“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择项目里的 `chrome-extension/`
5. 确认扩展处于启用状态

#### 4) 打开 YouTube Music 并播放

1. 打开 `https://music.youtube.com`
2. 播放任意歌曲
3. 如果你走的是方式 A，就切回桌面上的悬浮歌词窗
4. 如果你走的是方式 B，就切回 `http://127.0.0.1:43100`

现在正常情况下你会看到：

- 顶部：`▶ artist · title · xx.xs`
- 下方：当前时间对应的歌词原文

如果在线同步歌词源命中，歌词会按时间轴实时变化。

桌面悬浮窗模式下，歌词会显示在 Chrome 外部；你切到其他窗口时它也会继续漂浮显示。

## 一键 Smoke Test

```bash
npm run smoke
```

这个命令会自动：

1. 启动 `native-host`
2. 启动 `overlay-app`
3. 订阅 `/stream`
4. 注入样例播放事件
5. 验证是否真正收到了歌词行

成功时会看到类似：

```text
[smoke] stream connected
[smoke] received line: ...
[smoke] pass
```

## 常见问题

### Chrome 不知道怎么打开 `index.html`

不用手动折腾 `file:///.../index.html`。

直接运行：

```bash
npm run start:overlay
```

然后在 Chrome 打开：

```text
http://127.0.0.1:43100
```

### Overlay 显示 `Disconnected. Retrying...`

按顺序检查：

1. `npm run start:host` 是否还在运行
2. `http://127.0.0.1:42819/health` 是否返回 JSON
3. 防火墙或安全软件是否拦截了本地端口

### 页面打开了但没有歌词

按顺序检查：

1. 扩展是否已正确加载
2. 当前页面是否真的是 `music.youtube.com`
3. 是否真的在播放而不是暂停
4. 当前歌曲是否被在线同步歌词源收录

需要说明的是：

- 现在已经不是“只支持预设两首歌”
- 但也还不能诚实地说“全世界任何歌都保证命中”
- 是否有同步歌词，仍然取决于在线歌词库本身是否收录

### 我想要在全屏 app 上面也看到歌词

当前桌面悬浮窗已经是 Windows 独立置顶窗，正常窗口和很多“无边框全屏”应用上都可以浮在上面。

但需要诚实说明：

- 对真正的独占全屏程序，是否还能压在最上层，仍然取决于 Windows 合成器、显卡驱动和具体应用本身
- 所以现阶段更稳的是普通窗口、最大化窗口、以及多数 borderless fullscreen 场景

## 目前已经验证过的方向

- 日语原文同步歌词
- 华语原文同步歌词
- 英文原文同步歌词
- Overlay 本地时间推进，切歌后不会沿用上一首歌的歌词
- Windows 独立桌面悬浮窗已跑通
- 默认半透明 + 默认点击穿透已跑通
- 已验证可显示在 Chrome 之外，并压在其他最大化窗口上方

## 下一步

1. 增加磁盘缓存（SQLite），减少重复查词等待
2. 增加更多歌词源，提高命中率
3. 打包成可双击启动的 Windows 应用 / 托盘程序
