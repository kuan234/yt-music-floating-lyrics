import * as smartLyric from "smart-lyric";
import {
  createLyricsResult,
  karaokeStructuredToLines,
  parseSyncedLyrics
} from "../lyricsUtils.mjs";
import {
  createSearchTerms,
  fetchWithTimeout,
  rankCandidates
} from "./providerUtils.mjs";

const SONG_SEARCH_URL = "http://mobilecdn.kugou.com/api/v3/search/song";
const LYRICS_SEARCH_URL = "http://lyrics.kugou.com/search";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_SEARCH_TERMS = 6;

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`kugou ${response.status}`);
  }

  return await response.json();
}

async function searchSongsByTerm(term) {
  const url = new URL(SONG_SEARCH_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("page", "1");
  url.searchParams.set("pagesize", "6");
  url.searchParams.set("showtype", "1");
  url.searchParams.set("keyword", term);

  const data = await fetchJson(url);
  const items = Array.isArray(data?.data?.info) ? data.data.info : [];

  return items.map((item) => ({
    hash: item.hash,
    title: item.songname,
    artist: item.singername,
    album: item.album_name,
    durationSec: Number(item.duration || 0),
    filename: item.filename
  }));
}

async function searchLyricsCandidates(songCandidate) {
  const url = new URL(LYRICS_SEARCH_URL);
  url.searchParams.set("ver", "1");
  url.searchParams.set("man", "yes");
  url.searchParams.set("client", "pc");
  url.searchParams.set("keyword", songCandidate.filename || `${songCandidate.artist} - ${songCandidate.title}`);
  url.searchParams.set("duration", String(Math.round(songCandidate.durationSec || 0)));
  url.searchParams.set("hash", songCandidate.hash);

  const data = await fetchJson(url);
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

function parseKrcLines(krcText = "") {
  try {
    const parsed = smartLyric.krc.parse(krcText);
    return karaokeStructuredToLines(parsed.content);
  } catch {
    return [];
  }
}

export class KugouProvider {
  async search(song) {
    const results = new Map();

    for (const term of createSearchTerms(song, { max: MAX_SEARCH_TERMS })) {
      try {
        const items = await searchSongsByTerm(term);

        for (const item of items) {
          if (!item.hash) continue;
          results.set(item.hash, item);
        }

        if (results.size >= 10) break;
      } catch (error) {
        console.warn("[lyrics] kugou search failed", error);
      }
    }

    return [...results.values()];
  }

  async findLyrics(song) {
    const songCandidates = await this.search(song);
    if (!songCandidates.length) return null;

    const rankedSongs = rankCandidates(song, songCandidates, (item) => ({
      title: item.title,
      artist: item.artist,
      album: item.album,
      durationSec: item.durationSec,
      hasSyncedLyrics: true
    }), { limit: 3 });

    for (const songCandidate of rankedSongs) {
      let lyricCandidates = [];

      try {
        lyricCandidates = await searchLyricsCandidates(songCandidate);
      } catch (error) {
        console.warn("[lyrics] kugou lyric candidates failed", error);
      }

      const rankedLyrics = rankCandidates(song, lyricCandidates, (item) => ({
        title: item.song,
        artist: item.singer,
        durationSec: Number(item.duration || 0) / 1000,
        hasSyncedLyrics: item.content_format === 2,
        extraScore: Number(item.score || 0)
      }), { limit: 3 });

      for (const item of rankedLyrics) {
        try {
          const karaok = await smartLyric.utils.downloadKugouLyric({
            id: item.id,
            accesskey: item.accesskey,
            fmt: "krc"
          });

          let lines = karaok.karaok ? parseKrcLines(karaok.karaok) : [];

          if (!lines.length) {
            const regular = await smartLyric.utils.downloadKugouLyric({
              id: item.id,
              accesskey: item.accesskey,
              fmt: "lrc"
            });
            lines = parseSyncedLyrics(regular.regular || "");
          }

          if (!lines.length) continue;

          return createLyricsResult({
            source: "kugou",
            status: "ready",
            synced: true,
            lines
          });
        } catch (error) {
          console.warn("[lyrics] kugou candidate failed", error);
        }
      }
    }

    return null;
  }
}
