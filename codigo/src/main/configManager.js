const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

/**
 * Gerenciador Hibrido de Configuracao do Katharos Nous | katharos AI (Portatil + Por Maquina)
 * - Le e grava `mpe.config.json` dentro de `./codigo` (portatil).
 * - Mantem backup automatico em `data/katharos.config.backup.json`.
 * - Mantem cache especifico da maquina em `%APPDATA%/katharos-nous-ai/machine-<HOSTNAME>.json`.
 */
class ConfigManager {
  constructor(rootDir, codeDir) {
    this.rootDir = rootDir;
    this.codeDir = codeDir || rootDir;
    this.rootConfigPath = path.join(this.codeDir, 'mpe.config.json');
    this.legacyRootConfigPath = path.join(this.rootDir, 'mpe.config.json');
    this.dataDir = path.join(this.codeDir, 'data');
    this.backupConfigPath = path.join(this.dataDir, 'katharos.config.backup.json');
    this.machineId = os.hostname() || 'DEFAULT-MACHINE';
    this.userDataDir = app ? app.getPath('userData') : path.join(os.homedir(), '.katharos');
    this.machineConfigPath = path.join(this.userDataDir, `machine-${this.machineId}.json`);
    this.config = null;
    this.lastLoadedMtimeMs = 0;
  }

  getDefaults() {
    return {
      profile: {
        id: 'default-katharos-profile',
        name: 'Perfil Principal Katharos Nous',
        userName: '',
        isRegistered: true,
        languageTone: 'neutra'
      },
      theme: {
        preset: 'katharos-scifi',
        uiFontScale: 1,
        palette: {
          obsidian: '#080D16',
          darkGold: '#0A101A',
          gold: '#56B6ED',
          brightGold: '#73F3FF',
          starlight: '#FFD584',
          nebulaBlue: '#56B6ED',
          crimsonAlert: '#FF6B7A'
        }
      },
      system: {
        startWithWindows: true,
        startMinimizedToTray: true,
        triggerShortcut: 'Shift + Ctrl + Botão Direito',
        fallbackKeyboardShortcut: 'CommandOrControl+Shift+J',
        fallbackKeyboardShortcutAlt: 'CommandOrControl+Alt+K',
        showNotifications: true,
        soundEffects: true
      },
      telegram: {
        deliveryMode: 'desktop_and_bot',
        preferDesktopApp: true,
        desktopExecutablePath: '',
        windowTitleHint: 'Telegram',
        savedChatPath: 'Eu | Você | Leonardo',
        autoSendAfterPaste: true,
        botToken: '',
        defaultChatId: '',
        chatId: ''
      },
      captures: {
        documentsFolder: './arquivos'
      },
      obsidian: {
        vaultPath: './arquivos/Obsidian_Vault',
        defaultFolder: 'Katharos_Notas',
        defaultSubfolder: 'Katharos_Notas',
        openInObsidianAfterSave: false
      },
      ai: {
        provider: 'auto',
        endpoint: 'http://127.0.0.1:18080/v1/chat/completions',
        model: 'qwen2.5-7b-instruct',
        port: 18080,
        modelsDir: './codigo/models',
        contextSize: 4096,
        gpuLayers: 'auto',
        boostMode: 'balanced',
        apiKey: '',
        timeoutMs: 30000,
        useObsidianContext: true,
        maxContextNotes: 4
      },
      ui: {
        defaultRoute: 'ia',
        largeText: false,
        miniCorner: null,
        dock: null
      },
      machines: {}
    };
  }

  readJsonSafe(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  saveCorruptedSnapshot(rawContent) {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      const snapName = `katharos.config.corrupted.${Date.now()}.json`;
      fs.writeFileSync(path.join(this.dataDir, snapName), rawContent, 'utf-8');
    } catch (_) {}
  }

  load() {
    let rootData = {};
    let parseFailed = false;

    if (!fs.existsSync(this.rootConfigPath) && this.legacyRootConfigPath !== this.rootConfigPath && fs.existsSync(this.legacyRootConfigPath)) {
      try {
        fs.mkdirSync(path.dirname(this.rootConfigPath), { recursive: true });
        fs.renameSync(this.legacyRootConfigPath, this.rootConfigPath);
      } catch (_) {}
    }

    if (fs.existsSync(this.rootConfigPath)) {
      let raw = '';
      try {
        raw = fs.readFileSync(this.rootConfigPath, 'utf-8');
        rootData = JSON.parse(raw);
      } catch (err) {
        parseFailed = true;
        console.error('[Katharos Config] Erro ao ler mpe.config.json:', err);
        if (raw) this.saveCorruptedSnapshot(raw);
      }
    }

    if (parseFailed && fs.existsSync(this.backupConfigPath)) {
      try {
        const backupData = this.readJsonSafe(this.backupConfigPath);
        if (backupData && typeof backupData === 'object') {
          rootData = backupData;
        }
      } catch (_) {}
    }

    let localMachineData = {};
    if (fs.existsSync(this.machineConfigPath)) {
      try {
        localMachineData = this.readJsonSafe(this.machineConfigPath);
      } catch (_) {}
    }

    const defaults = this.getDefaults();
    rootData.profile = Object.assign({}, defaults.profile, rootData.profile || {});
    rootData.theme = Object.assign({}, defaults.theme, rootData.theme || {});
    rootData.theme.palette = Object.assign({}, defaults.theme.palette, (rootData.theme && rootData.theme.palette) || {});
    if (rootData.theme.preset === 'gold-obsidian') {
      rootData.theme = Object.assign({}, defaults.theme);
    }

    rootData.system = Object.assign({}, defaults.system, rootData.system || {});
    if (!rootData.system.triggerShortcut || rootData.system.triggerShortcut.includes('Alt')) {
      rootData.system.triggerShortcut = defaults.system.triggerShortcut;
    }
    if (!rootData.system.fallbackKeyboardShortcut || rootData.system.fallbackKeyboardShortcut === 'CommandOrControl+Shift+Alt+M') {
      rootData.system.fallbackKeyboardShortcut = defaults.system.fallbackKeyboardShortcut;
    }

    rootData.telegram = Object.assign({}, defaults.telegram, rootData.telegram || {});
    if (!rootData.telegram.defaultChatId && rootData.telegram.chatId) {
      rootData.telegram.defaultChatId = rootData.telegram.chatId;
    }
    if (!rootData.telegram.chatId && rootData.telegram.defaultChatId) {
      rootData.telegram.chatId = rootData.telegram.defaultChatId;
    }

    const migrateDocs = (p) => (p === './documentos' || p === 'documentos' ? './arquivos' : p);
    rootData.captures = Object.assign({}, defaults.captures, rootData.captures || {});
    rootData.captures.documentsFolder = migrateDocs(rootData.captures.documentsFolder || './arquivos');

    rootData.obsidian = Object.assign({}, defaults.obsidian, rootData.obsidian || {});
    if (rootData.obsidian.vaultPath === './Obsidian_Vault') {
      rootData.obsidian.vaultPath = './arquivos/Obsidian_Vault';
    }
    if (!rootData.obsidian.defaultFolder && rootData.obsidian.defaultSubfolder) {
      rootData.obsidian.defaultFolder = rootData.obsidian.defaultSubfolder;
    }
    if (!rootData.obsidian.defaultSubfolder && rootData.obsidian.defaultFolder) {
      rootData.obsidian.defaultSubfolder = rootData.obsidian.defaultFolder;
    }

    rootData.ai = Object.assign({}, defaults.ai, rootData.ai || {});
    if (!rootData.ai.port) rootData.ai.port = 18080;
    if (!rootData.ai.modelsDir || rootData.ai.modelsDir === './models' || rootData.ai.modelsDir === 'models') {
      rootData.ai.modelsDir = './codigo/models';
    }
    if (!rootData.ai.contextSize) rootData.ai.contextSize = 4096;
    if (!['eco', 'balanced', 'turbo'].includes(rootData.ai.boostMode)) {
      rootData.ai.boostMode = 'balanced';
    }

    rootData.ui = Object.assign({}, defaults.ui, rootData.ui || {});
    if (!['ia', 'local', 'nota'].includes(rootData.ui.defaultRoute)) {
      rootData.ui.defaultRoute = 'ia';
    }
    rootData.ui.largeText = Boolean(rootData.ui.largeText);
    const corner = rootData.ui.miniCorner;
    if (!corner || typeof corner !== 'object' || !['tl', 'tr', 'bl', 'br'].includes(corner.corner)) {
      rootData.ui.miniCorner = null;
    } else {
      rootData.ui.miniCorner = { corner: corner.corner, displayId: Number.isFinite(corner.displayId) ? corner.displayId : null };
    }
    const dock = rootData.ui.dock;
    if (!dock || typeof dock !== 'object' || !['left', 'right'].includes(dock.side)) {
      rootData.ui.dock = null;
    } else {
      rootData.ui.dock = {
        side: dock.side,
        y: Number.isFinite(dock.y) ? dock.y : 0,
        displayId: Number.isFinite(dock.displayId) ? dock.displayId : null
      };
    }

    if (!rootData.machines || typeof rootData.machines !== 'object') {
      rootData.machines = {};
    }

    // Remove campos exclusivos do M.P.E caso existam de migracao anterior
    delete rootData.points;
    delete rootData.organizer;

    const machineEntry = Object.assign(
      {
        hostname: this.machineId,
        platform: process.platform,
        arch: process.arch,
        startWithWindows: Boolean(rootData.system.startWithWindows),
        themePreset: rootData.theme.preset,
        lastActive: new Date().toISOString()
      },
      rootData.machines[this.machineId] || {},
      localMachineData
    );

    rootData.machines[this.machineId] = machineEntry;
    rootData.currentMachine = machineEntry;

    this.config = rootData;
    this.save(this.config);
    return this.config;
  }

  get() {
    if (!this.config) {
      return this.load();
    }
    try {
      if (fs.existsSync(this.rootConfigPath)) {
        const stat = fs.statSync(this.rootConfigPath);
        if (stat.mtimeMs > this.lastLoadedMtimeMs + 25) {
          return this.load();
        }
      }
    } catch (_) {}
    return this.config;
  }

  writeAtomic(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (_) {
      fs.writeFileSync(filePath, content, 'utf-8');
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (_) {}
    }
  }

  save(newConfig) {
    if (newConfig) {
      const safePatch = Object.assign({}, newConfig);
      this.config = Object.assign({}, this.config || this.getDefaults(), safePatch);
    }
    if (!this.config) return null;

    if (!this.config.profile) this.config.profile = this.getDefaults().profile;
    this.config.profile.lastUpdated = new Date().toISOString();
    if (!this.config.machines) this.config.machines = {};

    const machineSpecific = {
      hostname: this.machineId,
      platform: process.platform,
      arch: process.arch,
      startWithWindows: Boolean(this.config.system && this.config.system.startWithWindows),
      themePreset: (this.config.theme && this.config.theme.preset) || 'katharos-scifi',
      lastActive: new Date().toISOString()
    };

    this.config.machines[this.machineId] = machineSpecific;
    this.config.currentMachine = machineSpecific;

    const toWriteRoot = Object.assign({}, this.config);
    delete toWriteRoot.currentMachine;
    const serialized = JSON.stringify(toWriteRoot, null, 2);

    try {
      this.writeAtomic(this.rootConfigPath, serialized);
      this.lastLoadedMtimeMs = fs.statSync(this.rootConfigPath).mtimeMs;
    } catch (err) {
      console.error('[Katharos Config] Falha ao gravar mpe.config.json:', err);
    }

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      this.writeAtomic(this.backupConfigPath, serialized);
    } catch (err) {
      console.warn('[Katharos Config] Falha ao atualizar backup:', err.message);
    }

    try {
      if (!fs.existsSync(this.userDataDir)) {
        fs.mkdirSync(this.userDataDir, { recursive: true });
      }
      fs.writeFileSync(
        this.machineConfigPath,
        JSON.stringify(machineSpecific, null, 2),
        'utf-8'
      );
    } catch (err) {
      console.error('[Katharos Config] Falha ao gravar config local da maquina:', err);
    }

    return this.config;
  }

  reset() {
    this.config = this.getDefaults();
    return this.save(this.config);
  }

  resolvePath(relativeOrAbsPath) {
    if (!relativeOrAbsPath) return this.rootDir;
    if (path.isAbsolute(relativeOrAbsPath)) return relativeOrAbsPath;
    return path.resolve(this.rootDir, relativeOrAbsPath);
  }
}

module.exports = ConfigManager;
