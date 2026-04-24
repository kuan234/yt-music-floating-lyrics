const HOST = "http://127.0.0.1:42819/event";
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 4000;

let backoffMs = RETRY_BASE_MS;
let isFlushing = false;
let latestPayload = null;

async function postPayload(payload) {
  const response = await fetch(HOST, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`host ${response.status}`);
  }
}

async function flushLoop() {
  if (isFlushing) return;
  isFlushing = true;

  while (latestPayload) {
    const payload = latestPayload;
    latestPayload = null;

    try {
      await postPayload(payload);
      backoffMs = RETRY_BASE_MS;
    } catch (error) {
      console.warn("[background] failed to post playback event", error);
      latestPayload = payload;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(RETRY_MAX_MS, backoffMs * 2);
    }
  }

  isFlushing = false;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "PLAYBACK_EVENT" || !message.payload) return;

  // Coalescing: only keep the newest payload while the host is unavailable.
  latestPayload = message.payload;
  flushLoop();
});
