(() => {
  const POLL_MS = 500;
  const state = {
    lastPayloadKey: "",
    lastSentAt: 0
  };

  function readMediaSession() {
    const metadata = navigator.mediaSession?.metadata;
    if (!metadata) return null;
    return {
      title: (metadata.title || "").trim(),
      artist: (metadata.artist || "").trim()
    };
  }

  function readDomFallback() {
    const titleEl = document.querySelector("yt-formatted-string.title") || document.querySelector(".title");
    const artistEl = document.querySelector("yt-formatted-string.byline") || document.querySelector(".byline");
    return {
      title: (titleEl?.textContent || "").trim(),
      artist: (artistEl?.textContent || "").trim()
    };
  }

  function readCurrentTime() {
    const bar = document.querySelector("#progress-bar");
    if (!bar) return 0;
    const value = Number(bar.getAttribute("value") || 0);
    const max = Number(bar.getAttribute("max") || 0);
    if (!max || Number.isNaN(value) || Number.isNaN(max)) return 0;
    const durationText = document.querySelector(".time-info")?.textContent || "";
    // Fallback: rely on percent only when duration unknown.
    const match = durationText.match(/(\d+:\d+)\s*\/\s*(\d+:\d+)/);
    if (!match) return 0;
    const total = parseTime(match[2]);
    return total * (value / max);
  }

  function parseTime(text) {
    const parts = text.split(":").map((x) => Number(x));
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  function readIsPlaying() {
    const playPause = document.querySelector("tp-yt-paper-icon-button.play-pause-button");
    const title = playPause?.getAttribute("title") || "";
    return !/play/i.test(title);
  }

  function collectPayload() {
    const media = readMediaSession();
    const dom = readDomFallback();
    const title = media?.title || dom.title;
    const artist = media?.artist || dom.artist;
    return {
      source: "ytm-content",
      title,
      artist,
      currentTimeSec: Math.max(0, Number(readCurrentTime().toFixed(2))),
      isPlaying: readIsPlaying(),
      observedAt: Date.now()
    };
  }

  function shouldSend(payload) {
    if (!payload.title) return false;
    const key = `${payload.title}|${payload.artist}|${Math.floor(payload.currentTimeSec)}|${payload.isPlaying}`;
    const now = Date.now();
    if (key === state.lastPayloadKey && now - state.lastSentAt < POLL_MS) return false;
    state.lastPayloadKey = key;
    state.lastSentAt = now;
    return true;
  }

  function tick() {
    const payload = collectPayload();
    if (!shouldSend(payload)) return;
    chrome.runtime.sendMessage({ type: "PLAYBACK_EVENT", payload });
  }

  setInterval(tick, POLL_MS);
  document.addEventListener("visibilitychange", tick);
})();
