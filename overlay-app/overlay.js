const metaEl = document.getElementById("meta");
const lineEl = document.getElementById("line");

let lastData = null;

function render(data) {
  const title = data.title || "Unknown title";
  const artist = data.artist || "Unknown artist";
  const state = data.isPlaying ? "▶" : "⏸";
  const sec = Number(data.currentTimeSec || 0).toFixed(1);

  metaEl.textContent = `${state} ${artist} · ${title} · ${sec}s`;
  lineEl.textContent = data.line || "...";
}

const source = new EventSource("http://127.0.0.1:42819/stream");

source.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "CONNECTED") {
    metaEl.textContent = "Connected to local host";
    return;
  }

  lastData = data;
  render(data);
};

source.onerror = () => {
  metaEl.textContent = "Disconnected. Retrying...";
};

setInterval(() => {
  if (!lastData || !lastData.isPlaying) return;
  lastData.currentTimeSec += 0.5;
  render(lastData);
}, 500);
