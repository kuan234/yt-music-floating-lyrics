const metaEl = document.getElementById("meta");
const lineEl = document.getElementById("line");
const toolsEl = document.getElementById("window-tools");
const sizeReadoutEl = document.getElementById("size-readout");
const resetSizeEl = document.getElementById("reset-size");
const resizeHandleEl = document.getElementById("resize-handle");

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
  desktop: {
    interactive: false,
    bounds: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    resizing: false,
    resizeStart: null
  }
};

function syncDesktopUi() {
  const active = desktopMode && Boolean(desktopBridge);
  const interactive = active && state.desktop.interactive;

  document.documentElement.classList.toggle("interactive-mode", interactive);
  document.documentElement.classList.toggle("resize-active", Boolean(state.desktop.resizing));

  toolsEl.hidden = !interactive;
  resizeHandleEl.hidden = !interactive;

  if (state.desktop.bounds) {
    sizeReadoutEl.textContent = `${Math.round(state.desktop.bounds.width)} x ${Math.round(state.desktop.bounds.height)}`;
  }
}

function applyDesktopState(payload = {}) {
  if (typeof payload.interactive === "boolean") {
    state.desktop.interactive = payload.interactive;
  }

  if (payload.bounds) {
    state.desktop.bounds = payload.bounds;
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
    if (state.lyricsStatus === "loading") return "Searching synced lyrics...";
    if (state.lyricsStatus === "missing") return "No synced lyrics found.";
    return "...";
  }

  const currentMs = Math.floor(currentSec * 1000);
  let left = 0;
  let right = state.lines.length - 1;
  let answer = 0;

  while (left <= right) {
    const mid = (left + right) >> 1;
    if (state.lines[mid].startMs <= currentMs) {
      answer = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return state.lines[answer]?.text || "...";
}

function render() {
  const title = state.title || "Unknown title";
  const artist = state.artist || "Unknown artist";
  const playState = state.isPlaying ? ">" : "||";
  const sec = effectiveCurrentTimeSec();

  metaEl.textContent = `${playState} ${artist} | ${title} | ${sec.toFixed(1)}s`;
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
