const path = require("node:path");
const { app, BrowserWindow, Menu, globalShortcut, screen } = require("electron");

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
  quit: "Alt+Shift+Q"
};

let overlayWindow = null;
let mousePassthrough = true;
let overlayOpacity = WINDOW_OPACITY_DEFAULT;

function log(message) {
  console.log(`[desktop-overlay] ${message}`);
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
  log("position reset to bottom-center");
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
    [SHORTCUTS.quit, () => app.quit()]
  ];

  for (const [accelerator, handler] of registrations) {
    const ok = globalShortcut.register(accelerator, handler);
    if (!ok) {
      log(`failed to register shortcut ${accelerator}`);
    }
  }

  log(`shortcuts: ${SHORTCUTS.toggleMousePassthrough}=mouse, ${SHORTCUTS.opacityUp}/${SHORTCUTS.opacityDown}=opacity, ${SHORTCUTS.resetPosition}=reset, ${SHORTCUTS.toggleVisibility}=hide, ${SHORTCUTS.quit}=quit`);
}

function createOverlayWindow() {
  const bounds = recommendedBounds();

  overlayWindow = new BrowserWindow({
    ...bounds,
    title: "YT Music Floating Lyrics",
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
    log("window ready");
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
      mode: "desktop"
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.showInactive();
    applyWindowMode();
    overlayWindow.moveTop();
  });

  app.whenReady().then(() => {
    createOverlayWindow();
    registerShortcuts();
    bindDisplayEvents();
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
