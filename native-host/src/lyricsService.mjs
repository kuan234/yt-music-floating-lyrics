import { createLoadingLyricsResult, createMissingLyricsResult } from "./lyricsUtils.mjs";
import { LrcLibProvider } from "./providers/lrcLibProvider.mjs";
import { StaticLyricsProvider } from "./providers/staticLyricsProvider.mjs";

export class LyricsService {
  constructor() {
    this.providers = [new LrcLibProvider(), new StaticLyricsProvider()];
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

  peekLyrics(song) {
    return this.cache.get(this._songKey(song)) || null;
  }

  loadingLyrics() {
    return createLoadingLyricsResult();
  }

  async getLyrics(song) {
    const key = this._songKey(song);
    if (this.cache.has(key)) return this.cache.get(key);

    for (const provider of this.providers) {
      try {
        const found = await provider.findLyrics(song);
        if (!found?.lines?.length) continue;

        this._setCache(key, found);
        return found;
      } catch (error) {
        console.warn("[lyrics] provider failed", error);
      }
    }

    const missing = createMissingLyricsResult();
    this._setCache(key, missing);
    return missing;
  }

  currentLineIndex(lines, currentTimeSec) {
    if (!Array.isArray(lines) || !lines.length) return -1;

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

    return answer;
  }

  currentLine(lines, currentTimeSec) {
    const answer = this.currentLineIndex(lines, currentTimeSec);
    if (answer < 0) return "";
    return lines[answer]?.text || "";
  }
}
