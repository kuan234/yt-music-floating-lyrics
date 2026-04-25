const metaEl = document.getElementById("meta");
const lineEl = document.getElementById("line");
const toolsEl = document.getElementById("window-tools");
const sizeReadoutEl = document.getElementById("size-readout");
const resetSizeEl = document.getElementById("reset-size");
const resizeHandleEl = document.getElementById("resize-handle");
const toggleSettingsEl = document.getElementById("toggle-settings");
const closeSettingsEl = document.getElementById("close-settings");
const settingsPanelEl = document.getElementById("settings-panel");
const fontPresetEl = document.getElementById("font-preset");
const fontSizeEl = document.getElementById("font-size");
const fontSizeValueEl = document.getElementById("font-size-value");
const windowOpacityEl = document.getElementById("window-opacity");
const windowOpacityValueEl = document.getElementById("window-opacity-value");
const textOffsetXEl = document.getElementById("text-offset-x");
const textOffsetXValueEl = document.getElementById("text-offset-x-value");
const textOffsetYEl = document.getElementById("text-offset-y");
const textOffsetYValueEl = document.getElementById("text-offset-y-value");
const positionButtons = [...document.querySelectorAll("#position-buttons button")];
const resetStyleEl = document.getElementById("reset-style");
const resetPositionEl = document.getElementById("reset-position");

const FONT_STACKS = {
  default: '"Segoe UI", "Microsoft YaHei UI", "Yu Gothic UI", sans-serif',
  serif: '"Georgia", "Times New Roman", "Noto Serif JP", serif',
  compact: '"Bahnschrift", "Segoe UI Semibold", "Microsoft YaHei UI", sans-serif'
};

const params = new URLSearchParams(window.location.search);
const desktopMode = params.get("mode") === "desktop" || navigator.userAgent.includes("Electron");
const hostBaseUrl = params.get("host") || "http://127.0.0.1:42819";
const desktopBridge = window.overlayDesktop || null;

document.documentElement.classList.toggle("desktop-mode", desktopMode);

const state = {
  title: "",
  artist: "",
  isPlaying: false,
  currentTimeSec: 0,
  eventReceivedAtMs: 0,
  lines: [],
  lyricsStatus: "loading",
  lyricsSource: "pending",
  ui: {
    settingsOpen: false
  },
  desktop: {
    interactive: false,
    opacity: 0.88,
    bounds: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    preferences: {
      fontPreset: "default",
      fontSizePx: 42,
      textOffsetX: 0,
      textOffsetY: 0,
      verticalAnchor: "bottom"
    },
    resizing: false,
    resizeStart: null
  }
};

function updateOutputValue(outputEl, value) {
  outputEl.textContent = value;
}

function syncControlValue(inputEl, value) {
  if (document.activeElement !== inputEl) {
    inputEl.value = String(value);
  }
}

function applyPreferenceStyles() {
  const { fontPreset, fontSizePx, textOffsetX, textOffsetY } = state.desktop.preferences;
  document.documentElement.style.setProperty("--font-stack", FONT_STACKS[fontPreset] || FONT_STACKS.default);
  document.documentElement.style.setProperty("--line-font-size", `${fontSizePx}px`);
  document.documentElement.style.setProperty("--text-offset-x", `${textOffsetX}px`);
  document.documentElement.style.setProperty("--text-offset-y", `${textOffsetY}px`);
}

function syncSettingsControls() {
  const { preferences, opacity } = state.desktop;

  syncControlValue(fontPresetEl, preferences.fontPreset);
  syncControlValue(fontSizeEl, preferences.fontSizePx);
  syncControlValue(windowOpacityEl, opacity);
  syncControlValue(textOffsetXEl, preferences.textOffsetX);
  syncControlValue(textOffsetYEl, preferences.textOffsetY);

  updateOutputValue(fontSizeValueEl, `${Math.round(preferences.fontSizePx)}px`);
  updateOutputValue(windowOpacityValueEl, `${Math.round(opacity * 100)}%`);
  updateOutputValue(textOffsetXValueEl, `${Math.round(preferences.textOffsetX)}px`);
  updateOutputValue(textOffsetYValueEl, `${Math.round(preferences.textOffsetY)}px`);

  for (const button of positionButtons) {
    button.classList.toggle("active", button.dataset.anchor === preferences.verticalAnchor);
  }
}

function setSettingsOpen(open) {
  state.ui.settingsOpen = Boolean(open) && desktopMode && state.desktop.interactive;
  syncDesktopUi();
}

function syncDesktopUi() {
  const active = desktopMode && Boolean(desktopBridge);
  const interactive = active && state.desktop.interactive;
  const settingsVisible = interactive && state.ui.settingsOpen;

  document.documentElement.classList.toggle("interactive-mode", interactive);
  document.documentElement.classList.toggle("resize-active", Boolean(state.desktop.resizing));
  document.documentElement.classList.toggle("settings-open", settingsVisible);

  toolsEl.hidden = !interactive;
  resizeHandleEl.hidden = !interactive;
  settingsPanelEl.hidden = !settingsVisible;

  if (!interactive) {
    state.ui.settingsOpen = false;
  }

  if (state.desktop.bounds) {
    sizeReadoutEl.textContent = `${Math.round(state.desktop.bounds.width)} x ${Math.round(state.desktop.bounds.height)}`;
  }

  applyPreferenceStyles();
  syncSettingsControls();
}

function applyDesktopState(payload = {}) {
  if (typeof payload.interactive === "boolean") {
    state.desktop.interactive = payload.interactive;
  }

  if (payload.bounds) {
    state.desktop.bounds = payload.bounds;
  }

  if (typeof payload.opacity === "number") {
    state.desktop.opacity = payload.opacity;
  }

  if (payload.preferences) {
    state.desktop.preferences = {
      ...state.desktop.preferences,
      ...payload.preferences
    };
  }

  syncDesktopUi();
}

function effectiveCurrentTimeSec() {
  if (!state.isPlaying) return state.currentTimeSec;
  const elapsedSec = (performance.now() - state.eventReceivedAtMs) / 1000;
  return state.currentTimeSec + elapsedSec;
}

function currentLineText(currentSec) {
  if (!state.lines.length) {
    if (state.lyricsStatus === "loading") return "Searching lyrics across sources...";
    if (state.lyricsStatus === "missing") return "No synced lyrics found.";
    return "...";
  }

  const currentMs = Math.floor(currentSec * 1000);
  let left = 0;
  let right = state.lines.length - 1;
  let answer = -1;

  while (left <= right) {
    const mid = (left + right) >> 1;
    if (state.lines[mid].startMs <= currentMs) {
      answer = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (answer < 0) {
    return "...";
  }

  return state.lines[answer]?.text || "...";
}

function render() {
  const title = state.title || "Unknown title";
  const artist = state.artist || "Unknown artist";
  const playState = state.isPlaying ? ">" : "||";
  const sec = effectiveCurrentTimeSec();
  const sourceLabel = state.lyricsSource && state.lyricsSource !== "pending"
    ? ` | ${state.lyricsSource}`
    : "";

  metaEl.textContent = `${playState} ${artist} | ${title} | ${sec.toFixed(1)}s${sourceLabel}`;
  lineEl.textContent = currentLineText(sec);
}

function applyPayload(data) {
  state.title = data.title || state.title;
  state.artist = data.artist || state.artist;
  state.isPlaying = Boolean(data.isPlaying);
  state.currentTimeSec = Math.max(0, Number(data.currentTimeSec || 0));
  state.eventReceivedAtMs = performance.now();

  if (Array.isArray(data.lines)) {
    state.lines = data.lines;
  }

  if (data.lyricsStatus) {
    state.lyricsStatus = data.lyricsStatus;
  }

  if (data.lyricsSource) {
    state.lyricsSource = data.lyricsSource;
  }
}

function endResize() {
  if (!state.desktop.resizing) return;

  state.desktop.resizing = false;
  state.desktop.resizeStart = null;
  syncDesktopUi();
  window.removeEventListener("pointermove", handleResizeMove);
  window.removeEventListener("pointerup", endResize);
}

function handleResizeMove(event) {
  const resizeStart = state.desktop.resizeStart;
  if (!resizeStart || !desktopBridge) return;

  desktopBridge.resizeWindow({
    width: resizeStart.width + (event.screenX - resizeStart.screenX),
    height: resizeStart.height + (event.screenY - resizeStart.screenY)
  });
}

function beginResize(event) {
  if (!desktopBridge || !state.desktop.interactive) return;

  event.preventDefault();
  state.desktop.resizing = true;
  state.desktop.resizeStart = {
    screenX: event.screenX,
    screenY: event.screenY,
    width: state.desktop.bounds?.width || window.innerWidth,
    height: state.desktop.bounds?.height || window.innerHeight
  };

  syncDesktopUi();
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", endResize, { once: true });
}

if (desktopBridge?.onState) {
  desktopBridge.onState(applyDesktopState);
  desktopBridge.requestState();
}

resetSizeEl.addEventListener("click", () => {
  desktopBridge?.resetBounds();
});

toggleSettingsEl.addEventListener("click", () => {
  setSettingsOpen(!state.ui.settingsOpen);
});

closeSettingsEl.addEventListener("click", () => {
  setSettingsOpen(false);
});

fontPresetEl.addEventListener("change", () => {
  desktopBridge?.updatePreferences({ fontPreset: fontPresetEl.value });
});

fontSizeEl.addEventListener("input", () => {
  const value = Number(fontSizeEl.value);
  updateOutputValue(fontSizeValueEl, `${Math.round(value)}px`);
  desktopBridge?.updatePreferences({ fontSizePx: value });
});

windowOpacityEl.addEventListener("input", () => {
  const value = Number(windowOpacityEl.value);
  updateOutputValue(windowOpacityValueEl, `${Math.round(value * 100)}%`);
  desktopBridge?.setOpacity(value);
});

textOffsetXEl.addEventListener("input", () => {
  const value = Number(textOffsetXEl.value);
  updateOutputValue(textOffsetXValueEl, `${Math.round(value)}px`);
  desktopBridge?.updatePreferences({ textOffsetX: value });
});

textOffsetYEl.addEventListener("input", () => {
  const value = Number(textOffsetYEl.value);
  updateOutputValue(textOffsetYValueEl, `${Math.round(value)}px`);
  desktopBridge?.updatePreferences({ textOffsetY: value });
});

for (const button of positionButtons) {
  button.addEventListener("click", () => {
    desktopBridge?.snapPosition(button.dataset.anchor);
  });
}

resetStyleEl.addEventListener("click", () => {
  desktopBridge?.resetStyle();
});

resetPositionEl.addEventListener("click", () => {
  desktopBridge?.resetBounds();
});

resizeHandleEl.addEventListener("pointerdown", beginResize);

const source = new EventSource(`${hostBaseUrl}/stream`);

source.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "CONNECTED") {
    metaEl.textContent = "Connected to local host";
    return;
  }

  applyPayload(data);
  render();
};

source.onerror = () => {
  metaEl.textContent = "Disconnected. Retrying...";
};

function animationLoop() {
  render();
  window.requestAnimationFrame(animationLoop);
}

syncDesktopUi();
window.requestAnimationFrame(animationLoop);
