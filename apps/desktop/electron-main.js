const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const HTTP_PORT = 3000;

let mainWindow;

function getServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  return path.join(__dirname, '..', 'local-server');
}

function waitForServer(url, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Server did not start within ${timeout}ms`));
        } else {
          setTimeout(check, 200);
        }
      });
      req.end();
    }
    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Force Plate Dashboard',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${HTTP_PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const serverDir = getServerPath();

  const fs = require('fs');
  const sessionsDir = path.join(serverDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  // Set CWD so the server's process.cwd() calls resolve public/ and sessions/
  process.chdir(serverDir);

  try {
    const serverEntry = pathToFileURL(path.join(serverDir, 'dist', 'index.js')).href;
    await import(serverEntry);
    await waitForServer(`http://localhost:${HTTP_PORT}`);
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      'Failed to start server',
      `The backend server could not start.\n\n${err.message || err}`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
