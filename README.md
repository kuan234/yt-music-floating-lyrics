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

> 当前歌词为 mock 数据，用于先打通稳定链路；下一步接入真实歌词 provider。

## 目录结构

- `chrome-extension/`
  - `manifest.json`、`content.js`、`background.js`
- `native-host/`
  - `src/server.mjs`（轻量 HTTP + SSE 服务）
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

默认监听：`http://127.0.0.1:42819`

健康检查：

```bash
curl http://127.0.0.1:42819/health
```

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
