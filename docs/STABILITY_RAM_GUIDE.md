# Stability & RAM Guide

## 稳定性清单

- [ ] 采集层双通道：MediaSession + DOM fallback
- [ ] 所有 IPC 消息可幂等处理（重复消息不影响状态）
- [ ] 网络请求都有 timeout + retry + breaker
- [ ] provider 故障自动切换到下一个源
- [ ] 缓存损坏可自动重建
- [ ] 歌词缺失时优雅降级为「仅歌曲信息」

## RAM 优化清单

- [ ] 使用 LRU 缓存，限制最大条目
- [ ] 避免 JSON 大对象长期持有（处理后立即释放）
- [ ] Overlay 只保留当前/上一/下一歌词行
- [ ] 减少不必要动画与重绘
- [ ] 定期采样内存指标，超过阈值触发软重置

## 监控指标（MVP）

- extension_event_rate（每秒事件数）
- host_latency_ms（歌词检索与同步耗时）
- cache_hit_ratio（缓存命中率）
- overlay_render_count（每分钟重绘次数）
- rss_mb（各进程常驻内存）

## 建议阈值

- 事件速率：`<= 4 / sec`
- 歌词检索 p95：`< 1200ms`
- Overlay 重绘：`<= 30fps`，通常应明显低于该值
- 进程重启恢复时间：`< 3s`
