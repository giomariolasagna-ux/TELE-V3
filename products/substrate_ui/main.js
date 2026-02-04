
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        transparent: false, // Changed to false for better compatibility
        frame: true,      // Changed to true for standard window
        alwaysOnTop: false,
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
