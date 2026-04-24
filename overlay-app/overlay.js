const metaEl = document.getElementById("meta");
const lineEl = document.getElementById("line");

const source = new EventSource("http://127.0.0.1:42819/stream");

source.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "CONNECTED") {
    metaEl.textContent = "Connected to local host";
    return;
  }

  const title = data.title || "Unknown title";
  const artist = data.artist || "Unknown artist";
  metaEl.textContent = `${artist} · ${title}`;
  lineEl.textContent = data.line || "...";
};

source.onerror = () => {
  metaEl.textContent = "Disconnected. Retrying...";
};
