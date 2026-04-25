import os from "node:os";
import path from "node:path";
import { createLoadingLyricsResult, createMissingLyricsResult } from "./lyricsUtils.mjs";
import { LyricsCacheStore } from "./lyricsCacheStore.mjs";
import { KugouProvider } from "./providers/kugouProvider.mjs";
import { LrcLibProvider } from "./providers/lrcLibProvider.mjs";
import { QqMusicProvider } from "./providers/qqMusicProvider.mjs";
import { StaticLyricsProvider } from "./providers/staticLyricsProvider.mjs";

export class LyricsService {
  constructor({
    cachePath,
    logger = console
  } = {}) {
    this.logger = logger;
    this.localProviders = [new StaticLyricsProvider()];
    this.remoteProviders = [
      new LrcLibProvider(),
      new QqMusicProvider(),
      new KugouProvider()
    ];
    this.cacheStore = new LyricsCacheStore({
      filePath: cachePath || path.join(
        process.env.LOCALAPPDATA || os.tmpdir(),
        "YT Music Floating Lyrics",
        "lyrics-cache.json"
      ),
      logger
    });
    this.cache = this.cacheStore.entries;
  }

  _songKey(song) {
    return `${(song.title || "").trim().toLowerCase()}::${(song.artist || "").trim().toLowerCase()}`;
  }

  async ready() {
    await this.cacheStore.ready();
  }

  peekLyrics(song) {
    return this.cacheStore.get(this._songKey(song)) || null;
  }

  loadingLyrics() {
    return createLoadingLyricsResult();
  }

  async _findLyrics(song) {
    for (const provider of this.localProviders) {
      try {
        const found = await provider.findLyrics(song);
        if (found?.lines?.length) return found;
      } catch (error) {
        this.logger.warn?.("[lyrics] local provider failed", error);
      }
    }

    if (!this.remoteProviders.length) return null;

    return await new Promise((resolve) => {
      let pending = this.remoteProviders.length;
      let settled = false;

      const finish = (value = null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      for (const provider of this.remoteProviders) {
        Promise.resolve(provider.findLyrics(song))
          .then((found) => {
            if (settled) return;

            if (found?.lines?.length) {
              finish(found);
              return;
            }

            pending -= 1;
            if (pending <= 0) finish(null);
          })
          .catch((error) => {
            this.logger.warn?.("[lyrics] remote provider failed", error);
            pending -= 1;
            if (pending <= 0) finish(null);
          });
      }
    });
  }

  async getLyrics(song) {
    await this.ready();

    const key = this._songKey(song);
    const cached = this.cacheStore.get(key);
    if (cached) return cached;

    const found = await this._findLyrics(song);
    if (found?.lines?.length) {
      this.cacheStore.set(key, found);
      return found;
    }

    const missing = createMissingLyricsResult();
    this.cacheStore.set(key, missing);
    return missing;
  }

  currentLineIndex(lines, currentTimeSec) {
    if (!Array.isArray(lines) || !lines.length) return -1;

    const currentMs = Math.floor((currentTimeSec || 0) * 1000);
    let left = 0;
    let right = lines.length - 1;
    let answer = -1;

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

  async flushCache() {
    await this.cacheStore.flush();
  }
}
