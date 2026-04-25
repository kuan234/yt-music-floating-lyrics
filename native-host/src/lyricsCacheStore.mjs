import fs from "node:fs/promises";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;

function ttlForStatus(status) {
  switch (status) {
    case "ready":
      return 30 * DAY_MS;
    case "missing":
      return 6 * HOUR_MS;
    default:
      return 0;
  }
}

function isExpired(entry) {
  if (!entry?.value?.status) return true;

  const ttlMs = ttlForStatus(entry.value.status);
  if (!ttlMs) return true;

  return Date.now() - Number(entry.cachedAt || 0) > ttlMs;
}

function isValidLyricsValue(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.status === "string" &&
    typeof value.source === "string" &&
    typeof value.synced === "boolean" &&
    Array.isArray(value.lines)
  );
}

export class LyricsCacheStore {
  constructor({
    filePath,
    maxEntries = 250,
    logger = console
  } = {}) {
    this.filePath = filePath;
    this.maxEntries = maxEntries;
    this.logger = logger;
    this.entries = new Map();
    this.saveTimer = null;
    this.readyPromise = this.load();
  }

  async ready() {
    await this.readyPromise;
  }

  _touch(key, entry) {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, entry);
  }

  _trim() {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
  }

  _dropExpiredIfNeeded(key, entry) {
    if (!entry || !isExpired(entry)) return false;

    this.entries.delete(key);
    this.scheduleSave();
    return true;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this._dropExpiredIfNeeded(key, entry)) return null;

    entry.lastAccessedAt = Date.now();
    this._touch(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (!isValidLyricsValue(value)) return;

    const now = Date.now();
    this._touch(key, {
      cachedAt: now,
      lastAccessedAt: now,
      value
    });
    this._trim();
    this.scheduleSave();
  }

  scheduleSave() {
    if (!this.filePath) return;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 160);
  }

  async load() {
    if (!this.filePath) return;

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);

      if (parsed?.version !== CACHE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
        return;
      }

      for (const item of parsed.entries) {
        if (!item?.key || !isValidLyricsValue(item.value)) continue;

        const entry = {
          cachedAt: Number(item.cachedAt || Date.now()),
          lastAccessedAt: Number(item.lastAccessedAt || item.cachedAt || Date.now()),
          value: item.value
        };

        if (isExpired(entry)) continue;
        this._touch(item.key, entry);
      }

      this._trim();
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.logger.warn?.(`[lyrics-cache] failed to load cache: ${error.message || error}`);
      }
    }
  }

  async save() {
    if (!this.filePath) return;

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });

      const payload = {
        version: CACHE_SCHEMA_VERSION,
        savedAt: Date.now(),
        entries: [...this.entries.entries()]
          .filter(([, entry]) => !isExpired(entry))
          .map(([key, entry]) => ({
            key,
            cachedAt: entry.cachedAt,
            lastAccessedAt: entry.lastAccessedAt,
            value: entry.value
          }))
      };

      await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
    } catch (error) {
      this.logger.warn?.(`[lyrics-cache] failed to save cache: ${error.message || error}`);
    }
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    await this.save();
  }
}
