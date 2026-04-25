const CREDIT_PREFIXES = [
  "\u8bcd",
  "\u8a5e",
  "\u66f2",
  "\u4f5c\u8bcd",
  "\u4f5c\u8a5e",
  "\u4f5c\u66f2",
  "\u7f16\u66f2",
  "\u7de8\u66f2",
  "\u5236\u4f5c\u4eba",
  "\u88fd\u4f5c\u4eba",
  "\u5408\u5531",
  "\u5408\u8072",
  "\u5f55\u97f3",
  "\u9304\u97f3",
  "\u6df7\u97f3",
  "guitar",
  "bass",
  "drums",
  "composer",
  "lyricist",
  "lyrics by",
  "written by",
  "music by",
  "produced by"
];

const XML_ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};

function timeFractionToMs(fraction = "") {
  if (!fraction) return 0;
  return Math.round(Number(`0.${fraction}`) * 1000);
}

function cleanupLyricText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isIgnorableLyricLine(text, startMs) {
  if (startMs > 30000) return false;

  const normalized = cleanupLyricText(text).toLowerCase();
  if (!normalized) return true;

  return CREDIT_PREFIXES.some((prefix) => normalized.startsWith(prefix.toLowerCase())) &&
    /[:\uff1a]/.test(normalized);
}

export function normalizeSongText(input = "") {
  return String(input)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\((live|remix|ver\.?|version|official|audio|video|mv|ost|opening|ending).*?\)/gi, " ")
    .replace(/feat\.?\s+.+$/i, " ")
    .replace(/[\u2010\u2011\u2013\u2014]/g, "-")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createLyricsResult({
  source = "unknown",
  status = "ready",
  synced = true,
  lines = []
} = {}) {
  const normalizedLines = lines
    .filter((line) => Number.isFinite(line?.startMs))
    .map((line) => ({
      startMs: Math.max(0, Math.floor(line.startMs)),
      text: cleanupLyricText(line.text)
    }))
    .filter((line) => line.text)
    .filter((line) => !isIgnorableLyricLine(line.text, line.startMs))
    .sort((a, b) => a.startMs - b.startMs)
    .filter((line, index, items) => {
      if (index === 0) return true;
      const prev = items[index - 1];
      return prev.startMs !== line.startMs || prev.text !== line.text;
    });

  return {
    source,
    status,
    synced: Boolean(synced),
    lines: normalizedLines
  };
}

export function createLoadingLyricsResult() {
  return createLyricsResult({
    source: "pending",
    status: "loading",
    synced: false,
    lines: []
  });
}

export function createMissingLyricsResult() {
  return createLyricsResult({
    source: "none",
    status: "missing",
    synced: false,
    lines: []
  });
}

export function decodeXmlEntities(input = "") {
  return String(input).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();

    if (key in XML_ENTITY_MAP) {
      return XML_ENTITY_MAP[key];
    }

    if (key.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }

    if (key.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }

    return match;
  });
}

export function karaokeStructuredToLines(karaokeLines = []) {
  return createLyricsResult({
    source: "karaoke",
    status: "ready",
    synced: true,
    lines: karaokeLines.map((line) => ({
      startMs: Math.max(0, Number(line?.start || 0)),
      text: Array.isArray(line?.content)
        ? line.content.map((part) => part?.content || "").join("")
        : String(line?.content || "")
    }))
  }).lines;
}

export function parseSyncedLyrics(lrcText) {
  const lines = [];
  const rawLines = String(lrcText || "").split(/\n/);

  for (const rawLine of rawLines) {
    const timeTags = [...rawLine.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!timeTags.length) continue;

    const text = cleanupLyricText(rawLine.replace(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g, ""));
    if (!text) continue;

    for (const [, minutes, seconds, fraction] of timeTags) {
      const startMs =
        Number(minutes) * 60 * 1000 +
        Number(seconds) * 1000 +
        timeFractionToMs(fraction);

      if (!Number.isFinite(startMs)) continue;
      lines.push({ startMs, text });
    }
  }

  return createLyricsResult({
    source: "synced",
    status: "ready",
    synced: true,
    lines
  }).lines;
}
