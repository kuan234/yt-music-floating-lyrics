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
const WINDOW_ICON_PATH = path.join(__dirname, "assets", "icon.png");
const PLAYER_WIDTH = 1420;
const PLAYER_HEIGHT = 920;
const WINDOW_WIDTH_MIN = 420;
const WINDOW_WIDTH_DEFAULT_MIN = 720;
const WINDOW_WIDTH_DEFAULT_MAX = 1400;
const WINDOW_HEIGHT_MIN = 140;
const WINDOW_HEIGHT_DEFAULT = 208;
const WINDOW_BOTTOM_MARGIN = 40;
const WINDOW_WORKAREA_MARGIN = 24;
const WINDOW_OPACITY_DEFAULT = 0.88;
const WINDOW_OPACITY_STEP = 0.05;
const WINDOW_OPACITY_MIN = 0.45;
const WINDOW_OPACITY_MAX = 1;
const FONT_SIZE_MIN = 24;
const FONT_SIZE_MAX = 72;
const FONT_SIZE_DEFAULT = 42;
const TEXT_OFFSET_MIN = -220;
const TEXT_OFFSET_MAX = 220;
const FONT_PRESETS = {
  default: '"Segoe UI", "Microsoft YaHei UI", "Yu Gothic UI", sans-serif',
  serif: '"Georgia", "Times New Roman", "Noto Serif JP", serif',
  compact: '"Bahnschrift", "Segoe UI Semibold", "Microsoft YaHei UI", sans-serif'
};
const VERTICAL_ANCHORS = new Set(["top", "center", "bottom"]);

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
let overlaySettingsPath = "";
let overlaySettingsSaveTimer = null;
let overlayBoundsPreference = null;
let overlayPreferences = defaultOverlayPreferences();

function defaultOverlayPreferences() {
  return {
    fontPreset: "default",
    fontSizePx: FONT_SIZE_DEFAULT,
    textOffsetX: 0,
    textOffsetY: 0,
    verticalAnchor: "bottom"
  };
}

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

function displayWorkAreaForBounds(bounds) {
  const targetPoint = bounds
    ? { x: bounds.x, y: bounds.y }
    : screen.getPrimaryDisplay().workArea;

  return screen.getDisplayNearestPoint(targetPoint).workArea;
}

function currentDisplayWorkArea() {
  return overlayWindow
    ? displayWorkAreaForBounds(overlayWindow.getBounds())
    : screen.getPrimaryDisplay().workArea;
}

function overlaySizeLimits(bounds = null) {
  const workArea = displayWorkAreaForBounds(bounds);

  return {
    minWidth: WINDOW_WIDTH_MIN,
    maxWidth: Math.max(WINDOW_WIDTH_MIN, workArea.width - WINDOW_WORKAREA_MARGIN * 2),
    minHeight: WINDOW_HEIGHT_MIN,
    maxHeight: Math.max(WINDOW_HEIGHT_MIN, workArea.height - WINDOW_WORKAREA_MARGIN * 2)
  };
}

function fitBoundsToWorkArea(bounds, workArea) {
  const limits = overlaySizeLimits(bounds);
  const width = clamp(Math.round(bounds.width || WINDOW_WIDTH_DEFAULT_MIN), limits.minWidth, limits.maxWidth);
  const height = clamp(Math.round(bounds.height || WINDOW_HEIGHT_DEFAULT), limits.minHeight, limits.maxHeight);
  const x = clamp(
    Math.round(Number.isFinite(bounds.x) ? bounds.x : workArea.x),
    workArea.x,
    workArea.x + workArea.width - width
  );
  const y = clamp(
    Math.round(Number.isFinite(bounds.y) ? bounds.y : workArea.y),
    workArea.y,
    workArea.y + workArea.height - height
  );

  return { x, y, width, height };
}

function sanitizedOverlayBounds(bounds = null) {
  if (!bounds) return recommendedBounds();
  const workArea = displayWorkAreaForBounds(bounds);
  return fitBoundsToWorkArea(bounds, workArea);
}

function recommendedBounds() {
  const workArea = currentDisplayWorkArea();
  const width = clamp(
    Math.floor(workArea.width * 0.72),
    WINDOW_WIDTH_DEFAULT_MIN,
    Math.min(WINDOW_WIDTH_DEFAULT_MAX, workArea.width - WINDOW_WORKAREA_MARGIN * 2)
  );
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + workArea.height - WINDOW_HEIGHT_DEFAULT - WINDOW_BOTTOM_MARGIN);

  return { x, y, width, height: WINDOW_HEIGHT_DEFAULT };
}

function sanitizeOverlayPreferences(input = {}) {
  const defaults = defaultOverlayPreferences();
  const fontPreset = typeof input.fontPreset === "string" && FONT_PRESETS[input.fontPreset]
    ? input.fontPreset
    : defaults.fontPreset;
  const verticalAnchor = typeof input.verticalAnchor === "string" && VERTICAL_ANCHORS.has(input.verticalAnchor)
    ? input.verticalAnchor
    : defaults.verticalAnchor;

  return {
    fontPreset,
    fontSizePx: clamp(Number(input.fontSizePx || defaults.fontSizePx), FONT_SIZE_MIN, FONT_SIZE_MAX),
    textOffsetX: clamp(Number(input.textOffsetX || 0), TEXT_OFFSET_MIN, TEXT_OFFSET_MAX),
    textOffsetY: clamp(Number(input.textOffsetY || 0), TEXT_OFFSET_MIN, TEXT_OFFSET_MAX),
    verticalAnchor
  };
}

function anchoredBoundsForPreference(anchor, bounds = null) {
  const workArea = displayWorkAreaForBounds(bounds);
  const fitted = fitBoundsToWorkArea(bounds || overlayBoundsPreference || recommendedBounds(), workArea);
  const x = Math.round(workArea.x + (workArea.width - fitted.width) / 2);
  let y = fitted.y;

  if (anchor === "top") {
    y = workArea.y + WINDOW_WORKAREA_MARGIN;
  } else if (anchor === "center") {
    y = workArea.y + Math.round((workArea.height - fitted.height) / 2);
  } else {
    y = workArea.y + workArea.height - fitted.height - WINDOW_BOTTOM_MARGIN;
  }

  return fitBoundsToWorkArea({ ...fitted, x, y }, workArea);
}

function currentOverlaySettingsSnapshot() {
  return {
    bounds: overlayWindow && !overlayWindow.isDestroyed()
      ? overlayWindow.getBounds()
      : overlayBoundsPreference || recommendedBounds(),
    opacity: overlayOpacity,
    mousePassthrough,
    preferences: overlayPreferences
  };
}

function saveOverlaySettingsNow() {
  if (!overlaySettingsPath) return;

  try {
    fs.mkdirSync(path.dirname(overlaySettingsPath), { recursive: true });
    fs.writeFileSync(
      overlaySettingsPath,
      JSON.stringify(currentOverlaySettingsSnapshot(), null, 2),
      "utf8"
    );
  } catch (error) {
    log(`failed to save overlay settings: ${error.message}`);
  }
}

function scheduleOverlaySettingsSave() {
  if (overlaySettingsSaveTimer) {
    clearTimeout(overlaySettingsSaveTimer);
  }

  overlaySettingsSaveTimer = setTimeout(() => {
    overlaySettingsSaveTimer = null;
    saveOverlaySettingsNow();
  }, 160);
}

function loadOverlaySettings() {
  overlaySettingsPath = path.join(app.getPath("userData"), "overlay-settings.json");

  try {
    if (!fs.existsSync(overlaySettingsPath)) {
      overlayBoundsPreference = recommendedBounds();
      return;
    }

    const raw = fs.readFileSync(overlaySettingsPath, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed?.bounds) {
      overlayBoundsPreference = sanitizedOverlayBounds(parsed.bounds);
    }

    if (Number.isFinite(parsed?.opacity)) {
      overlayOpacity = clamp(Number(parsed.opacity), WINDOW_OPACITY_MIN, WINDOW_OPACITY_MAX);
    }

    if (typeof parsed?.mousePassthrough === "boolean") {
      mousePassthrough = parsed.mousePassthrough;
    }

    overlayPreferences = sanitizeOverlayPreferences(parsed?.preferences || {});
  } catch (error) {
    log(`failed to load overlay settings: ${error.message}`);
    overlayBoundsPreference = recommendedBounds();
    overlayPreferences = defaultOverlayPreferences();
  }
}

function emitOverlayState() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayWindow.webContents.isLoadingMainFrame()) return;

  const bounds = overlayWindow.getBounds();
  overlayWindow.webContents.send("overlay-state", {
    interactive: !mousePassthrough,
    opacity: overlayOpacity,
    bounds,
    limits: overlaySizeLimits(bounds),
    preferences: overlayPreferences
  });
}

function setOverlayBounds(nextBounds, { announce = false } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  const sanitized = sanitizedOverlayBounds(nextBounds);
  overlayWindow.setBounds(sanitized);
  overlayWindow.moveTop();
  overlayBoundsPreference = sanitized;
  scheduleOverlaySettingsSave();

  if (announce) {
    log(`overlay bounds ${sanitized.width}x${sanitized.height} @ ${sanitized.x},${sanitized.y}`);
  }
}

function resizeOverlayWindow(size = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  const current = overlayWindow.getBounds();
  const workArea = displayWorkAreaForBounds(current);
  const limits = overlaySizeLimits(current);
  const width = clamp(
    Math.round(Number(size.width || current.width)),
    limits.minWidth,
    limits.maxWidth
  );
  const height = clamp(
    Math.round(Number(size.height || current.height)),
    limits.minHeight,
    limits.maxHeight
  );

  setOverlayBounds({
    width,
    height,
    x: Math.round(current.x + (current.width - width) / 2),
    y: Math.round(current.y + current.height - height)
  });

  // Keep the window inside the active display after anchored resizing.
  const fitted = fitBoundsToWorkArea(overlayWindow.getBounds(), workArea);
  overlayWindow.setBounds(fitted);
  overlayBoundsPreference = fitted;
  emitOverlayState();
}

function applyWindowMode() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  overlayWindow.setFocusable(!mousePassthrough);
  overlayWindow.setIgnoreMouseEvents(mousePassthrough, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setOpacity(overlayOpacity);
  overlayWindow.moveTop();
  scheduleOverlaySettingsSave();
  emitOverlayState();

  log(`mouse passthrough ${mousePassthrough ? "ON" : "OFF"} | opacity ${overlayOpacity.toFixed(2)}`);
}

function setOverlayOpacity(nextOpacity) {
  overlayOpacity = clamp(nextOpacity, WINDOW_OPACITY_MIN, WINDOW_OPACITY_MAX);
  applyWindowMode();
}

function applyOverlayAnchor(anchor, { announce = false } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  setOverlayBounds(anchoredBoundsForPreference(anchor, overlayWindow.getBounds()), { announce });
}

function updateOverlayPreferences(nextPreferences = {}) {
  const previousAnchor = overlayPreferences.verticalAnchor;
  overlayPreferences = sanitizeOverlayPreferences({
    ...overlayPreferences,
    ...nextPreferences
  });
  scheduleOverlaySettingsSave();

  if (overlayPreferences.verticalAnchor !== previousAnchor) {
    applyOverlayAnchor(overlayPreferences.verticalAnchor, { announce: true });
  } else {
    emitOverlayState();
  }
}

function resetOverlayStyle() {
  overlayPreferences = defaultOverlayPreferences();
  scheduleOverlaySettingsSave();
  applyOverlayAnchor(overlayPreferences.verticalAnchor, { announce: true });
}

function resetOverlayPosition() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  setOverlayBounds(anchoredBoundsForPreference(overlayPreferences.verticalAnchor, recommendedBounds()));
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
    hostBridge = await startLyricsServer({
      port: HOST_PORT,
      cachePath: path.join(app.getPath("userData"), "lyrics-cache.json")
    });
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
    icon: WINDOW_ICON_PATH,
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
  const bounds = overlayBoundsPreference || recommendedBounds();

  overlayWindow = new BrowserWindow({
    ...bounds,
    icon: WINDOW_ICON_PATH,
    title: "Floating Lyrics Overlay",
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    minWidth: WINDOW_WIDTH_MIN,
    minHeight: WINDOW_HEIGHT_MIN,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    roundedCorners: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);

  overlayWindow.once("ready-to-show", () => {
    overlayWindow.showInactive();
    applyWindowMode();
    emitOverlayState();
    log("overlay ready");
  });

  overlayWindow.webContents.on("did-finish-load", () => {
    emitOverlayState();
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

  const syncOverlayMetrics = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayBoundsPreference = overlayWindow.getBounds();
    scheduleOverlaySettingsSave();
    emitOverlayState();
  };

  overlayWindow.on("move", syncOverlayMetrics);
  overlayWindow.on("resize", syncOverlayMetrics);

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

  ipcMain.on("overlay-request-state", () => {
    emitOverlayState();
  });

  ipcMain.on("overlay-resize", (_event, size) => {
    resizeOverlayWindow(size);
  });

  ipcMain.on("overlay-reset-bounds", () => {
    resetOverlayPosition();
  });

  ipcMain.on("overlay-set-opacity", (_event, payload) => {
    setOverlayOpacity(Number(payload?.opacity || overlayOpacity));
  });

  ipcMain.on("overlay-update-preferences", (_event, payload) => {
    updateOverlayPreferences(payload || {});
  });

  ipcMain.on("overlay-reset-style", () => {
    resetOverlayStyle();
  });

  ipcMain.on("overlay-snap-position", (_event, payload) => {
    const anchor = typeof payload?.anchor === "string" ? payload.anchor : overlayPreferences.verticalAnchor;
    updateOverlayPreferences({ verticalAnchor: anchor });
  });
}

async function bootstrap() {
  writeStartupLog("bootstrap begin");
  loadOverlaySettings();
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
  ipcMain.removeAllListeners("overlay-request-state");
  ipcMain.removeAllListeners("overlay-resize");
  ipcMain.removeAllListeners("overlay-reset-bounds");
  ipcMain.removeAllListeners("overlay-set-opacity");
  ipcMain.removeAllListeners("overlay-update-preferences");
  ipcMain.removeAllListeners("overlay-reset-style");
  ipcMain.removeAllListeners("overlay-snap-position");
});

app.on("will-quit", async () => {
  globalShortcut.unregisterAll();

  if (overlaySettingsSaveTimer) {
    clearTimeout(overlaySettingsSaveTimer);
    overlaySettingsSaveTimer = null;
  }
  saveOverlaySettingsNow();

  if (hostBridge?.close) {
    try {
      await hostBridge.close();
    } catch (error) {
      console.error(`[desktop] failed to stop native host: ${error.stack || error}`);
    }
  }
});
