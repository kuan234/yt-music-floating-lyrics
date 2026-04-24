(() => {
  const POLL_MS = 250;
  const state = {
    lastPayloadKey: "",
    lastSentAt: 0,
    mediaEl: null
  };

  function getMediaElement() {
    if (state.mediaEl && document.contains(state.mediaEl)) {
      return state.mediaEl;
    }

    state.mediaEl = document.querySelector("video") || document.querySelector("audio");
    return state.mediaEl;
  }

  function readMediaSession() {
    const metadata = navigator.mediaSession?.metadata;
    if (!metadata) return null;

    return {
      title: (metadata.title || "").trim(),
      artist: (metadata.artist || "").trim(),
      album: (metadata.album || "").trim()
    };
  }

  function readDomFallback() {
    const titleEl =
      document.querySelector("ytmusic-player-bar .title") ||
      document.querySelector("yt-formatted-string.title") ||
      document.querySelector(".title");

    const artistEl =
      document.querySelector("ytmusic-player-bar .byline") ||
      document.querySelector("yt-formatted-string.byline") ||
      document.querySelector(".byline");

    return {
      title: (titleEl?.textContent || "").trim(),
      artist: (artistEl?.textContent || "").trim()
    };
  }

  function parseTime(text) {
    const parts = String(text)
      .split(":")
      .map((value) => Number(value));

    if (!parts.length || parts.some(Number.isNaN)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  function readCurrentTime() {
    const media = getMediaElement();
    if (media && Number.isFinite(media.currentTime)) {
      return media.currentTime;
    }

    const elapsedText = document.querySelector(".time-info")?.textContent || "";
    const match = elapsedText.match(/(\d+:\d+(?::\d+)?)/);
    return match ? parseTime(match[1]) : 0;
  }

  function readDuration() {
    const media = getMediaElement();
    if (media && Number.isFinite(media.duration) && media.duration > 0) {
      return media.duration;
    }

    const timeInfo = document.querySelector(".time-info")?.textContent || "";
    const match = timeInfo.match(/(\d+:\d+(?::\d+)?)\s*$/);
    return match ? parseTime(match[1]) : 0;
  }

  function readIsPlaying() {
    const media = getMediaElement();
    if (media) return !media.paused;

    const playPauseButton = document.querySelector("tp-yt-paper-icon-button.play-pause-button");
    const title = playPauseButton?.getAttribute("title") || "";
    return !/play/i.test(title);
  }

  function collectPayload() {
    const media = readMediaSession();
    const dom = readDomFallback();
    const title = media?.title || dom.title;
    const artist = media?.artist || dom.artist;
    const currentTimeSec = Math.max(0, Number(readCurrentTime().toFixed(2)));
    const durationSec = Math.max(0, Number(readDuration().toFixed(2)));

    return {
      source: "ytm-content",
      title,
      artist,
      album: media?.album || "",
      durationSec,
      currentTimeSec,
      isPlaying: readIsPlaying(),
      observedAt: Date.now()
    };
  }

  function shouldSend(payload) {
    if (!payload.title) return false;

    const quantizedTime = Math.round(payload.currentTimeSec * 4) / 4;
    const key = `${payload.title}|${payload.artist}|${payload.isPlaying}|${quantizedTime}`;
    const now = Date.now();

    if (key === state.lastPayloadKey && now - state.lastSentAt < POLL_MS) {
      return false;
    }

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
  window.addEventListener("yt-navigate-finish", tick);
  window.addEventListener("focus", tick);
  window.addEventListener("pageshow", tick);
})();
