import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLyricsResult, normalizeSongText } from "../lyricsUtils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LYRICS_FILE = path.resolve(__dirname, "../../data/lyrics.json");

function scoreCandidate(song, item) {
  const titleA = normalizeSongText(song.title);
  const titleB = normalizeSongText(item.title);
  const artistA = normalizeSongText(song.artist);
  const artistB = normalizeSongText(item.artist);

  let score = 0;
  if (titleA === titleB) score += 70;
  else if (titleA && titleB && (titleA.includes(titleB) || titleB.includes(titleA))) score += 40;

  if (artistA === artistB) score += 30;
  else if (artistA && artistB && (artistA.includes(artistB) || artistB.includes(artistA))) score += 15;

  if (song.durationSec && item.durationSec) {
    const diff = Math.abs(Number(song.durationSec) - Number(item.durationSec));
    if (diff <= 2) score += 20;
    else if (diff <= 6) score += 10;
  }

  return score;
}

export class StaticLyricsProvider {
  constructor() {
    this.loaded = false;
    this.items = [];
  }

  async load() {
    if (this.loaded) return;
    const raw = await fs.readFile(LYRICS_FILE, "utf-8");
    this.items = JSON.parse(raw);
    this.loaded = true;
  }

  async findLyrics(song) {
    await this.load();

    let best = null;
    let bestScore = 0;

    for (const item of this.items) {
      const score = scoreCandidate(song, item);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }

    if (!best || bestScore < 55) return null;

    return createLyricsResult({
      source: "static",
      status: "ready",
      synced: true,
      lines: best.lines
    });
  }
}
