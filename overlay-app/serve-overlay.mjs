import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 43100;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

function resolveFile(urlPath) {
  const clean = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.resolve(__dirname, `.${clean}`);
  if (!filePath.startsWith(__dirname)) return null;
  return filePath;
}

const server = http.createServer(async (req, res) => {
  try {
    const filePath = resolveFile(new URL(req.url || "/", "http://localhost").pathname);
    if (!filePath) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }

    const ext = path.extname(filePath);
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[overlay] open http://127.0.0.1:${PORT}`);
});
