
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        transparent: true, // Requires valid system setup, might fail on some VMs but safe to try
        frame: false,      // Frameless for "Overlay" feel
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false // For MVP speed to access IPC
        }
    });

    win.loadFile('index.html');

    // Optional: Open DevTools
    // win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
