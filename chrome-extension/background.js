const HOST = "http://127.0.0.1:42819/event";
const RETRY_BASE_MS = 250;

let backoffMs = RETRY_BASE_MS;

async function sendToHost(payload) {
  const response = await fetch(HOST, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`host ${response.status}`);
  }

  backoffMs = RETRY_BASE_MS;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "PLAYBACK_EVENT") return;

  sendToHost(message.payload).catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    backoffMs = Math.min(4000, backoffMs * 2);
  });
});
