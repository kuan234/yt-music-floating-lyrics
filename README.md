# YT Music Floating Lyrics

一个面向 Windows 11 的 YouTube Music 桌面悬浮歌词应用。

现在的默认形态已经不是“Chrome 扩展 + 手动起服务”了，而是：

- 一个 Electron 桌面应用
- 内置本地歌词服务
- 内置 YouTube Music 播放页
- 内置透明置顶悬浮歌词窗
- 可打包成单个 Windows 安装包

也就是说，给新手分发时，不再要求他们先装 Node.js、Python 或 Chrome 扩展。

## 现在的歌词策略

程序并不依赖 YouTube Music 自带歌词面板。

当前逻辑是：

1. 从播放器页面拿到 `title / artist / album / currentTime`
2. 优先去在线同步歌词源搜索带时间轴的歌词
3. 搜不到时，再回退到本地样例歌词
4. 如果两边都没有，Overlay 显示 `No synced lyrics found.`

为了提高命中率，现在在线搜索不只查一遍原始标题，而是会做多轮变体检索，例如：

- 去掉 `feat.`
- 去掉 `(Live)`、`(Remix)`、`(Official)` 之类噪音
- 拆分多歌手写法
- 尝试更干净的标题 / 歌手组合

所以如果 YouTube Music 自己没有歌词，只要外部同步歌词库里有带时间轴的版本，当前行仍然会按照**正在唱到的位置**实时推进。

需要诚实说明的是：

- 真正“和当前唱到的部分完全对齐”，前提仍然是拿到**带时间轴的同步歌词**
- 如果外部歌词库里也没有同步歌词，就没法准确知道当前应该显示哪一句

## 项目结构

- `desktop-overlay/`
  Electron 主进程、YouTube Music 窗口、悬浮窗、播放状态采集 preload
- `native-host/`
  本地歌词服务、SSE 推送、歌词 provider、缓存、同步逻辑
- `overlay-app/`
  悬浮歌词页
- `chrome-extension/`
  旧的浏览器调试方案，保留作历史兼容
- `scripts/smoke.mjs`
  本地联调验证

## 给终端用户的使用方式

### 直接安装

打包产物在：

- `dist/YT Music Floating Lyrics Setup 0.4.0.exe`

用户安装后，直接打开应用即可。

应用会：

- 打开一个 YouTube Music 桌面窗口
- 自动启动本地歌词服务
- 自动打开桌面悬浮歌词窗

### 桌面悬浮窗快捷键

- `Alt+Shift+M`：切换点击穿透 / 可交互模式
- `Alt+Shift+Up`：提高不透明度
- `Alt+Shift+Down`：降低不透明度
- `Alt+Shift+C`：重置到底部居中
- `Alt+Shift+H`：隐藏 / 显示悬浮窗
- `Alt+Shift+P`：唤回主播放器窗口
- `Alt+Shift+Q`：退出应用

## 开发环境

### 前置条件

1. Node.js 18+
2. Windows 11
3. 能访问 `https://music.youtube.com`

### 常用命令

```bash
npm run check
npm run desktop
npm run smoke
npm run pack
npm run dist:win
```

说明：

- `npm run desktop`
  启动桌面版。脚本会自动清掉 `ELECTRON_RUN_AS_NODE`，避免 Electron 被错误当成 Node 跑。
- `npm run smoke`
  验证本地歌词服务和 Overlay 链路。
- `npm run pack`
  输出 `dist/win-unpacked/`
- `npm run dist:win`
  输出单安装包 `.exe`

## 打包结果

当前已经验证通过：

- `npm run check`
- `npm run smoke`
- `npm run dist:win`
- 打包后的 `dist/win-unpacked/YT Music Floating Lyrics.exe` 可以正常启动

当前安装包文件：

- `dist/YT Music Floating Lyrics Setup 0.4.0.exe`

## 调试模式

如果只是想调歌词服务和 Overlay，不想开完整桌面应用，仍然可以使用：

```bash
npm run start:host
npm run start:overlay
```

然后打开：

```text
http://127.0.0.1:43100
```

## 常见问题

### 为什么有些歌还是没有歌词

因为当前显示的是“同步歌词”，不是普通纯文本歌词。

如果在线歌词库本身没有收录这首歌的时间轴歌词，程序就无法准确判断“现在唱到哪一句”。

### 为什么不是所有歌都能百分百命中

目前已经做了更积极的检索和匹配，但命中率仍然取决于：

- 歌名 / 歌手元数据是否规范
- 外部同步歌词库是否收录
- 收录的版本是否和当前播放版本接近

### 为什么保留了 `chrome-extension/`

它现在不是终端用户默认方案了。

保留它只是为了：

- 历史兼容
- 浏览器 Overlay 调试
- 对比旧链路行为

## 下一步

1. 增加更多同步歌词源，提高命中率
2. 增加磁盘缓存，减少重复检索等待
3. 增加设置页，让用户自己调字体、位置、透明度、偏移
4. 给安装包补上正式图标和应用资源
