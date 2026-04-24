import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBinary = process.platform === "win32"
  ? path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe")
  : path.join(repoRoot, "node_modules", ".bin", "electron");

const children = [];

function log(message) {
  console.log(`[desktop] ${message}`);
}

function spawnTagged(command, args, cwd, label, extraOptions = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    ...extraOptions
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

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} exited via signal ${signal}`));
        return;
      }

      if (code && code !== 0) {
        reject(new Error(`${label} exited with code ${code}`));
        return;
      }

      resolve();
    });
  });
}

async function waitForUrl(url, validate, timeoutMs = 12000) {
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

async function ensureHostRunning() {
  try {
    await waitForUrl("http://127.0.0.1:42819/health", (body) => body.includes("\"ok\":true"), 1200);
    log("reusing existing native host");
    return;
  } catch {
    // Start a new host below.
  }

  spawnTagged(npmCmd, ["--prefix", "native-host", "run", "start"], repoRoot, "host");
  await waitForUrl("http://127.0.0.1:42819/health", (body) => body.includes("\"ok\":true"));
  log("native host ready");
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
  await ensureHostRunning();

  log("launching desktop overlay");
  log("shortcuts: Alt+Shift+M toggle mouse passthrough, Alt+Shift+Up/Down opacity, Alt+Shift+C reset, Alt+Shift+H hide, Alt+Shift+Q quit");
  const overlayEnv = { ...process.env };
  delete overlayEnv.ELECTRON_RUN_AS_NODE;

  const overlayChild = spawnTagged(electronBinary, ["."], repoRoot, "overlay", {
    env: overlayEnv
  });
  await waitForExit(overlayChild, "overlay");
}

main().catch((error) => {
  console.error(`[desktop] fail: ${error.stack || error}`);
  process.exitCode = 1;
});
