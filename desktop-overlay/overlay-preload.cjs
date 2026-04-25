const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayDesktop", {
  requestState() {
    ipcRenderer.send("overlay-request-state");
  },
  resizeWindow(size) {
    ipcRenderer.send("overlay-resize", size);
  },
  resetBounds() {
    ipcRenderer.send("overlay-reset-bounds");
  },
  onState(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, payload) => {
      callback(payload);
    };

    ipcRenderer.on("overlay-state", listener);
    return () => {
      ipcRenderer.removeListener("overlay-state", listener);
    };
  }
});
