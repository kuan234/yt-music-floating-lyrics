# Architecture Design

## 1. 数据流

```text
[Chrome + YouTube Music]
   -> (content script)
   -> (background/service worker)
   -> local IPC (WebSocket / Native Messaging)
   -> [Native Host]
   -> [Overlay App]
   -> render floating lyrics
```

### 关键点
- 扩展侧只做**采集和上报**，不做重量逻辑。
- 歌词检索、缓存、同步算法放在本地端，降低浏览器负担。
- 悬浮窗仅订阅「已处理事件」，减少 UI 层复杂度。

---

## 2. 模块划分

### A. Chrome Extension

**职责**
- 采集：title/artist/currentTime/isPlaying/trackChange
- 去抖与去重：500ms 内重复事件合并
- 连接管理：本地服务不可达时指数退避重连

**稳定性策略**
- 优先 `MediaSession` 读取元数据
- DOM 作为 fallback
- `MutationObserver` 监听换歌

### B. Native Host (轻量桥接服务)

**职责**
- 接收扩展事件
- 维护歌曲状态机
- 管理歌词 providers + cache
- 推送同步后的歌词行给 overlay

**建议实现**
- Node.js（快速 MVP）或 Rust（更低内存）
- 单进程事件循环，避免多进程开销

### C. Overlay App（悬浮窗）

**职责**
- 始终置顶显示歌词
- 支持透明背景、描边、阴影、缩放
- 支持 click-through 模式

**渲染策略**
- 行变化时刷新，不做持续高频重绘
- 目标帧率 15~30fps（够用且省电）

---

## 3. 歌词系统设计（中/英/日）

### Provider 抽象
统一接口：

```ts
interface LyricsProvider {
  search(song: SongMeta): Promise<Candidate[]>;
  fetch(candidateId: string): Promise<TimedLyric>;
}
```

### 匹配策略
- 标题标准化：去掉 `(Live)`, `(Remix)`, `feat.` 等噪音
- 歌手标准化：符号统一、全半角处理
- 评分：`title 60% + artist 30% + duration 10%`

### 结果缓存
- 内存 LRU（最近 100 首）
- 可选磁盘缓存（SQLite）
- 缓存命中优先，避免重复请求

---

## 4. 同步算法

- 输入：`currentTime` + 时间戳歌词行
- 查找：二分定位当前行
- 抖动控制：
  - 时间偏移可调（-500ms ~ +500ms）
  - 只在跨行时触发 UI 更新

---

## 5. 低 RAM 设计

1. 扩展 service worker 无任务即休眠。
2. Native Host 使用流式处理，不保留大对象。
3. Overlay 限制字体资源与纹理缓存大小。
4. 所有网络请求设超时（2~5 秒）并可取消。
5. 降级策略：歌词不可用时显示歌曲信息，不阻塞主流程。

---

## 6. 容错与可观测性

- 每个模块有健康状态：`ok/degraded/down`
- 最少日志字段：`songId`, `provider`, `latency`, `cacheHit`
- 崩溃恢复：
  - 扩展重连本地服务
  - 本地服务重启后恢复最近播放状态

---

## 7. 安全与合规（工程层面）

- 最小权限原则：扩展只申请 YouTube Music 域名权限
- 本地端端口仅监听 localhost
- 禁止上传用户播放历史（默认本地处理）

---

## 8. 已落地的 MVP 接口（当前仓库）

### Native Host API

- `POST /event`
  - 输入：扩展上报播放事件
  - 返回：`202 accepted`
- `GET /stream`
  - SSE 实时流，向 overlay 推送 `LYRICS_TICK`
- `GET /health`
  - 健康检查与在线客户端数

### 事件格式（简化）

```json
{
  "title": "Song Name",
  "artist": "Artist",
  "currentTimeSec": 12.34,
  "isPlaying": true,
  "observedAt": 1760000000000
}
```

### 说明

- 当前歌词使用 mock（含中/英/日示例行）以验证实时同步链路。
- 下一阶段替换为真实 provider，并保留接口不变。
