import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { controlService, getServices, getSystemInfo } from './services-manager';
import type { ServiceScope, ServiceStateFilter } from './types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    title: 'Services Manager',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// Register IPC handlers for services management
function registerIpcHandlers() {
  ipcMain.handle(
    'services:get-list',
    async (
      _event,
      args: { scope: ServiceScope; filter: ServiceStateFilter },
    ) => {
      try {
        return await getServices(args.scope, args.filter);
      } catch (err: unknown) {
        console.error('Error fetching services:', err);
        throw err;
      }
    },
  );

  ipcMain.handle(
    'services:control',
    async (
      _event,
      args: {
        action: 'start' | 'stop' | 'restart';
        name: string;
        scope: ServiceScope;
      },
    ) => {
      try {
        return await controlService(args.action, args.name, args.scope);
      } catch (err: unknown) {
        console.error('Error controlling service:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('services:get-system-info', () => {
    return getSystemInfo();
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
