const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("aurumDesktop", {
  platform: process.platform,
  version: process.versions.electron,
  isDesktop: true,
});
