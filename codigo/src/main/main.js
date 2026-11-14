const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  globalShortcut,
  screen,
  dialog,
  clipboard,
  shell,
  nativeImage
} = require('electron');

const DEBUG_LOG = path.join(__dirname, '..', '..', 'logs', 'app_debug.log');
function logDebug(msg) {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch (_) {}
}
logDebug(`[KATHAROS START] pid=${process.pid} argv=${JSON.stringify(process.argv)}`);

process.on('uncaughtException', (err) => {
  logDebug(`[UNCAUGHT EXCEPTION] ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logDebug(`[UNHANDLED REJECTION] ${reason}`);
});

process.on('exit', (code) => {
  logDebug(`[PROCESS EXIT] code=${code}`);
});

// Identificador unico do aplicativo no Windows para agrupar e fixar na Barra de Tarefas
const APP_USER_MODEL_ID = 'DevFLeo.KatharosNousAI';
app.setAppUserModelId(APP_USER_MODEL_ID);
app.name = 'Katharos Nous - katharos AI';

const ConfigManager = require('./configManager');
const StartupManager = require('./startupManager');
const HookBridge = require('./hookBridge');
const ActionExecutor = require('./actionExecutor');
const LocalAiService = require('./localAiService');
const { nearestCorner, cornerBounds, pickDisplay } = require('./cornerSnap');

const CODE_DIR = path.resolve(__dirname, '..', '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const configManager = new ConfigManager(ROOT_DIR, CODE_DIR);
const startupManager = new StartupManager(ROOT_DIR, CODE_DIR);
const hookBridge = new HookBridge(CODE_DIR);
const actionExecutor = new ActionExecutor(configManager, hookBridge);
const localAiService = new LocalAiService(ROOT_DIR, configManager, CODE_DIR);

app.on('before-quit', () => {
  logDebug(`[APP BEFORE-QUIT]`);
  try {
    localAiService.shutdown();
  } catch (_) {}
});

app.on('will-quit', () => {
  logDebug(`[APP WILL-QUIT]`);
  globalShortcut.unregisterAll();
  hookBridge.stop();
});

const gotTheLock = app.requestSingleInstanceLock();
logDebug(`[LOCK] gotTheLock=${gotTheLock}`);
if (!gotTheLock) {
  logDebug(`[LOCK FAILED] Exiting because another instance has the lock`);
  app.quit();
} else {
  app.on('second-instance', () => {
    logDebug(`[SECOND INSTANCE] Summoning Katharos Nous`);
    summonMiniAssistant({ source: 'executable' });
  });
}

const MINI_DEFAULT_SIZE = { width: 576, height: 220 };
let miniDragTimer = null;
let miniDragMoved = false;
let miniSnapTimer = null;

function getSavedMiniCorner() {
  const cfg = configManager.get();
  return (cfg && cfg.ui && cfg.ui.miniCorner) || null;
}

function animateMiniTo(target) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (miniSnapTimer) clearInterval(miniSnapTimer);
  const from = mainWindow.getBounds();
  const steps = 8;
  let i = 0;
  miniSnapTimer = setInterval(() => {
    i++;
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(miniSnapTimer);
      miniSnapTimer = null;
      return;
    }
    const t = 1 - Math.pow(1 - i / steps, 3);
    mainWindow.setBounds({
      x: Math.round(from.x + (target.x - from.x) * t),
      y: Math.round(from.y + (target.y - from.y) * t),
      width: target.width,
      height: target.height
    });
    if (i >= steps) {
      clearInterval(miniSnapTimer);
      miniSnapTimer = null;
    }
  }, 16);
}

function snapMiniToNearestCorner() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  const display = screen.getDisplayMatching(b);
  const corner = nearestCorner(b, display.workArea);
  animateMiniTo(cornerBounds(corner, { width: b.width, height: b.height }, display.workArea));
  try {
    const cfg = configManager.get();
    configManager.save({ ui: Object.assign({}, cfg.ui, { miniCorner: { corner, displayId: display.id } }) });
  } catch (err) {
    logDebug(`[MINI CORNER SAVE FAILED] ${err.message}`);
  }
  logDebug(`[MINI CORNER] ${corner} display=${display.id}`);
}

function endMiniDrag() {
  const wasDragging = Boolean(miniDragTimer);
  const moved = miniDragMoved;
  stopMiniDrag();
  if (wasDragging && moved) snapMiniToNearestCorner();
}

function stopMiniDrag() {
  if (miniDragTimer) {
    clearInterval(miniDragTimer);
    miniDragTimer = null;
  }
}

function startMiniDrag() {
  if (!mainWindow) return;
  stopMiniDrag();
  const start = screen.getCursorScreenPoint();
  const [wx, wy] = mainWindow.getPosition();
  const offX = start.x - wx;
  const offY = start.y - wy;
  miniDragMoved = false;
  miniDragTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
      stopMiniDrag();
      return;
    }
    const p = screen.getCursorScreenPoint();
    if (Math.abs(p.x - start.x) > 4 || Math.abs(p.y - start.y) > 4) miniDragMoved = true;
    const [w, h] = mainWindow.getSize();
    mainWindow.setBounds({ x: p.x - offX, y: p.y - offY, width: w, height: h });
  }, 8);
  const timerRef = miniDragTimer;
  setTimeout(() => {
    if (miniDragTimer === timerRef) stopMiniDrag();
  }, 30000);
}

function resizeMiniWindow({ width, height } = {}) {
  if (!mainWindow || typeof width !== 'number' || typeof height !== 'number') return;
  const b = mainWindow.getBounds();
  const display = screen.getDisplayMatching(b);
  const wa = display.workArea;
  const w = Math.max(260, Math.min(Math.round(width), wa.width));
  const h = Math.max(120, Math.min(Math.round(height), wa.height));
  const saved = getSavedMiniCorner();
  if (saved && !miniDragTimer) {
    mainWindow.setBounds(cornerBounds(saved.corner, { width: w, height: h }, wa));
    return;
  }
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - w));
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - h));
  mainWindow.setBounds({ x, y, width: w, height: h });
}

async function summonMiniAssistant({ x, y, source = 'mouse-hook', openChat = false, openSettings = false } = {}) {
  if (!mainWindow) return;

  if (source !== 'mouse-hook' && (!hookBridge.lastHwnd || hookBridge.lastHwnd === '0')) {
    await hookBridge.refreshForegroundWindow();
  }

  const cursor = screen.getCursorScreenPoint();
  const targetX = typeof x === 'number' ? x : cursor.x;
  const targetY = typeof y === 'number' ? y : cursor.y;

  stopMiniDrag();
  const currentDisplay = screen.getDisplayNearestPoint({ x: targetX, y: targetY });
  const wa = currentDisplay.workArea;
  const w = openSettings ? 820 : MINI_DEFAULT_SIZE.width;
  const h = openSettings ? 660 : MINI_DEFAULT_SIZE.height;
  let winX = source === 'startup' || source === 'executable' || source === 'tray' || source === 'tray-click' || source === 'tray-settings'
    ? wa.x + Math.round((wa.width - w) / 2)
    : targetX + 18;
  let winY = source === 'startup' || source === 'executable' || source === 'tray' || source === 'tray-click' || source === 'tray-settings'
    ? wa.y + Math.round((wa.height - h) / 2)
    : targetY + 18;

  if (winX + w > wa.x + wa.width) winX = targetX - w - 18;
  if (winY + h > wa.y + wa.height) winY = targetY - h - 18;
  winX = Math.max(wa.x, Math.min(winX, wa.x + wa.width - w));
  winY = Math.max(wa.y, Math.min(winY, wa.y + wa.height - h));

  const savedCorner = getSavedMiniCorner();
  if (savedCorner) {
    const display = pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id, savedCorner.displayId);
    const placed = cornerBounds(savedCorner.corner, { width: w, height: h }, display.workArea);
    winX = placed.x;
    winY = placed.y;
  }
  mainWindow.setBounds({ x: Math.round(winX), y: Math.round(winY), width: w, height: h });

  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.webContents.send('mpe:mini-assistant-summoned', {
    x: targetX - winX,
    y: targetY - winY,
    source,
    openChat: Boolean(openChat),
    openSettings: Boolean(openSettings),
    originSystem: hookBridge.getOriginSystemInfo(),
    config: configManager.get()
  });
}

function createWindow() {
  const iconPath = path.join(CODE_DIR, 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    title: 'Katharos Nous | katharos AI',
    width: MINI_DEFAULT_SIZE.width,
    height: MINI_DEFAULT_SIZE.height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
      backgroundThrottling: false
    }
  });

  if (process.platform === 'win32' && typeof mainWindow.setAppDetails === 'function') {
    const launcherExe = path.join(ROOT_DIR, 'Katharos.exe');
    const relaunchCmd = fs.existsSync(launcherExe)
      ? `"${launcherExe}" --launch-ui`
      : `"${process.execPath}" "${CODE_DIR}" --launch-ui`;
    mainWindow.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath: fs.existsSync(iconPath) ? iconPath : launcherExe,
      appIconIndex: 0,
      relaunchCommand: relaunchCmd,
      relaunchDisplayName: 'Katharos Nous - katharos AI'
    });
  }

  const indexHtmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(indexHtmlPath);

  mainWindow.webContents.once('did-finish-load', async () => {
    const isSilentStartup = process.argv.includes('--startup');
    const isSelfTest = process.argv.includes('--self-test');
    logDebug(`[DID-FINISH-LOAD] isSilentStartup=${isSilentStartup} isSelfTest=${isSelfTest}`);

    if (!isSilentStartup) {
      await summonMiniAssistant({ source: 'startup' });
    } else if (tray && typeof tray.displayBalloon === 'function') {
      try {
        tray.displayBalloon({
          title: 'Katharos Nous | katharos AI',
          content: 'Ativo em segundo plano. Pressione Shift+Ctrl+Botão Direito ou Ctrl+Shift+J para abrir.',
          iconType: 'info'
        });
      } catch (_) {}
    }

    if (isSelfTest) {
      try {
        const outDir = path.join(ROOT_DIR, 'prints', 'Verificacao');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        await new Promise((r) => setTimeout(r, 450));
        const miniCheck = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const overlay = document.getElementById('mini-assistant-overlay');
            const canvas = document.getElementById('kataros-mascot-canvas');
            const input = document.getElementById('mini-ai-textarea');
            const btnReview = document.getElementById('btn-mini-review');
            if (input) input.value = 'teste de revisao rapida para verificar o funcionamento';
            if (btnReview) btnReview.click();
            await new Promise((r) => setTimeout(r, 450));
            return {
              overlayVisible: Boolean(overlay && !overlay.classList.contains('hidden')),
              hasCanvas: Boolean(canvas && canvas.width > 0 && canvas.height > 0),
              outputLen: (document.getElementById('mini-review-text')?.textContent || '').trim().length,
              miniRouteBtns: document.querySelectorAll('.mini-route-btns .mini-route-btn').length
            };
          })()
        `);
        console.log('KATHAROS_MINI_TEST:', JSON.stringify(miniCheck));
        if (!miniCheck.overlayVisible || !miniCheck.hasCanvas || miniCheck.outputLen === 0 || miniCheck.miniRouteBtns !== 3) {
          throw new Error('Mini assistant check failed: ' + JSON.stringify(miniCheck));
        }
        const imgMini = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_1_katharos_mini.png'), imgMini.toPNG());

        const chatCheck = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            document.getElementById('btn-mini-chat-toggle').click();
            await new Promise((r) => setTimeout(r, 350));
            const drawer = document.getElementById('side-chat-drawer');
            return {
              chatOpen: Boolean(drawer && !drawer.classList.contains('hidden')),
              msgCount: document.querySelectorAll('#side-chat-messages .side-msg').length,
              routeBtnCount: document.querySelectorAll('.route-bar .route-btn').length
            };
          })()
        `);
        console.log('KATHAROS_CHAT_TEST:', JSON.stringify(chatCheck));
        if (!chatCheck.chatOpen) {
          throw new Error('Side chat drawer did not open');
        }
        if (chatCheck.routeBtnCount !== 3) {
          throw new Error('Route bar check failed: ' + JSON.stringify(chatCheck));
        }
        const imgChat = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_2_katharos_chat.png'), imgChat.toPNG());

        const guideCheck = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            document.getElementById('btn-mini-guide').click();
            await new Promise((r) => setTimeout(r, 450));
            return {
              guideOpen: !document.getElementById('modal-guide').classList.contains('hidden'),
              kitsCount: document.querySelectorAll('#guide-kits-grid .kit-card').length,
              perfTextLen: (document.getElementById('guide-perf-metrics').textContent || '').trim().length
            };
          })()
        `);
        console.log('KATHAROS_GUIDE_TEST:', JSON.stringify(guideCheck));
        if (!guideCheck.guideOpen || guideCheck.kitsCount === 0 || guideCheck.perfTextLen === 0) {
          throw new Error('Guide/Boost modal check failed: ' + JSON.stringify(guideCheck));
        }
        const imgGuide = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_3_katharos_guide.png'), imgGuide.toPNG());

        const settingsCheck = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            document.getElementById('btn-close-guide').click();
            await new Promise((r) => setTimeout(r, 150));
            document.getElementById('btn-mini-settings').click();
            await new Promise((r) => setTimeout(r, 350));
            const open = !document.getElementById('modal-settings').classList.contains('hidden');
            const hasStartupToggle = Boolean(document.getElementById('cfg-start-windows'));
            const hasObsidianInput = Boolean(document.getElementById('cfg-obsidian-vault'));
            const hasDefaultRoute = Boolean(document.getElementById('cfg-default-route'));
            return { settingsOpen: open, hasStartupToggle, hasObsidianInput, hasDefaultRoute };
          })()
        `);
        console.log('KATHAROS_SETTINGS_TEST:', JSON.stringify(settingsCheck));
        if (!settingsCheck.settingsOpen || !settingsCheck.hasStartupToggle || !settingsCheck.hasObsidianInput || !settingsCheck.hasDefaultRoute) {
          throw new Error('Settings modal check failed: ' + JSON.stringify(settingsCheck));
        }
        const imgSettings = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_4_katharos_settings.png'), imgSettings.toPNG());

        console.log('KATHAROS_SELF_TEST_PASSED');
        isQuitting = true;
        hookBridge.stop();
        app.quit();
      } catch (err) {
        console.error('KATHAROS_SELF_TEST_FAILED:', err);
        isQuitting = true;
        hookBridge.stop();
        app.exit(1);
      }
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      mainWindow.webContents.send('mpe:escape-pressed');
    }
  });
}

app.on('window-all-closed', (e) => {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
});

function createSystemTray() {
  const pngPath = path.join(CODE_DIR, 'assets', 'icon.png');
  const trayIcon = fs.existsSync(pngPath)
    ? nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
  tray.setToolTip('Katharos Nous | katharos AI (Shift+Ctrl+Botão Direito)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Katharos Nous (Shift+Ctrl+Botão Direito)',
      click: () => summonMiniAssistant({ source: 'tray' })
    },
    {
      label: 'Abrir Chat IA Local',
      click: () => summonMiniAssistant({ source: 'tray-chat', openChat: true })
    },
    {
      label: 'Configurações',
      click: () => summonMiniAssistant({ source: 'tray-settings', openSettings: true })
    },
    { type: 'separator' },
    {
      label: 'Abrir Pasta de Documentos & Obsidian',
      click: () => {
        const docsDir = path.join(ROOT_DIR, 'arquivos');
        if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
        shell.openPath(docsDir);
      }
    },
    { type: 'separator' },
    {
      label: 'Encerrar Katharos Nous Completamente',
      click: () => {
        isQuitting = true;
        hookBridge.stop();
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    summonMiniAssistant({ source: 'tray-click' });
  });
}

function setupHooksAndShortcuts() {
  hookBridge.on('trigger-mini', ({ x, y }) => {
    summonMiniAssistant({ x, y, source: 'mouse-hook' });
  });

  hookBridge.start();

  const cfg = configManager.get();
  const primaryFallback = (cfg.system && cfg.system.fallbackKeyboardShortcut) || 'CommandOrControl+Shift+J';
  const secondaryFallback = (cfg.system && cfg.system.fallbackKeyboardShortcutAlt) || 'CommandOrControl+Alt+K';

  [primaryFallback, secondaryFallback].forEach((accel) => {
    if (!accel) return;
    try {
      globalShortcut.register(accel, () => {
        summonMiniAssistant({ source: 'keyboard-shortcut' });
      });
    } catch (err) {
      console.warn(`[Katharos Shortcut] Nao foi possivel registrar ${accel}:`, err.message);
    }
  });
}

function setupIpcHandlers() {
  ipcMain.handle('mpe:get-config', async () => {
    const cfg = configManager.get();
    const isStartupEnabled = await startupManager.checkStartup();
    cfg.system.startWithWindows = isStartupEnabled;
    cfg.originSystem = hookBridge.getOriginSystemInfo();
    return cfg;
  });

  ipcMain.handle('mpe:save-config', async (_event, newConfig) => {
    if (newConfig && newConfig.system && typeof newConfig.system.startWithWindows === 'boolean') {
      await startupManager.setStartup(newConfig.system.startWithWindows);
    }
    const saved = configManager.save(newConfig);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpe:config-updated', saved);
    }
    return saved;
  });

  ipcMain.handle('mpe:reset-config', async () => {
    const reset = configManager.reset();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpe:config-updated', reset);
    }
    return reset;
  });

  ipcMain.handle('mpe:send-text-telegram', async (_event, { text, target, keepOpen } = {}) => {
    const wasVisible = mainWindow && mainWindow.isVisible();
    if (wasVisible) mainWindow.hide();
    const res = await actionExecutor.dispatchToTelegram({
      textMessage: text,
      customTarget: target
    });
    if (keepOpen && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    return res;
  });

  ipcMain.handle('mpe:send-to-system', async (_event, { text, targetSystem, autoSendEnter, keepOpen } = {}) => {
    const wasVisible = mainWindow && mainWindow.isVisible();
    if (wasVisible) mainWindow.hide();
    const res = await actionExecutor.dispatchToTargetSystem({
      targetSystem,
      autoSendEnter: autoSendEnter !== false,
      isTelegram: false,
      textMessage: text
    });
    if (keepOpen && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    return res;
  });

  ipcMain.handle('mpe:list-open-windows', async () => {
    return await hookBridge.listOpenWindows();
  });

  ipcMain.handle('mpe:copy-text', (_event, text) => {
    clipboard.writeText(text || '');
    return { ok: true };
  });

  ipcMain.handle('mpe:ai-review', async (_event, { text } = {}) => {
    return await localAiService.reviewText(text);
  });

  ipcMain.handle('mpe:ai-draft', async (_event, { prompt, context } = {}) => {
    return await localAiService.draftText(prompt, context);
  });

  ipcMain.handle('mpe:ai-classify-obsidian', async (_event, { text, title } = {}) => {
    return await localAiService.classifyForObsidian(text, title);
  });

  ipcMain.handle('mpe:save-to-obsidian', async (_event, { title, text, folder, tags } = {}) => {
    return await localAiService.saveToObsidian({ title, text, folder, tags });
  });

  ipcMain.handle('mpe:ai-save-document', async (_event, payload) => {
    return localAiService.saveDocumentFile(payload);
  });

  ipcMain.handle('mpe:ai-list-documents', async (_event, { category } = {}) => {
    return {
      ok: true,
      documents: localAiService.listDocuments(category || ''),
      documentsDir: localAiService.documents.getDocumentsFolder()
    };
  });

  ipcMain.handle('mpe:ai-remove-document', async (_event, { idOrIndex } = {}) => {
    return {
      ok: true,
      removed: localAiService.removeDocument(idOrIndex)
    };
  });

  ipcMain.handle('mpe:select-document-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivo ou Extrato para IA Local (Katharos Nous)',
      filters: [
        {
          name: 'Documentos e Extratos',
          extensions: ['ofx', 'qfx', 'csv', 'txt', 'md', 'json', 'log', 'tsv', 'html', 'pdf']
        },
        { name: 'Todos os Arquivos', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('mpe:ai-chat', async (event, { message, mode, tone, route, requestId } = {}) => {
    const sender = event.sender;
    const send = (channel, data) => {
      if (!sender.isDestroyed()) sender.send(channel, Object.assign({ requestId }, data));
    };
    return await localAiService.chat(
      { message, mode, tone, route },
      {
        onChunk: (delta) => send('mpe:ai-chat-chunk', { delta }),
        onStatus: (status) => send('mpe:ai-chat-status', { status })
      }
    );
  });

  ipcMain.handle('mpe:ai-status', async (_event, { warmUp } = {}) => {
    if (warmUp) localAiService.warmUp();
    return await localAiService.getStatus();
  });

  ipcMain.handle('mpe:get-perf-profile', async () => {
    return localAiService.getPerformanceProfile();
  });

  ipcMain.handle('mpe:set-boost-mode', async (_event, mode) => {
    const profile = await localAiService.setBoostMode(mode, { restartIfOnline: true });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpe:config-updated', configManager.get());
    }
    return profile;
  });

  ipcMain.handle('mpe:open-mini-assistant', async (_event, payload = {}) => {
    await summonMiniAssistant({
      source: 'ui-button',
      openChat: Boolean(payload && payload.openChat),
      openSettings: Boolean(payload && payload.openSettings)
    });
    return { ok: true };
  });

  ipcMain.handle('mpe:ensure-shortcuts', async () => {
    return await startupManager.createAppShortcuts();
  });

  ipcMain.handle('mpe:open-path', async (_event, targetPath) => {
    const resolved = configManager.resolvePath(targetPath);
    await shell.openPath(resolved);
    return { ok: true, path: resolved };
  });

  ipcMain.handle('mpe:select-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Pasta de Destino (Katharos Nous)',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('mpe:select-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivo ou Executavel (Katharos Nous)',
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.on('mpe:mini-drag-start', () => startMiniDrag());
  ipcMain.on('mpe:mini-drag-end', () => endMiniDrag());
  ipcMain.on('mpe:mini-resize', (_e, size) => resizeMiniWindow(size));

  ipcMain.handle('mpe:hide-hud', () => {
    stopMiniDrag();
    if (mainWindow) mainWindow.hide();
    return { ok: true };
  });

  ipcMain.handle('mpe:quit-app', () => {
    isQuitting = true;
    hookBridge.stop();
    app.quit();
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  logDebug(`[APP WHEN-READY] Initializing Katharos Nous subsystems`);
  const docsDir = path.join(ROOT_DIR, 'arquivos');
  const vaultDir = path.join(docsDir, 'Obsidian_Vault');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });

  const cfg = configManager.load();
  if (cfg.system && cfg.system.startWithWindows) {
    await startupManager.setStartup(true);
  } else {
    await startupManager.createAppShortcuts();
  }

  setupIpcHandlers();
  createWindow();
  createSystemTray();
  setupHooksAndShortcuts();
  logDebug(`[APP WHEN-READY DONE] Katharos Nous subsystems ready`);
});
