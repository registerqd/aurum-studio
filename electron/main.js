const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const path = require("node:path");
const http = require("node:http");

const isDev = !app.isPackaged;
const DEV_URL = process.env.AURUM_DEV_URL || "http://localhost:3000";
let server = null;
let baseUrl = DEV_URL;

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("server timeout"));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function startProductionServer() {
  // The standalone Next server is shipped in resources/app-server.
  process.env.PORT = "0";
  process.env.HOSTNAME = "127.0.0.1";
  process.env.AURUM_DATA_DIR =
    process.env.AURUM_DATA_DIR || path.join(app.getPath("userData"), "data");
  const serverPath = path.join(process.resourcesPath, "app-server", "server.js");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require(serverPath);
  const port = process.env.PORT;
  baseUrl = `http://127.0.0.1:${port || 3000}`;
  await waitForServer(baseUrl);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#04121a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadURL(baseUrl);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) win.webContents.openDevTools({ mode: "detach" });
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      if (!isDev) await startProductionServer();
      else await waitForServer(DEV_URL).catch(() => null);
      createWindow();
    } catch (error) {
      dialog.showErrorBox(
        "Aurum Studio 启动失败",
        `本地服务未能启动：${error && error.message ? error.message : error}`,
      );
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    if (server && typeof server.close === "function") server.close();
  });
}
