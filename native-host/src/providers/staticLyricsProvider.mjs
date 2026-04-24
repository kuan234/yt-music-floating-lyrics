import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LYRICS_FILE = path.resolve(__dirname, "../../data/lyrics.json");

function normalizeText(input = "") {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\((live|remix|ver\.?|version).*?\)/gi, "")
    .replace(/feat\.?\s+.+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(song, item) {
  const titleA = normalizeText(song.title);
  const titleB = normalizeText(item.title);
  const artistA = normalizeText(song.artist);
  const artistB = normalizeText(item.artist);

  let score = 0;
  if (titleA === titleB) score += 70;
  else if (titleA && titleB && (titleA.includes(titleB) || titleB.includes(titleA))) score += 40;

  if (artistA === artistB) score += 30;
  else if (artistA && artistB && (artistA.includes(artistB) || artistB.includes(artistA))) score += 15;

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
    return best.lines;
  }
}
