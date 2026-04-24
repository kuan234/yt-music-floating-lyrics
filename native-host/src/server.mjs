import http from "node:http";
import { LyricsService } from "./lyricsService.mjs";

const PORT = 42819;
const clients = new Set();
const lyricsService = new LyricsService();

const recent = {
  event: null,
  lines: [],
  songKey: "",
  metrics: {
    eventsReceived: 0,
    lyricsCacheSize: 0,
    lastEventAt: 0
  }
};

function songKeyOf(event) {
  return `${(event.title || "").trim().toLowerCase()}::${(event.artist || "").trim().toLowerCase()}`;
}

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

async function handleEvent(event) {
  recent.metrics.eventsReceived += 1;
  recent.metrics.lastEventAt = Date.now();

  const nextSongKey = songKeyOf(event);
  if (nextSongKey !== recent.songKey) {
    recent.songKey = nextSongKey;
    recent.lines = await lyricsService.getLyrics(event);
    recent.metrics.lyricsCacheSize = lyricsService.cache.size;
  }

  recent.event = event;
  const line = lyricsService.currentLine(recent.lines, event.currentTimeSec);

  broadcast({
    type: "LYRICS_TICK",
    title: event.title,
    artist: event.artist,
    currentTimeSec: event.currentTimeSec,
    isPlaying: event.isPlaying,
    line,
    observedAt: event.observedAt
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      clients: clients.size,
      metrics: recent.metrics
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/stream") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*"
    });

    res.write(`data: ${JSON.stringify({ type: "CONNECTED" })}\n\n`);
    clients.add(res);

    if (recent.event) {
      const line = lyricsService.currentLine(recent.lines, recent.event.currentTimeSec);
      res.write(`data: ${JSON.stringify({ type: "SNAPSHOT", ...recent.event, line })}\n\n`);
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
        res.writeHead(413);
        res.end("payload too large");
        req.destroy();
      }
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        if (!payload?.title) {
          sendJson(res, 400, { ok: false, error: "invalid payload" });
          return;
        }

        await handleEvent(payload);
        sendJson(res, 202, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: "bad json", detail: String(error) });
      }
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[native-host] listening on http://127.0.0.1:${PORT}`);
});
