import {
  createLyricsResult,
  normalizeSongText,
  parseSyncedLyrics
} from "../lyricsUtils.mjs";

const API_BASE = "https://lrclib.net/api";
const REQUEST_TIMEOUT_MS = 12000;

function durationScore(song, item) {
  const songDuration = Number(song.durationSec || 0);
  const itemDuration = Number(item.duration || 0);

  if (!songDuration || !itemDuration) return 0;

  const diff = Math.abs(songDuration - itemDuration);
  if (diff <= 1.5) return 30;
  if (diff <= 4) return 22;
  if (diff <= 8) return 12;
  if (diff <= 15) return 4;
  if (diff <= 30) return -8;
  return -20;
}

function titleScore(song, item) {
  const songTitle = normalizeSongText(song.title);
  const itemTitle = normalizeSongText(item.trackName || item.name);

  if (!songTitle || !itemTitle) return 0;
  if (songTitle === itemTitle) return 80;
  if (songTitle.includes(itemTitle) || itemTitle.includes(songTitle)) return 50;
  return 0;
}

function artistScore(song, item) {
  const songArtist = normalizeSongText(song.artist);
  const itemArtist = normalizeSongText(item.artistName);

  if (!songArtist || !itemArtist) return 0;
  if (songArtist === itemArtist) return 45;
  if (songArtist.includes(itemArtist) || itemArtist.includes(songArtist)) return 25;

  const songParts = songArtist.split(/\s+/).filter(Boolean);
  const itemParts = itemArtist.split(/\s+/).filter(Boolean);
  const overlap = songParts.filter((part) => itemParts.includes(part)).length;
  return overlap ? 10 : 0;
}

function albumScore(song, item) {
  const songAlbum = normalizeSongText(song.album);
  const itemAlbum = normalizeSongText(item.albumName);

  if (!songAlbum || !itemAlbum) return 0;
  if (songAlbum === itemAlbum) return 15;
  if (songAlbum.includes(itemAlbum) || itemAlbum.includes(songAlbum)) return 8;
  return 0;
}

function scoreCandidate(song, item) {
  let score = 0;
  score += titleScore(song, item);
  score += artistScore(song, item);
  score += albumScore(song, item);
  score += durationScore(song, item);
  score += item.syncedLyrics ? 35 : -40;
  score += item.instrumental ? -120 : 0;
  return score;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "yt-music-floating-lyrics/0.3"
      }
    });

    if (!response.ok) {
      throw new Error(`lrclib ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export class LrcLibProvider {
  async search(song) {
    const url = new URL(`${API_BASE}/search`);
    url.searchParams.set("track_name", song.title || "");
    url.searchParams.set("artist_name", song.artist || "");

    if (song.album) url.searchParams.set("album_name", song.album);
    if (song.durationSec) url.searchParams.set("duration", String(Math.round(song.durationSec)));

    const results = await fetchJson(url);
    return Array.isArray(results) ? results : [];
  }

  async findLyrics(song) {
    const results = await this.search(song);
    if (!results.length) return null;

    const best = [...results]
      .sort((left, right) => scoreCandidate(song, right) - scoreCandidate(song, left))
      .find((item) => item?.syncedLyrics);

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
