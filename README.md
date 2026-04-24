# YouTube Music Floating Lyrics (Windows 11)

一个面向 **Windows 11** 的低资源占用「悬浮歌词」项目（进行中）：
- 在 Chrome 中播放 YouTube Music 时实时捕捉歌曲状态。
- 在系统级悬浮窗显示同步歌词（中 / 英 / 日）。
- 优先追求稳定性与低内存占用（RAM）。

## 当前进度

✅ 已实现 MVP 原型链路：
1. Chrome 扩展采集播放状态并上报到 localhost。
2. 本地 Host 服务接收事件并输出 SSE 流。
3. Overlay 原型页面订阅 SSE 并实时显示当前歌词行。
4. 新增静态歌词 Provider（本地 JSON）+ LRU 缓存 + 二分查找同步。

> 当前歌词源是本地静态数据（`native-host/data/lyrics.json`），用于先完成稳定链路和低资源验证。

> 当前歌词为 mock 数据，用于先打通稳定链路；下一步接入真实歌词 provider。

## 目录结构

- `chrome-extension/`
  - `manifest.json`、`content.js`、`background.js`
- `native-host/`
  - `src/server.mjs`（轻量 HTTP + SSE 服务）
  - `src/lyricsService.mjs`（缓存与同步）
  - `src/providers/staticLyricsProvider.mjs`（本地歌词源）
  - `data/lyrics.json`（示例中/英/日歌词）
- `overlay-app/`
  - `index.html`、`styles.css`、`overlay.js`
  - `serve-overlay.mjs`（本地静态页面服务）
- `docs/`
  - 设计文档与里程碑

---

## 超详细使用说明（Windows + Chrome）

> 你刚提到不清楚怎么在 Chrome 打开 `index.html`，下面给你两种方式：**推荐方式 A（本地服务）**。

### 0) 前置条件

1. 安装 Node.js 18+（建议 LTS）
2. 使用 Chrome 浏览器
3. 可以访问 `https://music.youtube.com`

### 1) 启动本地 Host（必须）
- `overlay-app/`
  - `index.html`、`styles.css`、`overlay.js`
- `docs/`
  - 设计文档与里程碑

## 快速启动

### 1) 启动本地 Host

```bash
cd native-host
npm run start
```

看到下面日志说明成功：

```text
[native-host] listening on http://127.0.0.1:42819
```

可选健康检查：
默认监听：`http://127.0.0.1:42819`

健康检查：

```bash
curl http://127.0.0.1:42819/health
```

### 2) 安装 Chrome 扩展（必须）

1. 在 Chrome 地址栏输入：`chrome://extensions`
2. 右上角打开「开发者模式」
3. 点击左上角「加载已解压的扩展程序」
4. 选择项目目录里的 `chrome-extension/`
5. 确认扩展已启用（开关为 On）

### 3) 打开 Overlay 页面（两种方式）

#### 方式 A（推荐）：本地页面服务打开

> 这是最稳定、最不容易踩坑的方式。

新开一个终端执行：

```bash
cd overlay-app
npm run start
```

看到日志：

```text
[overlay] open http://127.0.0.1:43100
```

然后在 Chrome 打开：

```text
http://127.0.0.1:43100
```

---

#### 方式 B（直接打开文件）

你也可以直接把下面路径拖进 Chrome：

```text
<项目绝对路径>/overlay-app/index.html
```

比如（示例）：

```text
file:///C:/your-folder/yt-music-floating-lyrics/overlay-app/index.html
```

如果这种方式打不开或不稳定，改用方式 A。

### 4) 实际运行验证

1. 打开 `https://music.youtube.com`
2. 播放任意歌曲
3. 切回 Overlay 页面（`http://127.0.0.1:43100`）
4. 你应看到：
   - 顶部显示：`▶ artist · title · xx.xs`
   - 下方显示实时歌词行

---

## 常见问题（你现在最可能遇到）

### Q1: Chrome 不知道怎么打开 index.html

直接用 **方式 A**：
1. `cd overlay-app && npm run start`
2. Chrome 输入 `http://127.0.0.1:43100`

### Q2: Overlay 页面显示 `Disconnected. Retrying...`

说明 Host 没启动或端口不通：
- 确认 `native-host` 终端还在运行
- 确认 `http://127.0.0.1:42819/health` 能返回 JSON

### Q3: 页面开了但没歌词

按顺序排查：
1. 扩展是否已加载并启用
2. 当前页面是否是 `music.youtube.com`
3. 是否真的在播放（不是暂停）
4. 歌曲是否命中本地静态歌词库（`native-host/data/lyrics.json`）

---

## 性能与稳定策略（当前实现）

- 扩展优先读取 `<video>/<audio>` currentTime，减少频繁 DOM 解析。
- Background 只保留最新事件（coalescing），降低重试队列内存。
- Host 仅缓存最近歌曲歌词（LRU，默认 100 条）。
- 歌词定位使用二分查找，避免逐行扫描开销。
### 2) 加载 Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 选择「加载已解压的扩展程序」
4. 指向 `chrome-extension/`

### 3) 打开 Overlay 原型

直接用浏览器打开 `overlay-app/index.html`，然后在 YouTube Music 播放歌曲。

## 性能与稳定策略（MVP）

- 扩展每 500ms 采样并去重，减少消息风暴。
- Host 只维护最近歌曲状态，避免无界内存增长。
- Overlay 只在歌词行变化时更新文本。
- 全部通信走 `localhost`，最小化权限与安全面。

## 下一步

1. 接入真实歌词 provider（多源 + 评分匹配）
2. 增加磁盘缓存（SQLite）
3. 做 Windows 透明置顶窗口封装（Tauri/Electron）
4. 完成内存与 CPU 压测基线

---

详见：
- [架构设计](docs/ARCHITECTURE.md)
- [稳定性与低 RAM 清单](docs/STABILITY_RAM_GUIDE.md)
- [里程碑规划](docs/MILESTONES.md)
