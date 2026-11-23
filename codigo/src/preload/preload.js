const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('mpeApi', {
  // Configuracoes & Sistema
  getConfig: () => ipcRenderer.invoke('mpe:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('mpe:save-config', config),
  resetConfig: () => ipcRenderer.invoke('mpe:reset-config'),
  ensureShortcuts: () => ipcRenderer.invoke('mpe:ensure-shortcuts'),
  openPath: (targetPath) => ipcRenderer.invoke('mpe:open-path', targetPath),
  selectFolder: () => ipcRenderer.invoke('mpe:select-folder'),
  selectFile: () => ipcRenderer.invoke('mpe:select-file'),
  selectDocumentFile: () => ipcRenderer.invoke('mpe:select-document-file'),
  selectDocumentFiles: () => ipcRenderer.invoke('mpe:select-document-files'),
  selectImportFolder: () => ipcRenderer.invoke('mpe:select-import-folder'),
  recognizeText: (text) => ipcRenderer.invoke('mpe:recognize-text', { text }),
  isSupportedFile: (filePath) => ipcRenderer.invoke('mpe:is-supported-file', { filePath }),

  // Entrega em Sistemas Externos & Clipboard
  copyToClipboard: (text) => ipcRenderer.invoke('mpe:copy-text', text),
  sendTextToTelegram: (payload) => ipcRenderer.invoke('mpe:send-text-telegram', payload),
  sendToTargetSystem: (payload) => ipcRenderer.invoke('mpe:send-to-system', payload),
  listOpenWindows: () => ipcRenderer.invoke('mpe:list-open-windows'),

  // Janela Flutuante & Controle de Ciclo de Vida
  openMiniAssistant: (payload) => ipcRenderer.invoke('mpe:open-mini-assistant', payload),
  miniDragStart: () => ipcRenderer.send('mpe:mini-drag-start'),
  miniDragEnd: () => ipcRenderer.send('mpe:mini-drag-end'),
  miniResize: (size) => ipcRenderer.send('mpe:mini-resize', size),
  miniResizeStart: (edge) => ipcRenderer.send('mpe:mini-resize-start', edge),
  miniResizeEnd: () => ipcRenderer.send('mpe:mini-resize-end'),
  barExpand: (expanded) => ipcRenderer.invoke('mpe:bar-expand', Boolean(expanded)),
  bubbleExpand: (expanded) => ipcRenderer.invoke('mpe:bubble-expand', Boolean(expanded)),
  onBubbleLayout: (callback) => ipcRenderer.on('mpe:bubble-layout', (_event, layout) => callback(layout)),
  resetMiniLayout: () => ipcRenderer.invoke('mpe:reset-mini-layout'),
  onChatSize: (cb) => ipcRenderer.on('mpe:chat-size', (_e, size) => cb(size)),
  setWindowMode: (mode) => ipcRenderer.invoke('mpe:set-window-mode', mode),
  hideHud: () => ipcRenderer.invoke('mpe:hide-hud'),
  quitApp: () => ipcRenderer.invoke('mpe:quit-app'),

  // IA Local (Katharos Nous | katharos AI) & Obsidian
  reviewText: (payload) => ipcRenderer.invoke('mpe:ai-review', payload),
  draftText: (payload) => ipcRenderer.invoke('mpe:ai-draft', payload),
  classifyObsidian: (payload) => ipcRenderer.invoke('mpe:ai-classify-obsidian', payload),
  saveToObsidian: (payload) => ipcRenderer.invoke('mpe:save-to-obsidian', payload),
  saveDocumentFile: (payload) => ipcRenderer.invoke('mpe:ai-save-document', payload),
  listDocuments: (payload) => ipcRenderer.invoke('mpe:ai-list-documents', payload),
  removeDocument: (payload) => ipcRenderer.invoke('mpe:ai-remove-document', payload),
  aiChat: (payload) => ipcRenderer.invoke('mpe:ai-chat', payload),
  aiStatus: (payload) => ipcRenderer.invoke('mpe:ai-status', payload),
  recentPrompts: () => ipcRenderer.invoke('mpe:ai-recent-prompts'),
  historyList: (opts) => ipcRenderer.invoke('mpe:ai-history-list', opts || {}),
  pathForFile: (file) => {
    try {
      return webUtils && typeof webUtils.getPathForFile === 'function' ? webUtils.getPathForFile(file) : '';
    } catch (_) {
      return '';
    }
  },
  getPerfProfile: () => ipcRenderer.invoke('mpe:get-perf-profile'),
  setBoostMode: (mode) => ipcRenderer.invoke('mpe:set-boost-mode', mode),

  // Eventos do Main Process
  onEscapePressed: (callback) => ipcRenderer.on('mpe:escape-pressed', () => callback()),
  onMiniAssistantSummoned: (callback) => ipcRenderer.on('mpe:mini-assistant-summoned', (_event, data) => callback(data)),
  onAiChatChunk: (callback) => ipcRenderer.on('mpe:ai-chat-chunk', (_event, data) => callback(data)),
  onAiChatStatus: (callback) => ipcRenderer.on('mpe:ai-chat-status', (_event, data) => callback(data)),
  onConfigUpdated: (callback) => ipcRenderer.on('mpe:config-updated', (_event, cfg) => callback(cfg)),
  onWindowMode: (callback) => ipcRenderer.on('mpe:window-mode', (_event, data) => callback(data))
});
