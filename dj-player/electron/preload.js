// Puente seguro entre Electron y la app web
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', { isElectron: true });
