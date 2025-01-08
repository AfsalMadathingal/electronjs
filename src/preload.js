const { contextBridge, ipcRenderer } = require('electron');

// Validate channels to prevent exposure of unauthorized IPC channels
const validChannels = {
  send: [
    'start-download',
    'pause-download',
    'resume-download',
    'stop-download',
    'select-folder',
    'minimize-window',
    'close-window'
  ],
  receive: [
    'download-progress',
    'download-complete',
    'download-error',
    'download-status-change'
  ]
};

// Create a secure API for renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Download management
  startDownload: (options) => ipcRenderer.invoke('start-download', options),
  pauseDownload: (downloadId) => ipcRenderer.invoke('pause-download', downloadId),
  resumeDownload: (downloadId) => ipcRenderer.invoke('resume-download', downloadId),
  stopDownload: (downloadId) => ipcRenderer.invoke('stop-download', downloadId),
  
  // Folder selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),

  // Event listeners
  on: (channel, callback) => {
    if (validChannels.receive.includes(channel)) {
      // Wrap the callback to avoid exposing event object to renderer
      const subscription = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);

      // Return a function to remove the event listener
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
    return null;
  },

  // One-time event listeners
  once: (channel, callback) => {
    if (validChannels.receive.includes(channel)) {
      const subscription = (event, ...args) => callback(...args);
      ipcRenderer.once(channel, subscription);
    }
  },

  // Remove event listeners
  removeAllListeners: (channel) => {
    if (validChannels.receive.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});

// Disable eval() in renderer process for security
contextBridge.exposeInMainWorld('eval', null);

// Console message to confirm preload script execution
console.log('Preload script loaded successfully');

// Error handling for IPC communications
ipcRenderer.on('error', (event, error) => {
  console.error('IPC Error:', error);
});