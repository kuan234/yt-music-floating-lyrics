import http from "node:http";

const PORT = 42819;
const clients = new Set();
const recent = {
  songKey: "",
  event: null,
  lyrics: []
};

function normalizeText(input = "") {
  return input
    .normalize("NFKC")
    .replace(/\((live|remix|ver\.?|version).*?\)/gi, "")
    .replace(/feat\.?\s+.+$/i, "")
    .trim();
}

function buildSongKey(event) {
  return `${normalizeText(event.title)}::${normalizeText(event.artist)}`.toLowerCase();
}

function mockLyricsFor(event) {
  const lines = [
    { startMs: 0, text: `${event.title} - ${event.artist}` },
    { startMs: 12000, text: "中文歌词示例：夜色在发光" },
    { startMs: 22000, text: "English line sample: Keep moving on" },
    { startMs: 32000, text: "日本語サンプル: 風が歌う" }
  ];
  return lines;
}

function currentLyricLine(lyrics, currentTimeSec) {
  const currentMs = Math.floor((currentTimeSec || 0) * 1000);
  let result = lyrics[0]?.text || "";
  for (const line of lyrics) {
    if (line.startMs <= currentMs) result = line.text;
    else break;
  }
  return result;
}

function broadcast(data) {
  const body = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(body);
  }
}

function handleEvent(event) {
  const songKey = buildSongKey(event);
  if (songKey && songKey !== recent.songKey) {
    recent.songKey = songKey;
    recent.lyrics = mockLyricsFor(event);
  }

  recent.event = event;
  const currentLine = currentLyricLine(recent.lyrics, event.currentTimeSec);
  broadcast({
    type: "LYRICS_TICK",
    title: event.title,
    artist: event.artist,
    currentTimeSec: event.currentTimeSec,
    isPlaying: event.isPlaying,
    line: currentLine,
    observedAt: event.observedAt
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: clients.size }));
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
      const line = currentLyricLine(recent.lyrics, recent.event.currentTimeSec);
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
        res.end();
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        if (!payload || !payload.title) {
          res.writeHead(400);
          res.end("invalid payload");
          return;
        }
        handleEvent(payload);
        res.writeHead(202);
        res.end("accepted");
      } catch {
        res.writeHead(400);
        res.end("bad json");
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[native-host] listening on http://127.0.0.1:${PORT}`);
});
