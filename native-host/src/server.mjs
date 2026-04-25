import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LyricsService } from "./lyricsService.mjs";

const DEFAULT_PORT = 42819;
const DEFAULT_HOST = "127.0.0.1";

function songKeyOf(event) {
  return `${(event.title || "").trim().toLowerCase()}::${(event.artist || "").trim().toLowerCase()}`;
}

function createRecentState(lyricsService) {
  return {
    event: null,
    lyrics: lyricsService.loadingLyrics(),
    songKey: "",
    loadingSongKey: "",
    metrics: {
      eventsReceived: 0,
      lyricsCacheSize: 0,
      lastEventAt: 0
    }
  };
}

export function normalizeEvent(payload = {}) {
  return {
    title: String(payload.title || "").trim(),
    artist: String(payload.artist || "").trim(),
    album: String(payload.album || "").trim(),
    durationSec: Math.max(0, Number(payload.durationSec || 0)),
    currentTimeSec: Math.max(0, Number(payload.currentTimeSec || 0)),
    isPlaying: Boolean(payload.isPlaying),
    observedAt: Number(payload.observedAt || Date.now())
  };
}

export function createLyricsServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  logger = console
} = {}) {
  const clients = new Set();
  const lyricsService = new LyricsService();
  const recent = createRecentState(lyricsService);

  function log(message) {
    logger.log?.(`[native-host] ${message}`);
  }

  function sendJson(res, status, body) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    res.end(JSON.stringify(body));
  }

  function broadcast(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      res.write(payload);
    }
  }

  function lyricsPayload(type, event, lyrics, line) {
    return {
      type,
      title: event.title,
      artist: event.artist,
      album: event.album,
      durationSec: event.durationSec,
      currentTimeSec: event.currentTimeSec,
      isPlaying: event.isPlaying,
      line,
      lines: lyrics.lines,
      lyricsSource: lyrics.source,
      lyricsStatus: lyrics.status,
      lyricsSynced: lyrics.synced,
      observedAt: event.observedAt
    };
  }

  function tickPayload(event, line, lyrics) {
    return {
      type: "LYRICS_TICK",
      title: event.title,
      artist: event.artist,
      album: event.album,
      durationSec: event.durationSec,
      currentTimeSec: event.currentTimeSec,
      isPlaying: event.isPlaying,
      line,
      lyricsSource: lyrics.source,
      lyricsStatus: lyrics.status,
      lyricsSynced: lyrics.synced,
      observedAt: event.observedAt
    };
  }

  async function loadLyricsForSong(song, songKey) {
    const lyrics = await lyricsService.getLyrics(song);
    if (songKey !== recent.songKey) return;

    recent.lyrics = lyrics;
    recent.loadingSongKey = "";
    recent.metrics.lyricsCacheSize = lyricsService.cache.size;

    if (!recent.event) return;

    const line = lyricsService.currentLine(lyrics.lines, recent.event.currentTimeSec);
    broadcast(lyricsPayload("TRACK", recent.event, lyrics, line));
  }

  function handleEvent(input) {
    const event = normalizeEvent(input);
    if (!event.title) return false;

    recent.metrics.eventsReceived += 1;
    recent.metrics.lastEventAt = Date.now();

    const nextSongKey = songKeyOf(event);
    let songChanged = false;

    if (nextSongKey && nextSongKey !== recent.songKey) {
      songChanged = true;
      recent.songKey = nextSongKey;
      recent.lyrics = lyricsService.peekLyrics(event) || lyricsService.loadingLyrics();
      recent.loadingSongKey = recent.lyrics.status === "ready" ? "" : nextSongKey;

      if (recent.loadingSongKey) {
        void loadLyricsForSong(event, nextSongKey);
      } else {
        recent.metrics.lyricsCacheSize = lyricsService.cache.size;
      }
    }

    recent.event = event;
    if (songChanged) {
      const initialLine = lyricsService.currentLine(recent.lyrics.lines, event.currentTimeSec);
      broadcast(lyricsPayload("TRACK", event, recent.lyrics, initialLine));
    }

    const line = lyricsService.currentLine(recent.lyrics.lines, event.currentTimeSec);
    broadcast(tickPayload(event, line, recent.lyrics));
    return true;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type"
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        clients: clients.size,
        songKey: recent.songKey,
        hasEvent: Boolean(recent.event),
        lyricsSource: recent.lyrics.source,
        lyricsStatus: recent.lyrics.status,
        metrics: recent.metrics
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": "*"
      });

      res.write(`data: ${JSON.stringify({ type: "CONNECTED" })}\n\n`);
      clients.add(res);

      if (recent.event) {
        const line = lyricsService.currentLine(recent.lyrics.lines, recent.event.currentTimeSec);
        res.write(`data: ${JSON.stringify(lyricsPayload("SNAPSHOT", recent.event, recent.lyrics, line))}\n\n`);
      }

      req.on("close", () => {
        clients.delete(res);
        res.end();
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/event") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) {
          res.writeHead(413, { "access-control-allow-origin": "*" });
          res.end("payload too large");
          req.destroy();
        }
      });

      req.on("end", () => {
        try {
          const payload = JSON.parse(body);

          if (!handleEvent(payload)) {
            sendJson(res, 400, { ok: false, error: "invalid payload" });
            return;
          }

          sendJson(res, 202, { ok: true });
        } catch (error) {
          sendJson(res, 400, {
            ok: false,
            error: "bad json",
            detail: String(error)
          });
        }
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  });

  let listenPromise = null;

  const api = {
    host,
    port,
    url: `http://${host}:${port}`,
    recent,
    lyricsService,
    handleEvent,
    server,
    async listen() {
      if (server.listening) return api;
      if (listenPromise) return listenPromise;

      listenPromise = new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening);
          reject(error);
        };

        const onListening = () => {
          server.off("error", onError);
          log(`listening on http://${host}:${port}`);
          resolve(api);
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });

      return listenPromise;
    },
    async close() {
      if (!server.listening) return;

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };

  return api;
}

export function startLyricsServer(options = {}) {
  return createLyricsServer(options).listen();
}

const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
const moduleFile = fileURLToPath(import.meta.url);
const isDirectRun = entryFile === moduleFile;

if (isDirectRun) {
  const instance = await startLyricsServer();

  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}
