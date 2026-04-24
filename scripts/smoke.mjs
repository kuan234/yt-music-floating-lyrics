import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = new URL("../", import.meta.url);
const nativeHostDir = new URL("../native-host/", import.meta.url);
const overlayDir = new URL("../overlay-app/", import.meta.url);

const SAMPLE_EVENT = {
  title: "\u591c\u306b\u99c6\u3051\u308b",
  artist: "YOASOBI",
  currentTimeSec: 13.2,
  isPlaying: true,
  observedAt: Date.now()
};

const children = [];

function log(message) {
  console.log(`[smoke] ${message}`);
}

function spawnNode(cwdUrl, args, label) {
  const child = spawn(process.execPath, args, {
    cwd: cwdUrl,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${label}:err] ${chunk}`);
  });

  children.push(child);
  return child;
}

async function waitForUrl(url, validate, timeoutMs = 8000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.text();
        if (validate(body)) return body;
      }
    } catch {
      // Keep polling until timeout.
    }

    await delay(250);
  }

  throw new Error(`timeout waiting for ${url}`);
}

async function waitForStreamTick(timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("stream timeout")), timeoutMs);

  try {
    const response = await fetch("http://127.0.0.1:42819/stream", {
      signal: controller.signal,
      headers: { accept: "text/event-stream" }
    });

    if (!response.ok || !response.body) {
      throw new Error(`stream ${response.status}`);
    }

    log("stream connected");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const eventText of events) {
        const dataLine = eventText
          .split("\n")
          .find((line) => line.startsWith("data: "));

        if (!dataLine) continue;

        const payload = JSON.parse(dataLine.slice(6));
        if (payload.type === "CONNECTED") continue;
        if (!payload.line) continue;
        if (payload.lyricsStatus === "loading") continue;
        return payload;
      }
    }

    throw new Error("stream closed before lyrics event");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function postSampleEvent() {
  const response = await fetch("http://127.0.0.1:42819/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(SAMPLE_EVENT)
  });

  if (!response.ok) {
    throw new Error(`event post failed: ${response.status}`);
  }
}

function cleanup() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

async function main() {
  log(`repo root ${repoRoot.pathname}`);
  spawnNode(nativeHostDir, ["src/server.mjs"], "host");
  spawnNode(overlayDir, ["serve-overlay.mjs"], "overlay");

  await waitForUrl("http://127.0.0.1:42819/health", (body) => body.includes("\"ok\":true"));
  log("host ok");

  await waitForUrl("http://127.0.0.1:43100", (body) => body.includes("overlay.js"));
  log("overlay ok");

  const streamPromise = waitForStreamTick();
  await delay(200);
  await postSampleEvent();

  const payload = await streamPromise;
  if (!payload.line) {
    throw new Error("lyrics line missing from stream payload");
  }

  log(`received line: ${payload.line}`);
  log("pass");
}

main()
  .catch((error) => {
    console.error(`[smoke] fail: ${error.stack || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await delay(150);
    cleanup();
  });
