import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const electronBinary = process.platform === "win32"
  ? path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe")
  : path.join(repoRoot, "node_modules", ".bin", "electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd: repoRoot,
  stdio: "inherit",
  env
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.once("error", (error) => {
  console.error(`[desktop] failed to launch electron: ${error.stack || error}`);
  process.exit(1);
});
