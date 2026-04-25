const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  Menu,
  globalShortcut,
  ipcMain,
  screen,
  shell
} = require("electron");

const PLAYER_URL = "https://music.youtube.com/";
const HOST_PORT = 42819;
const HOST_URL = `http://127.0.0.1:${HOST_PORT}`;
const PLAYER_WIDTH = 1420;
const PLAYER_HEIGHT = 920;
const WINDOW_WIDTH_MIN = 720;
const WINDOW_WIDTH_MAX = 1400;
const WINDOW_HEIGHT = 208;
const WINDOW_BOTTOM_MARGIN = 40;
const WINDOW_OPACITY_DEFAULT = 0.88;
const WINDOW_OPACITY_STEP = 0.05;
const WINDOW_OPACITY_MIN = 0.45;
const WINDOW_OPACITY_MAX = 1;

const SHORTCUTS = {
  toggleMousePassthrough: "Alt+Shift+M",
  opacityUp: "Alt+Shift+Up",
  opacityDown: "Alt+Shift+Down",
  resetPosition: "Alt+Shift+C",
  toggleVisibility: "Alt+Shift+H",
  focusPlayer: "Alt+Shift+P",
  quit: "Alt+Shift+Q"
};

let overlayWindow = null;
let playerWindow = null;
let hostBridge = null;
let mousePassthrough = true;
let overlayOpacity = WINDOW_OPACITY_DEFAULT;
const STARTUP_LOG = path.join(os.tmpdir(), "ytm-floating-lyrics.startup.log");

function writeStartupLog(message) {
  try {
    fs.appendFileSync(STARTUP_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Ignore logging failures.
  }
}

function log(message) {
  writeStartupLog(message);
  console.log(`[desktop] ${message}`);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function currentDisplayWorkArea() {
  const targetDisplay = overlayWindow
    ? screen.getDisplayNearestPoint({
        x: overlayWindow.getBounds().x,
        y: overlayWindow.getBounds().y
      })
    : screen.getPrimaryDisplay();

  return targetDisplay.workArea;
}

function recommendedBounds() {
  const workArea = currentDisplayWorkArea();
  const width = clamp(Math.floor(workArea.width * 0.72), WINDOW_WIDTH_MIN, WINDOW_WIDTH_MAX);
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + workArea.height - WINDOW_HEIGHT - WINDOW_BOTTOM_MARGIN);

  return { x, y, width, height: WINDOW_HEIGHT };
}

function applyWindowMode() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  overlayWindow.setFocusable(!mousePassthrough);
  overlayWindow.setIgnoreMouseEvents(mousePassthrough, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setOpacity(overlayOpacity);
  overlayWindow.moveTop();

  log(`mouse passthrough ${mousePassthrough ? "ON" : "OFF"} | opacity ${overlayOpacity.toFixed(2)}`);
}

function setOverlayOpacity(nextOpacity) {
  overlayOpacity = clamp(nextOpacity, WINDOW_OPACITY_MIN, WINDOW_OPACITY_MAX);
  applyWindowMode();
}

function resetOverlayPosition() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds(recommendedBounds());
  overlayWindow.moveTop();
  log("overlay position reset");
}

function toggleOverlayVisibility() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
    log("overlay hidden");
  } else {
    overlayWindow.showInactive();
    overlayWindow.moveTop();
    log("overlay shown");
  }
}

async function forwardPlaybackEvent(payload) {
  if (!payload?.title) return;

  if (hostBridge?.handleEvent) {
    hostBridge.handleEvent(payload);
    return;
  }

  if (!hostBridge?.url) return;

  try {
    await fetch(`${hostBridge.url}/event`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    log(`failed to forward playback event: ${error.message}`);
  }
}

async function startHostBridge() {
  writeStartupLog("starting host bridge");
  const serverModuleUrl = pathToFileURL(path.join(__dirname, "..", "native-host", "src", "server.mjs")).href;
  const { startLyricsServer } = await import(serverModuleUrl);

  try {
    hostBridge = await startLyricsServer({ port: HOST_PORT });
    log(`native host ready at ${hostBridge.url}`);
    return;
  } catch (error) {
    if (error?.code !== "EADDRINUSE") {
      throw error;
    }

    hostBridge = {
      url: HOST_URL
    };
    log(`native host already running at ${HOST_URL}, reusing existing listener`);
  }
}

function focusPlayerWindow() {
  if (!playerWindow || playerWindow.isDestroyed()) return;
  playerWindow.show();
  playerWindow.focus();
}

function registerShortcuts() {
  const registrations = [
    [SHORTCUTS.toggleMousePassthrough, () => {
      mousePassthrough = !mousePassthrough;
      applyWindowMode();

      if (!mousePassthrough) {
        overlayWindow.show();
        overlayWindow.focus();
      } else {
        overlayWindow.showInactive();
      }
    }],
    [SHORTCUTS.opacityUp, () => setOverlayOpacity(overlayOpacity + WINDOW_OPACITY_STEP)],
    [SHORTCUTS.opacityDown, () => setOverlayOpacity(overlayOpacity - WINDOW_OPACITY_STEP)],
    [SHORTCUTS.resetPosition, resetOverlayPosition],
    [SHORTCUTS.toggleVisibility, toggleOverlayVisibility],
    [SHORTCUTS.focusPlayer, focusPlayerWindow],
    [SHORTCUTS.quit, () => app.quit()]
  ];

  for (const [accelerator, handler] of registrations) {
    const ok = globalShortcut.register(accelerator, handler);
    if (!ok) {
      log(`failed to register shortcut ${accelerator}`);
    }
  }
}

function createPlayerWindow() {
  playerWindow = new BrowserWindow({
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#101218",
    title: "YT Music Floating Lyrics",
    webPreferences: {
      preload: path.join(__dirname, "playback-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  playerWindow.once("ready-to-show", () => {
    playerWindow.show();
  });

  playerWindow.on("closed", () => {
    playerWindow = null;
  });

  playerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(music\.youtube\.com|accounts\.google\.com)\//i.test(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: "#101218",
          webPreferences: {
            preload: path.join(__dirname, "playback-preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false
          }
        }
      };
    }

    void shell.openExternal(url);
    return { action: "deny" };
  });

  void playerWindow.loadURL(PLAYER_URL);
}

function createOverlayWindow() {
  const bounds = recommendedBounds();

  overlayWindow = new BrowserWindow({
    ...bounds,
    title: "Floating Lyrics Overlay",
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    roundedCorners: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);

  overlayWindow.once("ready-to-show", () => {
    overlayWindow.showInactive();
    applyWindowMode();
    log("overlay ready");
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  overlayWindow.on("blur", () => {
    if (mousePassthrough) {
      overlayWindow.showInactive();
      overlayWindow.moveTop();
    }
  });

  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  overlayWindow.loadFile(path.join(__dirname, "..", "overlay-app", "index.html"), {
    query: {
      mode: "desktop",
      host: HOST_URL
    }
  });
}

function bindDisplayEvents() {
  const syncBounds = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    resetOverlayPosition();
  };

  screen.on("display-added", syncBounds);
  screen.on("display-removed", syncBounds);
  screen.on("display-metrics-changed", syncBounds);
}

function bindIpc() {
  ipcMain.on("playback-event", (_event, payload) => {
    void forwardPlaybackEvent(payload);
  });
}

async function bootstrap() {
  writeStartupLog("bootstrap begin");
  await startHostBridge();
  bindIpc();
  createOverlayWindow();
  createPlayerWindow();
  registerShortcuts();
  bindDisplayEvents();

  log(`shortcuts: ${SHORTCUTS.toggleMousePassthrough}=mouse, ${SHORTCUTS.opacityUp}/${SHORTCUTS.opacityDown}=opacity, ${SHORTCUTS.resetPosition}=reset, ${SHORTCUTS.toggleVisibility}=overlay, ${SHORTCUTS.focusPlayer}=player, ${SHORTCUTS.quit}=quit`);
}

process.on("uncaughtException", (error) => {
  writeStartupLog(`uncaughtException: ${error.stack || error}`);
});

process.on("unhandledRejection", (error) => {
  writeStartupLog(`unhandledRejection: ${error?.stack || error}`);
});

writeStartupLog("main module loaded");

if (!app || typeof app.requestSingleInstanceLock !== "function") {
  writeStartupLog("electron app API unavailable");
  throw new Error("Electron app API unavailable");
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (playerWindow && !playerWindow.isDestroyed()) {
      focusPlayerWindow();
    }

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.showInactive();
      applyWindowMode();
      overlayWindow.moveTop();
    }
  });

  app.whenReady().then(bootstrap).catch((error) => {
    console.error(`[desktop] failed to start: ${error.stack || error}`);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  ipcMain.removeAllListeners("playback-event");
});

app.on("will-quit", async () => {
  globalShortcut.unregisterAll();

  if (hostBridge?.close) {
    try {
      await hostBridge.close();
    } catch (error) {
      console.error(`[desktop] failed to stop native host: ${error.stack || error}`);
    }
  }
});
