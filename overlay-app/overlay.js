const metaEl = document.getElementById("meta");
const lineEl = document.getElementById("line");

const params = new URLSearchParams(window.location.search);
const desktopMode = params.get("mode") === "desktop" || navigator.userAgent.includes("Electron");
const hostBaseUrl = params.get("host") || "http://127.0.0.1:42819";

document.documentElement.classList.toggle("desktop-mode", desktopMode);

const state = {
  title: "",
  artist: "",
  isPlaying: false,
  currentTimeSec: 0,
  eventReceivedAtMs: 0,
  lines: [],
  lyricsStatus: "loading"
};

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

window.requestAnimationFrame(animationLoop);
