import { normalizeSongText } from "../lyricsUtils.mjs";

export function compactWhitespace(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanupQueryText(value = "") {
  return compactWhitespace(value)
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\((live|remix|ver\.?|version|official|audio|video|mv|ost|opening|ending).*?\)/gi, " ")
    .replace(/feat\.?\s+.+$/i, " ")
    .replace(/\s+-\s+topic$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = compactWhitespace(value);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function titleVariants(title = "") {
  const cleaned = cleanupQueryText(title);
  const normalized = normalizeSongText(title);
  const values = [
    title,
    cleaned,
    cleaned.replace(/\s+-\s+.*$/, "").trim(),
    cleaned.replace(/\s*\/\s*.*$/, "").trim(),
    normalized
  ];

  return dedupeStrings(values);
}

export function artistVariants(artist = "") {
  const cleaned = cleanupQueryText(artist);
  const normalized = normalizeSongText(artist);
  const primary = cleaned.split(/\s*(?:,|&|\/| x | ;| feat\.?| ft\.?)\s*/i)[0];

  return dedupeStrings([artist, cleaned, primary, normalized]);
}

export function albumVariants(album = "") {
  const cleaned = cleanupQueryText(album);
  return dedupeStrings([album, cleaned]);
}

export function createStructuredSearchQueries(song, { max = 8 } = {}) {
  const titles = titleVariants(song.title).slice(0, 4);
  const artists = artistVariants(song.artist).slice(0, 3);
  const albums = albumVariants(song.album).slice(0, 2);
  const queries = [];

  for (const title of titles) {
    for (const artist of artists.length ? artists : [""]) {
      queries.push({
        track_name: title,
        artist_name: artist,
        album_name: albums[0] || "",
        duration: song.durationSec ? String(Math.round(song.durationSec)) : ""
      });

      if (queries.length >= max) {
        return queries;
      }
    }

    queries.push({
      track_name: title,
      artist_name: "",
      album_name: albums[0] || "",
      duration: song.durationSec ? String(Math.round(song.durationSec)) : ""
    });

    if (queries.length >= max) {
      return queries;
    }
  }

  return queries;
}

export function createSearchTerms(song, { max = 6 } = {}) {
  const titles = titleVariants(song.title).slice(0, 4);
  const artists = artistVariants(song.artist).slice(0, 3);
  const albums = albumVariants(song.album).slice(0, 2);
  const terms = [];

  for (const title of titles) {
    for (const artist of artists) {
      terms.push(`${artist} ${title}`);
      terms.push(`${title} ${artist}`);
    }

    terms.push(title);

    if (albums[0]) {
      terms.push(`${title} ${albums[0]}`);
    }
  }

  return dedupeStrings(terms).slice(0, max);
}

function durationScore(song, durationSec = 0) {
  const songDuration = Number(song.durationSec || 0);
  const itemDuration = Number(durationSec || 0);

  if (!songDuration || !itemDuration) return 0;

  const diff = Math.abs(songDuration - itemDuration);
  if (diff <= 1.5) return 30;
  if (diff <= 4) return 22;
  if (diff <= 8) return 12;
  if (diff <= 15) return 4;
  if (diff <= 30) return -8;
  return -20;
}

function titleScore(song, candidateTitle = "") {
  const songTitle = normalizeSongText(song.title);
  const itemTitle = normalizeSongText(candidateTitle);

  if (!songTitle || !itemTitle) return 0;
  if (songTitle === itemTitle) return 80;
  if (songTitle.includes(itemTitle) || itemTitle.includes(songTitle)) return 50;
  return 0;
}

function artistScore(song, candidateArtist = "") {
  const songArtist = normalizeSongText(song.artist);
  const itemArtist = normalizeSongText(candidateArtist);

  if (!songArtist || !itemArtist) return 0;
  if (songArtist === itemArtist) return 45;
  if (songArtist.includes(itemArtist) || itemArtist.includes(songArtist)) return 25;

  const songParts = songArtist.split(/\s+/).filter(Boolean);
  const itemParts = itemArtist.split(/\s+/).filter(Boolean);
  const overlap = songParts.filter((part) => itemParts.includes(part)).length;
  return overlap ? 10 : 0;
}

function albumScore(song, candidateAlbum = "") {
  const songAlbum = normalizeSongText(song.album);
  const itemAlbum = normalizeSongText(candidateAlbum);

  if (!songAlbum || !itemAlbum) return 0;
  if (songAlbum === itemAlbum) return 15;
  if (songAlbum.includes(itemAlbum) || itemAlbum.includes(songAlbum)) return 8;
  return 0;
}

export function scoreSongCandidate(song, {
  title = "",
  artist = "",
  album = "",
  durationSec = 0,
  hasSyncedLyrics = true,
  extraScore = 0
} = {}) {
  let score = 0;
  score += titleScore(song, title);
  score += artistScore(song, artist);
  score += albumScore(song, album);
  score += durationScore(song, durationSec);
  score += hasSyncedLyrics ? 35 : -40;
  score += Number(extraScore || 0);
  return score;
}

export function rankCandidates(song, items, mapper, { limit = 5 } = {}) {
  return [...items]
    .map((item) => ({
      item,
      score: scoreSongCandidate(song, mapper(item))
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
}

export async function fetchWithTimeout(url, {
  timeoutMs = 8000,
  headers = {},
  ...options
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}
