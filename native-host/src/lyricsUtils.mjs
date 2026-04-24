const CREDIT_PREFIXES = [
  "词",
  "詞",
  "曲",
  "作词",
  "作詞",
  "作曲",
  "编曲",
  "編曲",
  "制作人",
  "製作人",
  "合声",
  "合聲",
  "录音",
  "錄音",
  "混音",
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

function timeFractionToMs(fraction = "") {
  if (!fraction) return 0;
  return Math.round(Number(`0.${fraction}`) * 1000);
}

function isCreditLine(text, startMs) {
  if (startMs > 30000) return false;

  const normalized = text.trim().toLowerCase();
  return CREDIT_PREFIXES.some((prefix) => normalized.startsWith(prefix.toLowerCase())) &&
    /[:：]/.test(normalized);
}

function cleanupLyricText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}

export function normalizeSongText(input = "") {
  return String(input)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\((live|remix|ver\.?|version|official|audio|video|mv).*?\)/gi, " ")
    .replace(/feat\.?\s+.+$/i, " ")
    .replace(/[‐‑–—]/g, "-")
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

      if (!Number.isFinite(startMs) || isCreditLine(text, startMs)) continue;

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
