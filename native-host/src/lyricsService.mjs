import { StaticLyricsProvider } from "./providers/staticLyricsProvider.mjs";

export class LyricsService {
  constructor() {
    this.provider = new StaticLyricsProvider();
    this.cache = new Map();
    this.cacheSize = 100;
  }

  _songKey(song) {
    return `${(song.title || "").trim().toLowerCase()}::${(song.artist || "").trim().toLowerCase()}`;
  }

  _setCache(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);

    if (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  async getLyrics(song) {
    const key = this._songKey(song);
    if (this.cache.has(key)) return this.cache.get(key);

    const found = await this.provider.findLyrics(song);
    const lines = found || [{ startMs: 0, text: `${song.title} - ${song.artist}` }];

    this._setCache(key, lines);
    return lines;
  }

  currentLine(lines, currentTimeSec) {
    const currentMs = Math.floor((currentTimeSec || 0) * 1000);
    let left = 0;
    let right = lines.length - 1;
    let answer = 0;

    while (left <= right) {
      const mid = (left + right) >> 1;
      if (lines[mid].startMs <= currentMs) {
        answer = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return lines[answer]?.text || "";
  }
}
