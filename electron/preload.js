const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hospitalis', {
  call: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (event, fn) => {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  },
});
