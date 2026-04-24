# Architecture Design

## 1. 数据流（当前实现）

```text
[Chrome + YouTube Music]
   -> (content script)
   -> (background/service worker)
   -> HTTP POST /event (localhost)
   -> [Native Host]
   -> SSE /stream
   -> [Overlay App]
```

### 关键点
- 扩展侧只做采集和上报，不放重量逻辑。
- 歌词 provider、缓存、同步算法都在本地 Host。
- Overlay 仅渲染最终行文本，保持低内存占用。

---

## 2. 模块划分

### A. Chrome Extension
- `content.js`
  - 优先读取 `video/audio.currentTime`。
  - `MediaSession` + DOM fallback 读取歌曲元信息。
  - 500ms 采样 + 去重。
- `background.js`
  - 转发 `PLAYBACK_EVENT` 到 localhost。
  - 指数退避重试。
  - 只保留最新事件（coalescing）防止队列膨胀。

### B. Native Host
- `server.mjs`
  - `POST /event`：接收播放状态。
  - `GET /stream`：SSE 推送歌词行。
  - `GET /health`：健康与指标。
- `lyricsService.mjs`
  - LRU 缓存（默认 100）。
  - 二分查找当前行。
- `staticLyricsProvider.mjs`
  - 从本地 `data/lyrics.json` 匹配歌曲并返回时间轴歌词。

### C. Overlay App
- `overlay.js`
  - 订阅 SSE，展示歌曲信息与当前歌词。
  - 在短时无消息时进行轻量本地时钟推进（500ms）。

---

## 3. 低 RAM 设计（已落地）

1. 扩展只发送去重后的事件。
2. Background 仅保留一条“最新待发送事件”。
3. Host 使用有限 LRU 缓存。
4. 同步算法用二分查找，避免 O(n) 全量扫描。
5. Overlay 只更新必要文本节点。

---

## 4. API 合约

### POST /event

```json
{
  "title": "Song Name",
  "artist": "Artist",
  "currentTimeSec": 12.34,
  "isPlaying": true,
  "observedAt": 1760000000000
}
```

返回：`202 { "ok": true }`

### GET /stream
- SSE 事件：`CONNECTED` / `SNAPSHOT` / `LYRICS_TICK`

### GET /health
- 返回在线客户端数与事件指标。

---

## 5. 下一阶段

1. 替换静态 provider 为真实在线 provider（多源评分）。
2. 增加磁盘缓存（SQLite）。
3. 接入 Windows 置顶透明窗口容器（Tauri/Electron）。
