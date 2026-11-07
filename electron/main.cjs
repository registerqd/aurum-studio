const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { fork } = require("node:child_process");

const isDev = !app.isPackaged;
const DEV_URL = process.env.AURUM_DEV_URL || "http://127.0.0.1:3000";
let serverProcess = null;
let baseUrl = DEV_URL;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("Local server launch timed out"));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function startProductionServer() {
  const port = await findFreePort();
  const dataDir = process.env.AURUM_DATA_DIR || path.join(app.getPath("userData"), "data");
  const serverPath = path.join(process.resourcesPath, "app-server", "server.js");

  // Run the standalone Next.js server as a child process using Electron's bundled Node runtime
  serverProcess = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      AURUM_DATA_DIR: dataDir,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  });

  baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#070a0f",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
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
      if (!isDev) {
        await startProductionServer();
      } else {
        await waitForServer(DEV_URL).catch(() => null);
      }
      createWindow();
    } catch (error) {
      dialog.showErrorBox(
        "MOLDA Studio 启动失败",
        `本地服务未能启动：${error && error.message ? error.message : error}`
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
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch {}
    }
  });
}
