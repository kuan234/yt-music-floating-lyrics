import http from "node:http";
import { LyricsService } from "./lyricsService.mjs";

const PORT = 42819;
const clients = new Set();
const lyricsService = new LyricsService();

const recent = {
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

function songKeyOf(event) {
  return `${(event.title || "").trim().toLowerCase()}::${(event.artist || "").trim().toLowerCase()}`;
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

function handleEvent(event) {
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
}

function normalizeEvent(payload) {
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

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
        const event = normalizeEvent(payload);

        if (!event.title) {
          sendJson(res, 400, { ok: false, error: "invalid payload" });
          return;
        }

        handleEvent(event);
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[native-host] listening on http://127.0.0.1:${PORT}`);
});
