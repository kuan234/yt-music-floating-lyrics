import * as smartLyric from "smart-lyric";
import {
  createLyricsResult,
  decodeXmlEntities,
  parseSyncedLyrics
} from "../lyricsUtils.mjs";
import {
  artistVariants,
  fetchWithTimeout,
  rankCandidates,
  titleVariants
} from "./providerUtils.mjs";

const SEARCH_URL = "https://c.y.qq.com/lyric/fcgi-bin/fcg_search_pc_lrc.fcg";
const REQUEST_TIMEOUT_MS = 8000;
const SEARCH_BATCH_SIZE = 2;
const MAX_QUERY_VARIANTS = 6;

const QQ_HEADERS = {
  "user-agent": "Mozilla/5.0",
  referer: "https://y.qq.com/"
};

function decodeQqText(value = "") {
  const input = String(value || "").trim();
  if (!input) return "";

  try {
    return decodeURIComponent(input.replace(/\+/g, "%20"));
  } catch {
    return input.replace(/\+/g, " ");
  }
}

function parseSongMatches(xmlText = "") {
  const matches = [];
  const pattern = /<songinfo id="([^"]+)"[^>]*>[\s\S]*?<name><!\[CDATA\[(.*?)\]\]><\/name>[\s\S]*?<singername><!\[CDATA\[(.*?)\]\]><\/singername>[\s\S]*?<albumname><!\[CDATA\[(.*?)\]\]><\/albumname>[\s\S]*?<\/songinfo>/gi;

  for (const match of xmlText.matchAll(pattern)) {
    matches.push({
      songId: match[1],
      title: decodeQqText(match[2]),
      artist: decodeQqText(match[3]),
      album: decodeQqText(match[4])
    });
  }

  return matches;
}

function extractQrcContent(qrcText = "") {
  const match = String(qrcText).match(/LyricContent="([\s\S]*?)"\s*\/>/i);
  if (!match) return "";

  return decodeXmlEntities(match[1]).replace(/&#13;/gi, "\n");
}

function parseQrcLines(qrcText = "") {
  const content = extractQrcContent(qrcText);
  if (!content) return [];

  const lines = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!match) continue;

    const text = [...match[3].matchAll(/([^()]*?)\((\d+),(\d+)\)/g)]
      .map((part) => part[1])
      .join("");

    lines.push({
      startMs: Number(match[1]),
      text
    });
  }

  return createLyricsResult({
    source: "qqmusic",
    status: "ready",
    synced: true,
    lines
  }).lines;
}

function createSearchQueries(song) {
  const titles = titleVariants(song.title).slice(0, 4);
  const artists = artistVariants(song.artist).slice(0, 2);
  const queries = [];

  for (const title of titles) {
    for (const artist of artists.length ? artists : [""]) {
      queries.push({
        songName: title,
        singerName: artist
      });

      if (queries.length >= MAX_QUERY_VARIANTS) {
        return queries;
      }
    }

    queries.push({
      songName: title,
      singerName: ""
    });

    if (queries.length >= MAX_QUERY_VARIANTS) {
      return queries;
    }
  }

  return queries;
}

async function searchQuery(query) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("SONGNAME", query.songName);
  url.searchParams.set("SINGERNAME", query.singerName || "");
  url.searchParams.set("TYPE", "2");
  url.searchParams.set("RANGE_MIN", "1");
  url.searchParams.set("RANGE_MAX", "8");

  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: QQ_HEADERS
  });

  if (!response.ok) {
    throw new Error(`qqmusic ${response.status}`);
  }

  return parseSongMatches(await response.text());
}

export class QqMusicProvider {
  async search(song) {
    const results = new Map();
    const queries = createSearchQueries(song);

    for (let index = 0; index < queries.length; index += SEARCH_BATCH_SIZE) {
      const batch = queries.slice(index, index + SEARCH_BATCH_SIZE);
      const responses = await Promise.allSettled(batch.map((query) => searchQuery(query)));

      for (const response of responses) {
        if (response.status !== "fulfilled") continue;

        for (const item of response.value) {
          if (!item.songId) continue;
          results.set(item.songId, item);
        }
      }

      if (results.size >= 10) break;
    }

    return [...results.values()];
  }

  async findLyrics(song) {
    const candidates = await this.search(song);
    if (!candidates.length) return null;

    const ranked = rankCandidates(song, candidates, (item) => ({
      title: item.title,
      artist: item.artist,
      album: item.album,
      hasSyncedLyrics: true
    }), { limit: 4 });

    for (const item of ranked) {
      try {
        const downloaded = await smartLyric.utils.downloadQQMusicLyric({
          songID: item.songId,
          songName: item.title,
          singerName: item.artist,
          albumName: item.album,
          qrc: true
        });

        const lines = downloaded.karaok
          ? parseQrcLines(downloaded.karaok)
          : parseSyncedLyrics(downloaded.regular || "");

        if (!lines.length) continue;

        return createLyricsResult({
          source: "qqmusic",
          status: "ready",
          synced: true,
          lines
        });
      } catch (error) {
        console.warn("[lyrics] qqmusic candidate failed", error);
      }
    }

    return null;
  }
}
