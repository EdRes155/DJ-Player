// Proceso principal de Electron (Windows)
import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.ELECTRON_DEV === 'true';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,        // seguridad
      contextIsolation: true,        // seguridad
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // El login de Spotify se abre dentro de la app; enlaces externos van al navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('accounts.spotify.com')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

function buildMenu() {
  const template = [
    { label: 'File', submenu: [{ role: 'quit', label: 'Salir', accelerator: 'Ctrl+Q' }] },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: 'Ctrl+R' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : [])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[Electron] Error no capturado:', err);
});
