import {
  createLyricsResult,
  parseSyncedLyrics
} from "../lyricsUtils.mjs";
import {
  createStructuredSearchQueries,
  fetchWithTimeout,
  rankCandidates
} from "./providerUtils.mjs";

const API_BASE = "https://lrclib.net/api";
const REQUEST_TIMEOUT_MS = 9000;
const MAX_QUERY_VARIANTS = 6;
const QUERY_BATCH_SIZE = 3;

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: {
      accept: "application/json",
      "user-agent": "yt-music-floating-lyrics/0.5"
    }
  });

  if (!response.ok) {
    throw new Error(`lrclib ${response.status}`);
  }

  return await response.json();
}

async function searchQuery(query) {
  const url = new URL(`${API_BASE}/search`);

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetchJson(url);
  return Array.isArray(response) ? response : [];
}

export class LrcLibProvider {
  async search(song) {
    const results = new Map();
    const queries = createStructuredSearchQueries(song, { max: MAX_QUERY_VARIANTS });

    for (let index = 0; index < queries.length; index += QUERY_BATCH_SIZE) {
      const batch = queries.slice(index, index + QUERY_BATCH_SIZE);
      const responses = await Promise.allSettled(batch.map((query) => searchQuery(query)));

      for (const response of responses) {
        if (response.status !== "fulfilled") continue;

        for (const item of response.value) {
          const cacheKey = [
            item.id || "",
            item.trackName || item.name || "",
            item.artistName || "",
            Number(item.duration || 0)
          ].join("|");

          if (!results.has(cacheKey)) {
            results.set(cacheKey, item);
          }
        }
      }

      if (results.size >= 12) break;
    }

    return [...results.values()];
  }

  async findLyrics(song) {
    const results = await this.search(song);
    if (!results.length) return null;

    const best = rankCandidates(song, results, (item) => ({
      title: item.trackName || item.name,
      artist: item.artistName,
      album: item.albumName,
      durationSec: Number(item.duration || 0),
      hasSyncedLyrics: Boolean(item.syncedLyrics),
      extraScore: item.instrumental ? -120 : 0
    }), { limit: 6 }).find((item) => item?.syncedLyrics);

    if (!best?.syncedLyrics) return null;

    const lines = parseSyncedLyrics(best.syncedLyrics);
    if (!lines.length) return null;

    return createLyricsResult({
      source: "lrclib",
      status: "ready",
      synced: true,
      lines
    });
  }
}
