const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
require('electron-reload')(__dirname, {
  electron: require(path.join(__dirname, '../node_modules/electron'))
});

let mainWindow;
const downloads = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false, // Remove default window frame
    resizable: false, // Make window size fixed
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#f3f4f6', // Match Tailwind's bg-gray-100
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Handle window controls
  ipcMain.handle('minimize-window', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('close-window', () => {
    app.quit();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

// Parse aria2c output for detailed progress
function parseAria2Output(data) {
  const progressMatch = data.match(/(\d+)%/);
  const speedMatch = data.match(/([0-9.]+[KMGT]?i?B\/s)/);
  const remainingMatch = data.match(/(\d+:[0-9]+:[0-9]+)/);

  return {
    progress: progressMatch ? parseInt(progressMatch[1], 10) : 0,
    speed: speedMatch ? speedMatch[1] : '0 KB/s',
    remaining: remainingMatch ? remainingMatch[1] : '--:--:--'
  };
}

// Ensure download directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Start download
ipcMain.handle('start-download', async (event, { url, folder }) => {
  if (!url) return { error: 'Invalid URL' };

  try {
    const downloadDir = ensureDir(folder || path.join(app.getPath('downloads'), 'electron-dm'));
    const downloadId = Date.now().toString();

    // Check if the URL is a magnet link (torrent download)
    const isMagnetLink = url.startsWith('magnet:?');

    // Configure aria2c command for normal or torrent downloads
    const command = `aria2c "${url}" --dir="${downloadDir}" \
      --max-connection-per-server=16 \
      --split=16 \
      --min-split-size=1M \
      --continue=true \
      --max-concurrent-downloads=3 \
      --file-allocation=none \
      --human-readable=true \
      --summary-interval=1`;

    // If it's a magnet link, let aria2c handle it as a torrent
    if (isMagnetLink) {
      console.log('Starting torrent download using aria2c...');
    }

    const process = exec(command);
    downloads[downloadId] = {
      process,
      url,
      folder: downloadDir,
      status: 'downloading'
    };

    process.stdout.on('data', (data) => {
      const stats = parseAria2Output(data);
      console.log(stats);
      
      mainWindow.webContents.send('download-progress', {
        downloadId,
        ...stats,
        status: downloads[downloadId].status
      });
    });

    process.stderr.on('data', (data) => {
      console.error(`Download ${downloadId} error:`, data);
      mainWindow.webContents.send('download-error', {
        downloadId,
        error: data
      });
    });

    process.on('close', (code) => {
      const status = code === 0 ? 'completed' : 'failed';
      mainWindow.webContents.send('download-complete', {
        downloadId,
        status,
        code
      });
      delete downloads[downloadId];
    });

    return { downloadId, folder: downloadDir };
  } catch (error) {
    console.error('Download start error:', error);
    return { error: error.message };
  }
});

// Pause download
ipcMain.handle('pause-download', async (event, downloadId) => {
  const download = downloads[downloadId];
  if (!download) return { error: 'Download not found' };

  try {
    download.process.kill('SIGSTOP');
    download.status = 'paused';
    mainWindow.webContents.send('download-status-change', {
      downloadId,
      status: 'paused'
    });
    return { success: true };
  } catch (error) {
    console.error('Pause error:', error);
    return { error: error.message };
  }
});

// Resume download
ipcMain.handle('resume-download', async (event, downloadId) => {
  const download = downloads[downloadId];
  if (!download) return { error: 'Download not found' };

  try {
    download.process.kill('SIGCONT');
    download.status = 'downloading';
    mainWindow.webContents.send('download-status-change', {
      downloadId,
      status: 'downloading'
    });
    return { success: true };
  } catch (error) {
    console.error('Resume error:', error);
    return { error: error.message };
  }
});

// Stop download
ipcMain.handle('stop-download', async (event, downloadId) => {
  const download = downloads[downloadId];
  if (!download) return { error: 'Download not found' };

  try {
    download.process.kill('SIGKILL');
    mainWindow.webContents.send('download-status-change', {
      downloadId,
      status: 'stopped'
    });
    delete downloads[downloadId];
    return { success: true };
  } catch (error) {
    console.error('Stop error:', error);
    return { error: error.message };
  }
});

// Clean up all downloads on app exit
app.on('before-quit', () => {
  Object.keys(downloads).forEach(downloadId => {
    try {
      downloads[downloadId].process.kill('SIGKILL');
    } catch (error) {
      console.error(`Error killing process ${downloadId}:`, error);
    }
  });
});
