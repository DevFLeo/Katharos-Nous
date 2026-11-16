/**
 * Controlador da Interface Principal do Katharos Nous | katharos AI
 * - Mini Assistente Flutuante (Lower-Third Sci-Fi + Mascote 3D Giroscopio)
 * - Chat Lateral com IA Local (llamafile / Ollama / LM Studio / Motor Embutido ~2ms)
 * - Integracao com Obsidian Vault, Documentos Financeiros e Sistemas Externos
 */
(function () {
  let currentConfig = null;
  let syncMiniWindowSizeRef = () => {};
  let setRouteRef = () => {};
  let sendSideChatMessageRef = async () => {};
  let applyWindowModeRef = () => {};
  let refreshMascotIdleRef = async () => {};
  let knBubbleSayRef = () => {};
  let knEnterBubbleRef = () => {};

  function applyUiPrefs(cfg) {
    const ui = (cfg && cfg.ui) || {};
    document.body.classList.toggle('large-text', Boolean(ui.largeText));
    setRouteRef(ui.defaultRoute || 'ia');
  }
  let toastTimer = null;

  function showToast(msg) {
    const toast = document.getElementById('hud-toast');
    const text = document.getElementById('hud-toast-text');
    if (!toast || !text) return;
    text.textContent = msg;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3800);
  }

  let pendingForgetCorner = false;
  const CORNER_NAMES = { tl: 'superior esquerdo', tr: 'superior direito', bl: 'inferior esquerdo', br: 'inferior direito' };

  function renderCornerInfo(corner, dock) {
    const info = document.getElementById('cfg-corner-info');
    const btn = document.getElementById('btn-cfg-forget-corner');
    const hasDock = Boolean(dock && (dock.side === 'left' || dock.side === 'right'));
    const hasCorner = Boolean(corner && CORNER_NAMES[corner.corner]);
    if (info) {
      info.textContent = hasDock
        ? `A janela vira barra na lateral ${dock.side === 'left' ? 'esquerda' : 'direita'}. Arraste para o meio da tela para trocar.`
        : hasCorner
        ? `A janela fica no canto ${CORNER_NAMES[corner.corner]}. Arraste para outro canto ou para a lateral para trocar.`
        : 'A janela abre perto do cursor. Arraste até um canto, ou até a lateral para virar barra.';
    }
    if (btn) btn.classList.toggle('hidden', !(hasDock || hasCorner));
  }

  async function openSettingsModal() {
    // Le a configuracao atual: a janela pode ter sido arrastada para um canto desde a ultima leitura.
    try {
      const fresh = await window.mpeApi.getConfig();
      if (fresh && typeof fresh === 'object') currentConfig = fresh;
    } catch (_) {}
    const cfg = currentConfig || {};
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v;
    };
    const setChk = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(v);
    };

    setVal('cfg-user-name', (cfg.profile && cfg.profile.userName) || '');
    setVal('cfg-language-tone', (cfg.profile && cfg.profile.languageTone) || 'neutra');
    setChk('cfg-start-windows', cfg.system && cfg.system.startWithWindows !== false);
    setChk('cfg-sound-effects', !cfg.system || cfg.system.soundEffects !== false);

    const tg = cfg.telegram || {};
    setVal('cfg-tg-chat', tg.savedChatPath || 'Eu | Você | Leonardo');
    setVal('cfg-tg-token', tg.botToken || '');
    setVal('cfg-tg-chatid', tg.chatId || tg.defaultChatId || '');

    const cap = cfg.captures || {};
    setVal('cfg-docs-folder', cap.documentsFolder || './arquivos');

    const obs = cfg.obsidian || {};
    setVal('cfg-obsidian-vault', obs.vaultPath || './arquivos/Obsidian_Vault');
    setVal('cfg-obsidian-folder', obs.defaultFolder || obs.defaultSubfolder || 'Katharos_Notas');

    const ui = cfg.ui || {};
    setVal('cfg-default-route', ui.defaultRoute || 'ia');
    setChk('cfg-large-text', ui.largeText);
    setChk('cfg-show-charts', ui.showCharts !== false);
    pendingForgetCorner = false;
    renderCornerInfo(ui.miniCorner, ui.dock);

    const ai = cfg.ai || {};
    setVal('cfg-ai-provider', ai.provider || 'auto');
    setVal('cfg-ai-boost', ai.boostMode || 'balanced');

    const machineEl = document.getElementById('info-machine-name');
    if (machineEl) {
      machineEl.textContent = (cfg.currentMachine && cfg.currentMachine.hostname) || 'LOCAL-PC';
    }

    const perfSummaryEl = document.getElementById('info-perf-summary');
    if (perfSummaryEl && window.mpeApi.getPerfProfile) {
      window.mpeApi.getPerfProfile().then((p) => {
        if (!p) return;
        perfSummaryEl.textContent = `RAM Livre: ${p.hardware.freeRamGb}/${p.hardware.totalRamGb} GB | Katharos ~${p.memory.totalMpeBaseMb} MB | LLM ~${p.memory.totalMpeWithLlmGb} GB | ${p.speed.genTokPerSec} tok/s`;
      }).catch(() => {});
    }

    const modal = document.getElementById('modal-settings');
    if (modal) modal.classList.remove('hidden');
    syncMiniWindowSizeRef();
  }

  async function saveSettingsFromModal() {
    const val = (id, fallback = '') => {
      const el = document.getElementById(id);
      return el ? el.value : fallback;
    };
    const chk = (id, fallback = false) => {
      const el = document.getElementById(id);
      return el ? el.checked : fallback;
    };

    currentConfig.profile = Object.assign({}, currentConfig.profile, {
      userName: val('cfg-user-name').trim() || 'Operador',
      isRegistered: true,
      languageTone: val('cfg-language-tone', 'neutra')
    });

    currentConfig.system = Object.assign({}, currentConfig.system, {
      startWithWindows: chk('cfg-start-windows', true),
      soundEffects: chk('cfg-sound-effects', true)
    });

    const chatIdVal = val('cfg-tg-chatid').trim();
    currentConfig.telegram = Object.assign({}, currentConfig.telegram, {
      savedChatPath: val('cfg-tg-chat').trim() || 'Eu | Você | Leonardo',
      botToken: val('cfg-tg-token').trim(),
      defaultChatId: chatIdVal,
      chatId: chatIdVal
    });

    currentConfig.captures = Object.assign({}, currentConfig.captures, {
      documentsFolder: val('cfg-docs-folder').trim() || './arquivos'
    });

    const obsFolder = val('cfg-obsidian-folder').trim() || 'Katharos_Notas';
    currentConfig.obsidian = Object.assign({}, currentConfig.obsidian, {
      vaultPath: val('cfg-obsidian-vault').trim() || './arquivos/Obsidian_Vault',
      defaultFolder: obsFolder,
      defaultSubfolder: obsFolder
    });

    // A janela pode ter sido arrastada para outro canto depois que esta tela abriu: le o canto mais recente.
    let latestUi = null;
    try {
      const latest = await window.mpeApi.getConfig();
      latestUi = latest && latest.ui;
    } catch (_) {}
    const prevUi = Object.assign({}, currentConfig.ui || {}, latestUi ? { miniCorner: latestUi.miniCorner || null, dock: latestUi.dock || null } : {});
    currentConfig.ui = Object.assign({}, prevUi, {
      defaultRoute: val('cfg-default-route', prevUi.defaultRoute || 'ia'),
      largeText: chk('cfg-large-text', Boolean(prevUi.largeText)),
      showCharts: chk('cfg-show-charts', prevUi.showCharts !== false),
      miniCorner: pendingForgetCorner ? null : prevUi.miniCorner || null,
      dock: pendingForgetCorner ? null : prevUi.dock || null
    });
    pendingForgetCorner = false;

    const prevBoostMode = (currentConfig.ai && currentConfig.ai.boostMode) || 'balanced';
    const nextBoostMode = val('cfg-ai-boost', prevBoostMode);
    currentConfig.ai = Object.assign({}, currentConfig.ai, {
      provider: val('cfg-ai-provider', 'auto'),
      boostMode: nextBoostMode
    });

    currentConfig = await window.mpeApi.saveConfig(currentConfig);
    applyUiPrefs(currentConfig);
    if (nextBoostMode !== prevBoostMode && window.mpeApi.setBoostMode) {
      await window.mpeApi.setBoostMode(nextBoostMode);
    }

    const noteFolderEl = document.getElementById('mini-note-folder');
    if (noteFolderEl) noteFolderEl.value = obsFolder;
    const sideToneEl = document.getElementById('side-ai-tone');
    if (sideToneEl && Array.from(sideToneEl.options).some((o) => o.value === currentConfig.profile.languageTone)) {
      sideToneEl.value = currentConfig.profile.languageTone;
    }

    const modal = document.getElementById('modal-settings');
    if (modal) modal.classList.add('hidden');
    syncMiniWindowSizeRef();
    showToast('Configurações salvas!');
  }

  async function init() {
    currentConfig = await window.mpeApi.getConfig();
    document.body.classList.toggle('large-text', Boolean(currentConfig && currentConfig.ui && currentConfig.ui.largeText));

    const noteFolderEl = document.getElementById('mini-note-folder');
    if (noteFolderEl && currentConfig.obsidian) {
      noteFolderEl.value = currentConfig.obsidian.defaultFolder || currentConfig.obsidian.defaultSubfolder || 'Katharos_Notas';
    }
    const sideToneEl = document.getElementById('side-ai-tone');
    if (sideToneEl && currentConfig.profile && currentConfig.profile.languageTone) {
      const t = currentConfig.profile.languageTone;
      if (Array.from(sideToneEl.options).some((o) => o.value === t)) {
        sideToneEl.value = t;
      }
    }

    function renderGuidePerf(profile) {
      if (!profile) return;
      document.querySelectorAll('.boost-pill').forEach((b) => {
        b.classList.toggle('active', b.dataset.boost === profile.boostMode);
      });
      const perfEl = document.getElementById('guide-perf-metrics');
      if (perfEl) {
        const speedTag = profile.speed.measured ? 'medido' : 'estimado';
        const baseTag = profile.memory.electronMeasured ? 'medido' : 'est.';
        perfEl.innerHTML =
          `<div><strong>CPU:</strong> ${profile.hardware.cpuModel} (${profile.hardware.logicalCores} threads)</div>` +
          `<div><strong>RAM:</strong> ${profile.hardware.freeRamGb} GB livres de ${profile.hardware.totalRamGb} GB | <strong>Disco I.A:</strong> ${profile.model.diskModelsGb || 0} GB</div>` +
          `<div><strong>Katharos Base (${baseTag}):</strong> ${profile.memory.totalMpeBaseMb} MB WS / ${profile.memory.electronPrivateMb + profile.memory.hookMb} MB priv. (0% CPU minimizado)</div>` +
          `<div><strong>LLM (${profile.model.name}):</strong> ~${profile.memory.llmEstimatedMb} MB (${profile.tuning.threads} gen / ${profile.tuning.threadsBatch} batch, KV ${profile.tuning.kvType.toUpperCase()} ctx ${profile.tuning.contextSize})</div>` +
          `<div><strong>Velocidade (${speedTag}):</strong> Regras ~${profile.speed.builtinMs} ms | LLM ~${profile.speed.promptTokPerSec} tok/s prompt / ~${profile.speed.genTokPerSec} tok/s resposta</div>`;
      }
      const kitsGrid = document.getElementById('guide-kits-grid');
      if (kitsGrid && Array.isArray(profile.kits)) {
        kitsGrid.innerHTML = profile.kits
          .map((k) => {
            const isRec = profile.recommendedKit && profile.recommendedKit.id === k.id;
            return (
              `<div class="kit-card${isRec ? ' recommended' : ''}">` +
              `<div class="kit-card-title">${k.name}${isRec ? '<span class="kit-card-tag">IDEAL P/ ESTE PC</span>' : ''}</div>` +
              `<div><strong>RAM:</strong> ${k.ram}</div>` +
              `<div><strong>CPU/GPU:</strong> ${k.cpu} | ${k.gpu}</div>` +
              `<div><strong>Disco/Vel.:</strong> ${k.disk} | ${k.speed}</div>` +
              `</div>`
            );
          })
          .join('');
      }
    }

    async function openGuideModal() {
      const modal = document.getElementById('modal-guide');
      if (!modal) return;
      modal.classList.remove('hidden');
      syncMiniWindowSizeRef();
      if (window.mpeApi.getPerfProfile) {
        try {
          renderGuidePerf(await window.mpeApi.getPerfProfile());
        } catch (_) {}
      }
    }

    const btnMiniSettings = document.getElementById('btn-mini-settings');
    if (btnMiniSettings) btnMiniSettings.addEventListener('click', openSettingsModal);

    const btnMiniGuide = document.getElementById('btn-mini-guide');
    if (btnMiniGuide) btnMiniGuide.addEventListener('click', openGuideModal);

    const btnCancelSettings = document.getElementById('btn-cancel-settings');
    const btnForgetCorner = document.getElementById('btn-cfg-forget-corner');
    if (btnForgetCorner) {
      btnForgetCorner.addEventListener('click', () => {
        pendingForgetCorner = true;
        renderCornerInfo(null, null);
        showToast('Ao salvar, a janela volta a abrir perto do cursor.');
      });
    }
    if (btnCancelSettings) {
      btnCancelSettings.addEventListener('click', () => {
        document.getElementById('modal-settings').classList.add('hidden');
        syncMiniWindowSizeRef();
      });
    }

    const btnSaveSettings = document.getElementById('btn-save-settings');
    if (btnSaveSettings) btnSaveSettings.addEventListener('click', saveSettingsFromModal);

    const btnBrowseObs = document.getElementById('btn-cfg-browse-obsidian');
    if (btnBrowseObs) {
      btnBrowseObs.addEventListener('click', async () => {
        const folder = await window.mpeApi.selectFolder();
        if (folder) document.getElementById('cfg-obsidian-vault').value = folder;
      });
    }

    const btnBrowseDocs = document.getElementById('btn-cfg-browse-docs');
    if (btnBrowseDocs) {
      btnBrowseDocs.addEventListener('click', async () => {
        const folder = await window.mpeApi.selectFolder();
        if (folder) document.getElementById('cfg-docs-folder').value = folder;
      });
    }

    const btnCfgOpenGuide = document.getElementById('btn-cfg-open-guide');
    if (btnCfgOpenGuide) {
      btnCfgOpenGuide.addEventListener('click', () => {
        document.getElementById('modal-settings').classList.add('hidden');
        openGuideModal();
      });
    }

    const btnCloseGuide = document.getElementById('btn-close-guide');
    if (btnCloseGuide) {
      btnCloseGuide.addEventListener('click', () => {
        document.getElementById('modal-guide').classList.add('hidden');
        syncMiniWindowSizeRef();
      });
    }

    const btnGuideOpenChat = document.getElementById('btn-guide-open-chat');
    if (btnGuideOpenChat) {
      btnGuideOpenChat.addEventListener('click', () => {
        document.getElementById('modal-guide').classList.add('hidden');
        const sideDrawer = document.getElementById('side-chat-drawer');
        if (sideDrawer) sideDrawer.classList.remove('hidden');
        syncMiniWindowSizeRef();
        const sideInput = document.getElementById('side-chat-input');
        if (sideInput) sideInput.focus();
      });
    }

    const btnGuideRepairShortcut = document.getElementById('btn-guide-repair-shortcut');
    if (btnGuideRepairShortcut) {
      btnGuideRepairShortcut.addEventListener('click', async () => {
        if (window.mpeApi.ensureShortcuts) {
          await window.mpeApi.ensureShortcuts();
          showToast('Atalho do Windows atualizado! Fixe o Katharos Nous pela Barra de Tarefas ou Menu Iniciar.');
        }
      });
    }

    document.querySelectorAll('.boost-pill').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.boost || 'balanced';
        if (!window.mpeApi.setBoostMode) return;
        showToast(`Aplicando perfil ${mode}...`);
        const prof = await window.mpeApi.setBoostMode(mode);
        renderGuidePerf(prof);
        showToast(`Perfil ${prof.boostLabel} ativo!`);
      });
    });
    function openSaveAiFileModal({ title = '', category = 'Auto', text = '', filePath = '' } = {}) {
      const modal = document.getElementById('modal-save-ai-file');
      if (!modal) return;
      const titleInput = document.getElementById('ai-doc-title');
      const catSelect = document.getElementById('ai-doc-category');
      const fpInput = document.getElementById('ai-doc-filepath');
      const contentArea = document.getElementById('ai-doc-content');

      if (titleInput) titleInput.value = title || '';
      if (catSelect) catSelect.value = category || 'Auto';
      if (fpInput) fpInput.value = filePath || '';
      if (contentArea) contentArea.value = text || '';

      modal.classList.remove('hidden');
      syncMiniWindowSize();
      if (titleInput) titleInput.focus();
      renderImportTypes().catch(() => {});
    }

    // Importar: "Ja guardados" com barras por tipo
    async function renderImportTypes() {
      const box = document.getElementById('kn-import-types');
      if (!box || !window.KnInsights || !window.KnInsightsView || !window.mpeApi.listDocuments) return;
      let docs = [];
      try {
        const res = await window.mpeApi.listDocuments({});
        docs = res && Array.isArray(res.documents) ? res.documents : [];
      } catch (_) {}
      const spec = window.KnInsights.buildInsight('quantos documentos', docs);
      if (!spec) {
        box.classList.add('hidden');
        return;
      }
      const card = window.KnInsightsView.renderInsightCard(spec);
      const foot = card && card.querySelector('.kn-insight-foot');
      if (foot) foot.remove();
      box.replaceChildren(card);
      box.classList.remove('hidden');
    }

    // Importar: area de arrastar e soltar (o caminho vem do Electron via preload)
    function useDroppedPath(p) {
      if (!p) return;
      document.getElementById('ai-doc-filepath').value = p;
      const titleEl = document.getElementById('ai-doc-title');
      if (titleEl && !titleEl.value.trim()) titleEl.value = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    }

    // Fila: varios arquivos de uma vez, cada um com o seu estado
    const knQueue = [];
    let knQueueRunning = false;
    function knQueueRender() {
      const box = document.getElementById('kn-import-queue');
      if (!box || !window.KnInsightsView) return;
      const el = window.KnInsightsView.el;
      box.classList.toggle('hidden', knQueue.length === 0);
      box.replaceChildren();
      knQueue.forEach((it) => {
        const row = el('div', 'kn-q-row');
        const top = el('div', 'kn-q-top');
        top.appendChild(el('span', 'kn-q-name', it.name));
        top.appendChild(el('span', `kn-q-state is-${it.state}`, it.label));
        row.appendChild(top);
        const track = el('div', 'kn-q-track');
        const fill = el('span', `kn-q-fill is-${it.state}`);
        fill.style.width = it.state === 'wait' ? '0%' : it.state === 'busy' ? '55%' : '100%';
        track.appendChild(fill);
        row.appendChild(track);
        box.appendChild(row);
      });
    }
    async function knQueueAdd(paths) {
      const list = (paths || []).filter(Boolean);
      for (const p of list) {
        const ok = window.mpeApi.isSupportedFile ? await window.mpeApi.isSupportedFile(p) : true;
        knQueue.push({ path: p, name: p.split(/[\\/]/).pop(), state: ok ? 'wait' : 'error', label: ok ? 'Na fila' : 'Formato não aceito' });
      }
      knQueueRender();
      syncMiniWindowSize();
      knQueueRun();
    }
    async function knQueueRun() {
      if (knQueueRunning) return;
      knQueueRunning = true;
      for (const it of knQueue) {
        if (it.state !== 'wait') continue;
        it.state = 'busy';
        it.label = 'Lendo…';
        knQueueRender();
        try {
          const res = await window.mpeApi.saveDocumentFile({ title: it.name.replace(/\.[^.]+$/, ''), category: 'Auto', text: '', sourceFilePath: it.path });
          if (res && res.ok && res.document) {
            it.state = 'ok';
            it.label = `Guardado em ${res.document.category}`;
          } else {
            it.state = 'error';
            it.label = (res && res.error) || 'Não consegui guardar';
          }
        } catch (_) {
          it.state = 'error';
          it.label = 'Não consegui guardar';
        }
        knQueueRender();
      }
      knQueueRunning = false;
      const done = knQueue.filter((i) => i.state === 'ok').length;
      if (done) showToast(`${done} ${done === 1 ? 'arquivo guardado' : 'arquivos guardados'}.`);
      renderImportTypes().catch(() => {});
    }
    function knTakeFiles(paths) {
      const list = (paths || []).filter(Boolean);
      if (!list.length) return;
      if (list.length === 1 && knQueue.length === 0) useDroppedPath(list[0]);
      else knQueueAdd(list);
    }

    const knDrop = document.getElementById('kn-dropzone');
    if (knDrop) {
      const pick = async () => {
        if (window.mpeApi.selectDocumentFiles) knTakeFiles(await window.mpeApi.selectDocumentFiles());
        else useDroppedPath(window.mpeApi.selectDocumentFile ? await window.mpeApi.selectDocumentFile() : await window.mpeApi.selectFile());
      };
      knDrop.addEventListener('click', pick);
      knDrop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      knDrop.addEventListener('dragover', (e) => {
        e.preventDefault();
        knDrop.classList.add('is-over');
      });
      knDrop.addEventListener('dragleave', () => knDrop.classList.remove('is-over'));
      knDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        knDrop.classList.remove('is-over');
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        const paths = files.map((f) => (window.mpeApi.pathForFile ? window.mpeApi.pathForFile(f) : '')).filter(Boolean);
        if (paths.length) knTakeFiles(paths);
        else if (files.length) showToast('Não consegui ler esse arquivo. Use o botão Arquivo...');
      });
    }

    // Pasta inteira: mostra o que encontrou, por tipo, antes de guardar
    const knBtnFolder = document.getElementById('btn-kn-import-folder');
    if (knBtnFolder) {
      knBtnFolder.addEventListener('click', async () => {
        if (!window.mpeApi.selectImportFolder || !window.KnInsightsView) return;
        const scan = await window.mpeApi.selectImportFolder();
        if (!scan) return;
        const box = document.getElementById('kn-folder-summary');
        const V = window.KnInsightsView;
        const el = V.el;
        box.replaceChildren();
        box.appendChild(el('span', 'kn-card-lbl', `Pasta ${scan.folderName}`));
        if (!scan.files.length) {
          box.appendChild(el('span', 'kn-muted', 'Não encontrei arquivos que o Katharos consiga ler aqui.'));
        } else {
          const card = V.renderInsightCard({ kind: 'rank', money: false, title: 'Encontrei', big: String(scan.files.length), bigLabel: scan.files.length === 1 ? 'arquivo para guardar' : 'arquivos para guardar', items: scan.byType, source: scan.folderName });
          const foot = card.querySelector('.kn-insight-foot');
          if (foot) foot.remove();
          box.appendChild(card);
          if (scan.skipped) box.appendChild(el('span', 'kn-muted', `${scan.skipped} outros arquivos ficam de fora (formato não aceito).`));
          if (scan.truncated) box.appendChild(el('span', 'kn-muted', 'Pasta muito grande: peguei os primeiros 500.'));
          const go = el('button', 'hud-btn primary', `Guardar ${scan.files.length} ${scan.files.length === 1 ? 'arquivo' : 'arquivos'}`);
          go.type = 'button';
          go.addEventListener('click', () => {
            box.classList.add('hidden');
            knQueueAdd(scan.files.map((f) => f.path));
          });
          box.appendChild(go);
        }
        box.classList.remove('hidden');
        syncMiniWindowSize();
      });
    }

    // Colar e reconhecer: diz o que o texto parece e sugere a pasta
    const knPasteArea = document.getElementById('ai-doc-content');
    let knPasteTimer = null;
    if (knPasteArea) {
      knPasteArea.addEventListener('input', () => {
        clearTimeout(knPasteTimer);
        knPasteTimer = setTimeout(async () => {
          const hint = document.getElementById('kn-paste-hint');
          if (!hint || !window.mpeApi.recognizeText || !window.KnInsightsView) return;
          let rec = null;
          try {
            rec = await window.mpeApi.recognizeText(knPasteArea.value);
          } catch (_) {}
          if (!rec) {
            hint.classList.add('hidden');
            return;
          }
          const el = window.KnInsightsView.el;
          hint.replaceChildren();
          hint.appendChild(el('strong', '', rec.phrase));
          if (rec.detail) hint.appendChild(el('span', 'kn-muted', rec.detail));
          const b = el('button', 'hud-btn primary', `Guardar em ${rec.label}`);
          b.type = 'button';
          b.addEventListener('click', () => {
            const cat = document.getElementById('ai-doc-category');
            if (cat) cat.value = rec.category;
            const conf = document.getElementById('btn-confirm-ai-doc');
            if (conf) conf.click();
          });
          hint.appendChild(b);
          hint.classList.remove('hidden');
        }, 400);
      });
    }

    const btnPickAiDocFile = document.getElementById('btn-ai-doc-pick-file');
    if (btnPickAiDocFile) {
      btnPickAiDocFile.addEventListener('click', async () => {
        const picked = window.mpeApi.selectDocumentFile
          ? await window.mpeApi.selectDocumentFile()
          : await window.mpeApi.selectFile();
        if (picked) {
          document.getElementById('ai-doc-filepath').value = picked;
          const titleEl = document.getElementById('ai-doc-title');
          if (titleEl && !titleEl.value.trim()) {
            const base = picked.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
            titleEl.value = base;
          }
        }
      });
    }
    const btnClearAiDocFile = document.getElementById('btn-ai-doc-clear-file');
    if (btnClearAiDocFile) {
      btnClearAiDocFile.addEventListener('click', () => {
        document.getElementById('ai-doc-filepath').value = '';
      });
    }
    const btnCancelAiDoc = document.getElementById('btn-cancel-ai-doc');
    if (btnCancelAiDoc) {
      btnCancelAiDoc.addEventListener('click', () => {
        document.getElementById('modal-save-ai-file').classList.add('hidden');
        syncMiniWindowSize();
      });
    }
    const btnConfirmAiDoc = document.getElementById('btn-confirm-ai-doc');
    if (btnConfirmAiDoc) {
      btnConfirmAiDoc.addEventListener('click', async () => {
        const title = document.getElementById('ai-doc-title').value.trim();
        const category = document.getElementById('ai-doc-category').value || 'Auto';
        const sourceFilePath = document.getElementById('ai-doc-filepath').value.trim();
        const text = document.getElementById('ai-doc-content').value.trim();

        if (!sourceFilePath && !text) {
          showToast('Selecione um arquivo ou informe o conteudo para salvar na I.A local.');
          return;
        }

        const runSave = () =>
          window.mpeApi.saveDocumentFile({ title, category, text, sourceFilePath });
        const inMini = document.body.classList.contains('mode-mini-assistant');
        const res =
          inMini && katarosMascot
            ? await katarosMascot.runWithProcessing(runSave, { minDurationMs: 1500, subText: 'ARQUIVO' })
            : await runSave();

        document.getElementById('modal-save-ai-file').classList.add('hidden');
        syncMiniWindowSize();

        if (res && res.ok && res.document) {
          showToast(`Salvo na I.A Local: ${res.document.relPath}`);
        } else {
          showToast((res && res.error) || 'Falha ao salvar arquivo na I.A Local.');
        }
      });
    }

    function handleEscapeKey() {
      const openMiniModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
      if (openMiniModals.length > 0) {
        openMiniModals.forEach((m) => m.classList.add('hidden'));
        syncMiniWindowSize();
        return;
      }
      const sideDrawer = document.getElementById('side-chat-drawer');
      if (document.body.classList.contains('kn-busy') && !document.body.classList.contains('mode-bubble')) {
        // Pergunta ainda processando: vai para o canto como mascote e avisa quando a resposta chegar
        knEnterBubbleRef();
        knBubbleSayRef('Pensando na sua pergunta…');
        return;
      }
      if (sideDrawer && !sideDrawer.classList.contains('hidden')) {
        sideDrawer.classList.add('hidden');
        syncMiniWindowSize();
        return;
      }
      if (katarosMascot) katarosMascot.pause();
      window.mpeApi.hideHud();
    }

    // =========================================================================
    // MINI ASSISTENTE FLUTUANTE (AI KATAROS 3D) & CHAT LATERAL LOCAL
    // =========================================================================
    let lastReviewedText = '';
    let lastReviewSourceText = '';
    let katarosMascot = null;

    if (window.KatarosMascot3D) {
      const mCanvas = document.getElementById('kataros-mascot-canvas');
      if (mCanvas) {
        katarosMascot = new window.KatarosMascot3D(
          mCanvas,
          document.getElementById('kataros-node-status'),
          document.getElementById('kataros-node-sub'),
          document.getElementById('kataros-mascot-node')
        );
      }
    }

    async function runMiniAiReview(textToReview) {
      const textarea = document.getElementById('mini-ai-textarea');
      const text = typeof textToReview === 'string' ? textToReview : textarea.value;
      if (!text || !text.trim()) {
        showToast('Digite ou cole algum texto para a AI Kataros revisar.');
        return;
      }

      const previewBox = document.getElementById('mini-review-preview');
      const previewContent = document.getElementById('mini-review-text');
      const summarySpan = document.getElementById('mini-review-summary');

      summarySpan.textContent = 'Analisando gramatica, estilo e clareza...';
      previewBox.classList.remove('hidden');

      try {
        const res = await window.mpeApi.reviewText({ text });
        if (res && res.ok) {
          lastReviewedText = res.reviewedText;
          lastReviewSourceText = textarea.value;
          summarySpan.textContent = `Revisao Local: ${res.correctionsCount || 0} sugestoes | ${res.readabilityScore || 'Concluido'}`;
          previewContent.textContent = res.reviewedText;

          // Sugere pasta e tags automaticamente se os campos estiverem vazios
          const folderInput = document.getElementById('mini-note-folder');
          const titleInput = document.getElementById('mini-note-title');
          const tagsInput = document.getElementById('mini-note-tags');

          if (!folderInput.value || !titleInput.value) {
            const cls = await window.mpeApi.classifyObsidian({ text });
            if (cls && cls.suggestedFolder && !folderInput.value) {
              folderInput.value = cls.suggestedFolder;
            }
            if (cls && cls.suggestedTitle && !titleInput.value) {
              titleInput.value = cls.suggestedTitle;
            }
            if (cls && cls.suggestedTags && cls.suggestedTags.length && !tagsInput.value) {
              tagsInput.value = cls.suggestedTags.map((t) => `#${t}`).join(', ');
            }
          }
        } else {
          summarySpan.textContent = 'Erro ao processar revisao.';
        }
      } catch (err) {
        summarySpan.textContent = 'Falha na revisao local.';
      }
      syncMiniWindowSize();
    }

    function syncMiniWindowSize() {
      const card = document.getElementById('mini-sci-hud-card');
      const sideDrawer = document.getElementById('side-chat-drawer');
      if (!card || !window.mpeApi.miniResize) return;
      const zoom = document.body.classList.contains('large-text') ? 1.25 : 1;
      const chosen = (currentConfig && currentConfig.ui && currentConfig.ui.chatSize) || null;
      document.body.classList.toggle('kn-user-size', Boolean(chosen));
      const rect = card.getBoundingClientRect();
      const cardH = Math.ceil(rect.height) || 198;
      const cardW = Math.max(Math.ceil(rect.width), card.scrollWidth * zoom, 560);
      document.documentElement.style.setProperty('--mini-card-h', `${Math.round(cardH / zoom)}px`);
      const drawerOpen = sideDrawer && !sideDrawer.classList.contains('hidden');
      const cmdsOpen = sideDrawer && sideDrawer.classList.contains('cmds-open');
      const hasOpenModal = document.querySelectorAll('.modal-backdrop:not(.hidden)').length > 0;
      const availH = (window.screen && window.screen.availHeight) || 0;
      const availW = (window.screen && window.screen.availWidth) || 4000;
      if (hasOpenModal) {
        window.mpeApi.miniResize({ width: Math.round(820 * zoom), height: Math.round(660 * zoom) });
        return;
      }
      if (chosen) {
        // Tamanho escolhido pela borda: a janela fica desse tamanho e a tela se ajusta dentro dela (CSS).
        const w = Math.min(availW, Math.max(576, chosen.width));
        const h = drawerOpen ? Math.min(availH || chosen.height, Math.max(600, chosen.height)) : cardH + 16;
        window.mpeApi.miniResize({ width: w, height: h });
        return;
      }
      // Automatico: 546px de chat (626px com comandos), reduzido para caber na tela
      let drawerH = cmdsOpen ? 626 : 546;
      if (availH > 0) {
        const maxDrawer = Math.floor((availH - 8 - cardH - 16) / zoom) - 14;
        drawerH = Math.max(220, Math.min(drawerH, maxDrawer));
      }
      document.documentElement.style.setProperty('--side-drawer-h', `${drawerH}px`);
      const width = cardW + 16;
      const height = cardH + 16 + (drawerOpen ? Math.round((drawerH + 14) * zoom) : 0);
      window.mpeApi.miniResize({ width, height });
    }
    syncMiniWindowSizeRef = syncMiniWindowSize;

    // Pegadores nas bordas do chat: arrastar muda o tamanho; duplo clique volta ao automatico.
    (function setupChatGrips() {
      const drawer = document.getElementById('side-chat-drawer');
      if (!drawer) return;
      // Os pegadores ficam presos a borda da janela do chat inteira
      drawer.querySelectorAll('.kn-grip').forEach((g) => drawer.appendChild(g));
      let active = false;
      const end = () => {
        if (!active) return;
        active = false;
        document.body.classList.remove('kn-resizing');
        if (window.mpeApi.miniResizeEnd) window.mpeApi.miniResizeEnd();
      };
      drawer.querySelectorAll('.kn-grip').forEach((grip) => {
        grip.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || !window.mpeApi.miniResizeStart) return;
          e.preventDefault();
          grip.setPointerCapture(e.pointerId);
          active = true;
          document.body.classList.add('kn-resizing');
          window.mpeApi.miniResizeStart(grip.dataset.grip);
        });
        grip.addEventListener('pointerup', end);
        grip.addEventListener('pointercancel', end);
        grip.addEventListener('lostpointercapture', end);
        grip.addEventListener('dblclick', async () => {
          if (!currentConfig || !currentConfig.ui) return;
          delete currentConfig.ui.chatSize;
          syncMiniWindowSize();
          try {
            await window.mpeApi.saveConfig(currentConfig);
          } catch (_) {}
          showToast('Tamanho do chat voltou ao automatico.');
        });
      });
      if (window.mpeApi.onChatSize) {
        window.mpeApi.onChatSize((size) => {
          if (!currentConfig) return;
          currentConfig.ui = Object.assign({}, currentConfig.ui || {}, { chatSize: size });
          document.body.classList.add('kn-user-size');
        });
      }
    })();

    function setupMiniAssistant() {
      const overlay = document.getElementById('mini-assistant-overlay');
      const textarea = document.getElementById('mini-ai-textarea');
      const sideDrawer = document.getElementById('side-chat-drawer');
      const sendTargetSelect = document.getElementById('mini-send-target');
      const metaFields = document.getElementById('mini-meta-fields');

      function updateSendTargetUI() {
        const target = sendTargetSelect ? sendTargetSelect.value : 'obsidian';
        if (metaFields) metaFields.dataset.target = target;
        syncMiniWindowSize();
      }
      if (sendTargetSelect) {
        sendTargetSelect.addEventListener('change', updateSendTargetUI);
        updateSendTargetUI();
      }

      // Ao colar no textarea, executa automaticamente a mini revisao instantanea
      textarea.addEventListener('paste', () => {
        setTimeout(() => {
          runMiniAiReview();
        }, 120);
      });

      document.getElementById('btn-mini-paste').addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            textarea.value = text;
            runMiniAiReview(text);
          } else {
            showToast('Area de transferencia vazia.');
          }
        } catch (_) {
          showToast('Clique no campo e aperte Ctrl+V.');
        }
      });

      document.getElementById('btn-mini-review').addEventListener('click', () => {
        runMiniAiReview();
      });

      document.getElementById('btn-mini-copy').addEventListener('click', async () => {
        const text =
          lastReviewedText && textarea.value === lastReviewSourceText
            ? lastReviewedText
            : textarea.value;
        if (!text) {
          showToast('Nenhum texto para copiar.');
          return;
        }
        await window.mpeApi.copyToClipboard(text);
        showToast('Texto copiado com sucesso!');
      });

      document.getElementById('btn-mini-apply-review').addEventListener('click', () => {
        if (lastReviewedText) {
          textarea.value = lastReviewedText;
          lastReviewSourceText = lastReviewedText;
          showToast('Texto substituido pela versao revisada.');
        }
      });

      const btnMiniSaveFile = document.getElementById('btn-mini-save-file');
      if (btnMiniSaveFile) {
        btnMiniSaveFile.addEventListener('click', () => {
          const text =
            lastReviewedText && textarea.value === lastReviewSourceText
              ? lastReviewedText
              : textarea.value;
          const title = document.getElementById('mini-note-title').value.trim();
          openSaveAiFileModal({ title, category: 'Auto', text });
        });
      }

      async function saveMiniTextToObsidian(text) {
        const title = document.getElementById('mini-note-title').value.trim();
        const folder = document.getElementById('mini-note-folder').value.trim();
        const tagsRaw = document.getElementById('mini-note-tags').value.trim();
        const tags = tagsRaw ? tagsRaw.split(/[, ]+/).filter(Boolean) : [];

        const runObsidian = () => window.mpeApi.saveToObsidian({ title, text, folder, tags });
        const res = katarosMascot
          ? await katarosMascot.runWithProcessing(runObsidian, { minDurationMs: 1600, subText: 'GUARDANDO' })
          : await runObsidian();

        if (res && res.ok) {
          // O titulo vale so para esta anotacao; a proxima nao pode reaproveitar um titulo escondido.
          document.getElementById('mini-note-title').value = '';
          showToast(`Guardado em ${res.folder}: ${res.fileName}`);
          if (katarosMascot && katarosMascot.flashSub) katarosMascot.flashSub('GUARDADO', 3000);
        } else {
          showToast(`Não consegui guardar: ${(res && res.error) || 'pasta de anotações inacessível'}`);
        }
        return res;
      }

      function currentMiniText() {
        return lastReviewedText && textarea.value === lastReviewSourceText ? lastReviewedText : textarea.value;
      }

      let miniRouteBusy = false;
      document.querySelectorAll('.mini-route-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (miniRouteBusy) return;
          const route = btn.dataset.route;
          const text = String(currentMiniText() || '').trim();
          if (!text) {
            const what = route === 'local' ? 'encontrar' : route === 'nota' ? 'guardar' : 'perguntar';
            showToast(`Escreva o que quer ${what}.`);
            textarea.focus();
            return;
          }
          miniRouteBusy = true;
          try {
            if (route === 'nota') {
              await saveMiniTextToObsidian(text);
              return;
            }
            sideDrawer.classList.remove('hidden');
            const chatInput = document.getElementById('side-chat-input');
            chatInput.value = text;
            setRouteRef(route);
            syncMiniWindowSize();
            await sendSideChatMessageRef();
          } finally {
            miniRouteBusy = false;
          }
        });
      });

      const sendBtn = document.getElementById('btn-mini-send');
      let sendingBusy = false;
      sendBtn.addEventListener('click', async () => {
        if (sendingBusy) return;
        const text =
          lastReviewedText && textarea.value === lastReviewSourceText
            ? lastReviewedText
            : textarea.value;
        const destination = sendTargetSelect ? sendTargetSelect.value : 'obsidian';

        if (destination === 'ai_local') {
          const title = document.getElementById('mini-note-title').value.trim();
          openSaveAiFileModal({ title, category: 'Auto', text });
          return;
        }

        if (!text || !text.trim()) {
          showToast('Escreva ou cole um texto antes de enviar.');
          return;
        }

        sendingBusy = true;
        sendBtn.disabled = true;

        try {
          if (destination === 'obsidian') {
            await saveMiniTextToObsidian(text);
          } else if (destination === 'notepad') {
            if (katarosMascot) {
              await katarosMascot.runWithProcessing(async () => {}, {
                minDurationMs: 1600,
                subText: 'BLOCO DE NOTAS'
              });
            }
            const res = await window.mpeApi.sendToTargetSystem({
              text,
              targetSystem: 'Bloco de Notas',
              autoSendEnter: false,
              keepOpen: true
            });
            if (res && res.ok) {
              showToast(`Enviado para [${res.targetSystem || 'Bloco de Notas'}]!`);
            } else {
              showToast('Texto pronto na Area de Transferencia para o Bloco de Notas.');
            }
          } else if (destination === 'telegram') {
            const tgTarget =
              (currentConfig && currentConfig.telegram && currentConfig.telegram.savedChatPath) ||
              'Eu | Você | Leonardo';
            if (katarosMascot) {
              await katarosMascot.runWithProcessing(async () => {}, {
                minDurationMs: 1600,
                subText: 'TELEGRAM'
              });
            }
            const res = await window.mpeApi.sendTextToTelegram({
              text,
              target: tgTarget,
              keepOpen: true
            });
            if (res && res.ok) {
              showToast(`Enviado para o Telegram (${res.targetChat || tgTarget})!`);
            } else {
              showToast('Texto pronto na Area de Transferencia para o Telegram.');
            }
          }
        } catch (err) {
          showToast(`Falha ao enviar: ${err.message || 'erro desconhecido'}`);
        } finally {
          sendingBusy = false;
          sendBtn.disabled = false;
        }
      });

      document.getElementById('btn-mini-chat-toggle').addEventListener('click', () => {
        const mode = currentWindowMode();
        requestWindowMode(mode === 'simples' ? 'grande' : 'simples');
      });

      // Arrasto da janela compacta pelo cabecalho ou pelo no circular
      const dragHandles = [
        document.getElementById('mini-drag-handle'),
        document.querySelector('.mini-node-ring'),
        document.getElementById('bar-drag-handle')
      ];
      dragHandles.forEach((handle) => {
        if (!handle) return;
        handle.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.target.closest('button, input, textarea')) return;
          e.preventDefault();
          handle.setPointerCapture(e.pointerId);
          if (window.mpeApi.miniDragStart) window.mpeApi.miniDragStart();
        });
        const endDrag = () => {
          if (window.mpeApi.miniDragEnd) window.mpeApi.miniDragEnd();
        };
        handle.addEventListener('pointerup', endDrag);
        handle.addEventListener('pointercancel', endDrag);
        handle.addEventListener('lostpointercapture', endDrag);
      });

      // Janela acompanha o tamanho real do card (textarea, revisao, chat)
      const card = document.getElementById('mini-sci-hud-card');
      if (card && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => syncMiniWindowSize()).observe(card);
      }

      document.getElementById('btn-mini-close').addEventListener('click', () => {
        sideDrawer.classList.add('hidden');
        syncMiniWindowSize();
        if (katarosMascot) katarosMascot.pause();
        window.mpeApi.hideHud();
      });

      // Chat Lateral Local
      const LS_CMDS_VISIBLE = 'mpe_ai_cmds_visible';
      const LS_READABLE_LG = 'mpe_ai_readable_lg';
      const LS_WIDE_MODE = 'mpe_ai_wide';

      const SIDE_QUICK_COMMANDS = [
        // Texto & Edicao
        { id: 'revisar', label: '/revisar', cmd: '/revisar ', cat: 'texto', send: false, hint: 'Revisar gramatica, ortografia e clareza do texto' },
        { id: 'resumir', label: '/resumir', cmd: '/resumir ', cat: 'texto', send: false, hint: 'Resumir texto, nota ou arquivo salvo' },
        { id: 'explicar', label: '/explicar', cmd: '/explicar ', cat: 'texto', send: false, hint: 'Explicar termo, nota ou documento passo a passo' },
        { id: 'traduzir-en', label: 'Traduzir EN', cmd: '/traduzir ingles ', cat: 'texto', send: false, hint: 'Traduzir texto para ingles' },
        { id: 'traduzir-pt', label: 'Traduzir PT', cmd: '/traduzir portugues ', cat: 'texto', send: false, hint: 'Traduzir texto para portugues' },
        { id: 'redigir', label: '/redigir', cmd: '/redigir ', cat: 'texto', send: false, hint: 'Redigir texto, email ou mensagem pronta' },
        { id: 'codigo', label: '/codigo', cmd: '/codigo ', cat: 'texto', send: false, hint: 'Gerar codigo ou script usando contexto local' },
        { id: 'adaptar-curto', label: 'Encurtar ultima', cmd: '/adaptar deixe mais curto e direto', cat: 'texto', send: true, hint: 'Deixar a ultima resposta mais curta e objetiva' },
        { id: 'adaptar-topicos', label: 'Virar topicos', cmd: '/adaptar organize em lista de topicos claros', cat: 'texto', send: true, hint: 'Transformar a ultima resposta em topicos' },
        { id: 'adaptar-melhorar', label: 'Refinar ultima', cmd: '/adaptar melhore a clareza e o tom mantendo o sentido', cat: 'texto', send: true, hint: 'Refinar estilo e clareza da ultima resposta' },
        { id: 'resumir-extrato-ex', label: 'Resumir Extrato', cmd: '/resumir Extrato_Conta_Corrente_Exemplo', cat: 'texto', send: true, hint: 'Exemplo de busca por documento no /resumir' },

        // Notas, Documentos & Obsidian
        { id: 'buscar', label: '/buscar', cmd: '/buscar ', cat: 'docs', send: false, hint: 'Buscar em Documentos, Obsidian e Memoria' },
        { id: 'buscar-ex', label: 'Buscar: Extrato', cmd: '/buscar extrato', cat: 'docs', send: true, hint: 'Exemplo de busca unificada (Documentos, Obsidian e Memoria)' },
        { id: 'obsidian', label: '/obsidian', cmd: '/obsidian', cat: 'docs', send: true, hint: 'Listar notas recentes do cofre Obsidian' },
        { id: 'obsidian-fin-ex', label: 'Obsidian: Finanças', cmd: '/obsidian financeiro', cat: 'docs', send: true, hint: 'Exemplo de busca na nota financeira do Obsidian' },
        { id: 'arquivos', label: '/arquivos', cmd: '/arquivos', cat: 'docs', send: true, hint: 'Listar documentos salvos na I.A Local' },
        { id: 'historico', label: '/historico', cmd: '/historico ', cat: 'docs', send: false, hint: 'Ver dias de conversa ou buscar no historico local' },
        { id: 'arquivos-ex', label: 'Arquivos: Fatura', cmd: '/arquivos fatura', cat: 'docs', send: true, hint: 'Exemplo de busca por termo nos arquivos locais' },
        { id: 'extrato', label: '/extrato', cmd: '/extrato ', cat: 'docs', send: false, hint: 'Consultar extratos e movimentacoes' },
        { id: 'extrato-ex', label: 'Extrato Exemplo', cmd: '/extrato', cat: 'docs', send: true, hint: 'Consultar extratos financeiros de exemplo (CSV e OFX)' },
        { id: 'saldo', label: '/saldo', cmd: '/saldo', cat: 'docs', send: true, hint: 'Exibir saldos detectados nos extratos' },
        { id: 'recibo', label: '/recibo', cmd: '/recibo', cat: 'docs', send: true, hint: 'Buscar recibos e comprovantes salvos' },
        { id: 'pergunta-fin-ex', label: 'Pergunta Saldo', cmd: 'Qual o saldo e os principais gastos dos extratos financeiros de exemplo?', cat: 'docs', send: true, hint: 'Exemplo de busca contextual no chat livre' },
        { id: 'salvar', label: '/salvar', cmd: '/salvar ', cat: 'docs', send: false, hint: 'Salvar a ultima resposta no Obsidian' },
        { id: 'salvar-arquivo', label: '/salvar-arquivo', cmd: '/salvar-arquivo ', cat: 'docs', send: false, hint: 'Salvar a ultima resposta nos documentos da I.A' },
        { id: 'organizar', label: '/organizar', cmd: '/organizar', cat: 'docs', send: true, hint: 'Abrir o Organizador de Arquivos' },

        // Estilo & Memoria
        { id: 'lembrar', label: '/lembrar', cmd: '/lembrar ', cat: 'estilo', send: false, hint: 'Guardar fato permanente na memoria' },
        { id: 'memoria', label: '/memoria', cmd: '/memoria', cat: 'estilo', send: true, hint: 'Listar fatos guardados na memoria' },
        { id: 'treinar', label: '/treinar', cmd: '/treinar pergunta => resposta', cat: 'estilo', send: false, selectFrom: 'pergunta', hint: 'Ensinar exemplo (pergunta => resposta)' },
        { id: 'exemplos', label: '/exemplos', cmd: '/exemplos', cat: 'estilo', send: true, hint: 'Listar exemplos de treino aprendidos' },
        { id: 'tom-pro', label: 'Tom Profissional', cmd: '/tom profissional', cat: 'estilo', send: true, hint: 'Alterar tom para Profissional' },
        { id: 'tom-conciso', label: 'Tom Conciso', cmd: '/tom conciso', cat: 'estilo', send: true, hint: 'Alterar tom para Conciso e direto' },
        { id: 'persona', label: '/persona', cmd: '/persona ', cat: 'estilo', send: false, hint: 'Definir instrucao fixa de comportamento' },

        // Sistema & Motor
        { id: 'status', label: '/status', cmd: '/status', cat: 'sistema', send: true, hint: 'Estado do motor, RAM e memoria' },
        { id: 'status-busca-ex', label: 'Status: Extrato', cmd: '/status extrato', cat: 'sistema', send: true, hint: 'Exemplo de busca rapida pelo comando /status' },
        { id: 'param', label: '/param', cmd: '/param', cat: 'sistema', send: true, hint: 'Listar parametros ativos e perfis' },
        { id: 'boost', label: '/boost', cmd: '/boost', cat: 'sistema', send: true, hint: 'Otimizar RAM e velocidade (Turbo)' },
        { id: 'boost-eco', label: '/boost eco', cmd: '/boost eco', cat: 'sistema', send: true, hint: 'Ativar modo Eco com menor uso de RAM' },
        { id: 'kits', label: '/kits', cmd: '/kits', cat: 'sistema', send: true, hint: 'Calcular memoria e kits minimos' },
        { id: 'iniciar', label: '/iniciar', cmd: '/iniciar', cat: 'sistema', send: true, hint: 'Iniciar servidor LLM local' },
        { id: 'parar', label: '/parar', cmd: '/parar', cat: 'sistema', send: true, hint: 'Encerrar servidor LLM e liberar RAM' },
        { id: 'ajuda', label: '/ajuda', cmd: '/ajuda', cat: 'sistema', send: true, hint: 'Exibir ajuda completa de comandos' },

        // Acoes Exclusivas do UI
        { id: 'ui-pull-mini', label: 'Puxar do Mini', cat: 'ui', uiAction: 'pull-mini', hint: 'Trazer texto do Mini Assistente para a caixa do chat' },
        { id: 'ui-push-mini', label: 'Enviar p/ Mini', cat: 'ui', uiAction: 'push-mini', hint: 'Enviar ultima resposta para o campo do Mini Assistente' },
        { id: 'ui-paste-rev', label: 'Colar e Revisar', cat: 'ui', uiAction: 'paste-review', hint: 'Colar texto copiado com /revisar pronto' },
        { id: 'ui-copy-last', label: 'Copiar Ultima', cat: 'ui', uiAction: 'copy-last', hint: 'Copiar a ultima resposta da I.A' },
        { id: 'ui-copy-chat', label: 'Copiar Chat', cat: 'ui', uiAction: 'copy-chat', hint: 'Copiar toda a conversa visivel' },
        { id: 'ui-readable', label: 'Texto Maior A+', cat: 'ui', uiAction: 'toggle-readable', hint: 'Alternar tamanho de texto e leitura ampliada' },
        { id: 'ui-wide', label: 'Expandir Painel', cat: 'ui', uiAction: 'toggle-wide', hint: 'Alternar largura do chat lateral' },
        { id: 'ui-top', label: 'Topo do Chat', cat: 'ui', uiAction: 'scroll-top', hint: 'Rolar para o inicio da conversa' }
      ];

      document.getElementById('btn-close-side-chat').addEventListener('click', () => {
        sideDrawer.classList.add('hidden');
        syncMiniWindowSize();
      });

      document.getElementById('btn-side-chat-clear').addEventListener('click', () => {
        if (window.mpeApi.aiChat) window.mpeApi.aiChat({ message: '/limpar' }).catch(() => {});
        lastSideResponse = '';
        const msgs = document.getElementById('side-chat-messages');
        msgs.innerHTML = `
          <div class="side-msg assistant">
            <div class="side-msg-header">
              <span class="side-msg-author">KATHAROS AI</span>
              <span class="side-msg-time">Agora</span>
              <button type="button" class="side-msg-copy-btn" title="Copiar resposta">Copiar</button>
            </div>
            <div class="side-msg-content">Historico limpo. Use o botao Comandos ou envie /ajuda.</div>
          </div>
        `;
        knRenderHome().catch(() => {});
      });

      let lastSideResponse = '';
      let chatBusy = false;
      let activeRequest = null;

      function normalizeQuickText(str) {
        return String(str || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
      }

      SIDE_QUICK_COMMANDS.forEach((item) => {
        item._searchHay = normalizeQuickText(`${item.label} ${item.cmd || ''} ${item.hint}`);
      });

      function formatSideMessageHtml(rawText) {
        const raw = String(rawText || '').replace(/\r\n/g, '\n');
        const codeBlocks = [];
        const withPlaceholders = raw.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code) => {
          const idx = codeBlocks.length;
          codeBlocks.push(code.replace(/\n$/, ''));
          return `\u0000CODEBLOCK${idx}\u0000`;
        });

        let html = escapeHtml(withPlaceholders);
        html = html.replace(/`([^`\n]+)`/g, '<code class="side-msg-inline-code">$1</code>');
        html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/^(#{1,3}\s+.+)$/gm, '<span class="side-msg-heading">$1</span>');
        html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_m, idxStr) => {
          const code = codeBlocks[Number(idxStr)] || '';
          return `<pre class="side-msg-code">${escapeHtml(code)}</pre>`;
        });
        return html;
      }

      async function copyTextSafe(text) {
        if (!text) return false;
        try {
          if (window.mpeApi && window.mpeApi.copyToClipboard) {
            await window.mpeApi.copyToClipboard(text);
            return true;
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch (_) {}
        return false;
      }

      // Copiar resposta individual, reutilizar prompt enviado e botao discreto de rolar ao fim
      const sideMsgsContainer = document.getElementById('side-chat-messages');
      const btnSideScrollBottom = document.getElementById('btn-side-scroll-bottom');
      const sideInputEl = document.getElementById('side-chat-input');
      const sentPromptHistory = [];
      let historyCursor = -1;
      let historyDraft = '';
      if (window.mpeApi.recentPrompts) {
        window.mpeApi.recentPrompts().then((list) => {
          if (Array.isArray(list) && list.length && sentPromptHistory.length === 0) {
            sentPromptHistory.push(...list.slice(-40));
          }
        }).catch(() => {});
      }

      // Rotas: Perguntar (ia) / Procurar (local) / Guardar (nota)
      const ROUTE_UI = {
        ia: { label: 'Perguntar', status: 'Vai para a inteligência', tag: 'perguntou' },
        local: { label: 'Procurar', status: 'Não vai para a inteligência. Busca nos seus arquivos', tag: 'procurou' },
        nota: { label: 'Guardar', status: 'Não vai para a inteligência. Guarda como anotação', tag: 'guardou' }
      };
      const ROUTE_CODE_RE = /^\s*@(ia|perguntar|local|procurar|nota|guardar)(?=\s|$)/i;
      const ROUTE_CODE_MAP = { ia: 'ia', perguntar: 'ia', local: 'local', procurar: 'local', nota: 'nota', guardar: 'nota' };
      const ROUTE_LOCAL_CMDS = ['rapido', 'fast', 'achar', 'localizar', 'doc', 'buscar', 'arquivos', 'extrato', 'saldo', 'recibo', 'obsidian', 'memoria', 'exemplos', 'status', 'param', 'historico'];
      const ROUTE_NOTA_CMDS = ['salvar', 'salvar-arquivo', 'lembrar', 'treinar'];
      let currentRoute = 'ia';

      function detectRouteFromText(text) {
        const raw = String(text || '');
        const code = raw.match(ROUTE_CODE_RE);
        if (code) return ROUTE_CODE_MAP[code[1].toLowerCase()];
        const cmd = raw.trim().match(/^\/([a-z-]+)/i);
        if (cmd) {
          const c = cmd[1].toLowerCase();
          return ROUTE_LOCAL_CMDS.includes(c) ? 'local' : ROUTE_NOTA_CMDS.includes(c) ? 'nota' : 'ia';
        }
        return null;
      }

      function setRouteClass(el, route) {
        if (!el) return;
        el.classList.remove('route-ia', 'route-local', 'route-nota');
        el.classList.add(`route-${route}`);
      }

      function renderRoute() {
        const fromText = sideInputEl ? detectRouteFromText(sideInputEl.value) : null;
        const route = fromText || currentRoute;
        const info = ROUTE_UI[route];
        document.querySelectorAll('.route-bar .route-btn').forEach((btn) => {
          btn.setAttribute('aria-pressed', btn.dataset.route === route ? 'true' : 'false');
        });
        const statusBox = document.getElementById('route-status');
        if (statusBox) {
          statusBox.innerHTML = `<strong>${info.status}</strong>${fromText ? ' (definido pelo código)' : ''}`;
          setRouteClass(statusBox, route);
        }
        const sendBtnEl = document.getElementById('btn-side-chat-send');
        if (sendBtnEl) {
          sendBtnEl.textContent = info.label;
          setRouteClass(sendBtnEl, route);
        }
        setRouteClass(sideInputEl, route);
        const placeholders = {
          ia: 'Escreva sua pergunta aqui...',
          local: 'Escreva o que quer encontrar...',
          nota: 'Escreva o que quer guardar...'
        };
        if (sideInputEl) sideInputEl.placeholder = placeholders[route];
      }

      function setRoute(route) {
        currentRoute = ROUTE_UI[route] ? route : 'ia';
        renderRoute();
      }
      setRouteRef = setRoute;

      // Tamanho da janela: Barra (lateral) / Simples / Grande (com conversa) / Tela cheia
      const SIZE_NAMES = { barra: 'Barra', simples: 'Simples', grande: 'Grande', cheia: 'Tela cheia', mascote: 'Mascote' };
      const SIZE_ORDER = ['barra', 'simples', 'grande'];
      const barEl = document.getElementById('kataros-bar');

      function currentWindowMode() {
        if (document.body.classList.contains('mode-bubble')) return 'mascote';
        if (document.body.classList.contains('mode-bar')) return 'barra';
        if (document.body.classList.contains('mode-full')) return 'cheia';
        return sideDrawer.classList.contains('hidden') ? 'simples' : 'grande';
      }

      function updateSizeUi() {
        const mode = currentWindowMode();
        const label = document.getElementById('size-label');
        if (label) label.textContent = SIZE_NAMES[mode];
        const up = document.getElementById('btn-size-up');
        if (up) up.disabled = mode === 'grande' || mode === 'cheia';
        const full = document.getElementById('btn-size-full');
        if (full) {
          const t = mode === 'cheia' ? 'Sair da tela cheia' : 'Tela cheia';
          full.title = t;
          full.setAttribute('aria-label', t);
        }
      }

      function applyWindowMode(mode, side) {
        const isBubble = mode === 'mascote';
        document.body.classList.toggle('mode-bubble', isBubble);
        document.body.classList.toggle('bubble-left', isBubble && side === 'left');
        if (!isBubble) knBubbleSay('');
        if (isBubble) {
          updateSizeUi();
          return;
        }
        const isBar = mode === 'barra';
        document.body.classList.toggle('mode-bar', isBar);
        document.body.classList.toggle('mode-full', mode === 'cheia');
        if (barEl) {
          barEl.classList.toggle('hidden', !isBar);
          if (side) {
            barEl.classList.toggle('dock-left', side === 'left');
            barEl.classList.toggle('dock-right', side !== 'left');
          }
        }
        if (mode === 'simples') sideDrawer.classList.add('hidden');
        if (mode === 'grande' || mode === 'cheia') sideDrawer.classList.remove('hidden');
        updateSizeUi();
        if (!isBar && mode !== 'cheia') syncMiniWindowSize();
      }
      applyWindowModeRef = applyWindowMode;

      async function requestWindowMode(mode) {
        let res = null;
        try {
          res = window.mpeApi.setWindowMode ? await window.mpeApi.setWindowMode(mode) : null;
        } catch (_) {}
        applyWindowMode(mode, res && res.side);
        return res;
      }

      document.getElementById('btn-size-down').addEventListener('click', () => {
        const mode = currentWindowMode();
        if (mode === 'cheia') return requestWindowMode('grande');
        const i = SIZE_ORDER.indexOf(mode);
        if (i > 0) requestWindowMode(SIZE_ORDER[i - 1]);
      });
      document.getElementById('btn-size-up').addEventListener('click', () => {
        const i = SIZE_ORDER.indexOf(currentWindowMode());
        if (i >= 0 && i < SIZE_ORDER.length - 1) requestWindowMode(SIZE_ORDER[i + 1]);
      });
      document.getElementById('btn-size-full').addEventListener('click', () => {
        requestWindowMode(currentWindowMode() === 'cheia' ? 'grande' : 'cheia');
      });

      // ===== Modo mascote: segurar no mascote minimiza; ESC durante uma pergunta tambem =====
      function knBubbleSay(text, kind) {
        const say = document.getElementById('kn-bubble-say');
        if (!say) return;
        say.textContent = text || '';
        say.classList.toggle('hidden', !text);
        say.classList.toggle('is-answer', kind === 'answer');
      }
      knBubbleSayRef = knBubbleSay;
      knEnterBubbleRef = () => requestWindowMode('mascote');

      async function knLeaveBubble(route) {
        const busyOrAnswer = document.body.classList.contains('kn-busy') || document.getElementById('kn-bubble-say').classList.contains('is-answer');
        await requestWindowMode(busyOrAnswer || route ? 'grande' : 'simples');
        if (route) setRoute(route);
        const target = busyOrAnswer || route ? sideInputEl : document.getElementById('mini-ai-textarea');
        if (target) target.focus();
        const msgsEl = document.getElementById('side-chat-messages');
        if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
      }
      document.querySelectorAll('[data-bubble-route]').forEach((b) => {
        b.addEventListener('click', () => knLeaveBubble(b.dataset.bubbleRoute));
      });
      const knSay = document.getElementById('kn-bubble-say');
      if (knSay) knSay.addEventListener('click', () => knLeaveBubble(''));

      // Segurar (sem arrastar) por 0,6 s no mascote alterna entre janela e so o mascote
      [document.querySelector('.mini-node-ring'), document.getElementById('bar-drag-handle')].forEach((node) => {
        if (!node) return;
        let hold = null;
        const cancel = () => {
          if (hold) clearTimeout(hold.timer);
          hold = null;
          node.classList.remove('kn-holding');
        };
        node.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.target.closest('button, input, textarea')) return;
          cancel();
          node.classList.add('kn-holding');
          hold = {
            x: e.screenX,
            y: e.screenY,
            timer: setTimeout(async () => {
              hold = null;
              node.classList.remove('kn-holding');
              if (window.mpeApi.miniDragEnd) window.mpeApi.miniDragEnd();
              if (currentWindowMode() === 'mascote') knLeaveBubble('');
              else requestWindowMode('mascote');
            }, 600)
          };
        });
        node.addEventListener('pointermove', (e) => {
          if (hold && (Math.abs(e.screenX - hold.x) > 6 || Math.abs(e.screenY - hold.y) > 6)) cancel();
        });
        node.addEventListener('pointerup', cancel);
        node.addEventListener('pointercancel', cancel);
      });

      ['ia', 'local'].forEach((route) => {
        document.getElementById(`btn-bar-route-${route}`).addEventListener('click', async () => {
          await requestWindowMode('grande');
          setRoute(route);
          if (sideInputEl) sideInputEl.focus();
        });
      });
      document.getElementById('btn-bar-route-nota').addEventListener('click', async () => {
        await requestWindowMode('simples');
        textarea.focus();
      });
      document.getElementById('btn-bar-expand').addEventListener('click', () => requestWindowMode('simples'));

      if (window.mpeApi.onWindowMode) {
        window.mpeApi.onWindowMode((data) => {
          if (data && SIZE_NAMES[data.mode]) applyWindowMode(data.mode, data.side);
        });
      }

      // O texto de estado do mascote (PRONTO, GUARDADO...) aparece tambem na barra.
      const nodeSubEl = document.getElementById('kataros-node-sub');
      const barStatusEl = document.getElementById('bar-status');
      if (nodeSubEl && barStatusEl && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => {
          barStatusEl.textContent = nodeSubEl.textContent;
        }).observe(nodeSubEl, { childList: true, characterData: true, subtree: true });
      }

      document.querySelectorAll('.route-bar .route-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (sideInputEl) {
            sideInputEl.value = sideInputEl.value.replace(ROUTE_CODE_RE, '').replace(/^\s+/, '');
          }
          setRoute(btn.dataset.route);
          if (sideInputEl) sideInputEl.focus();
        });
      });

      const btnTune = document.getElementById('btn-side-chat-tune');
      if (btnTune) {
        btnTune.addEventListener('click', () => {
          const params = document.querySelector('.side-chat-params');
          if (!params) return;
          const nowHidden = params.classList.toggle('hidden');
          btnTune.setAttribute('aria-pressed', nowHidden ? 'false' : 'true');
          syncMiniWindowSize();
        });
      }

      function autoResizeSideInput() {
        if (!sideInputEl) return;
        sideInputEl.style.height = 'auto';
        const nextH = Math.max(52, Math.min(124, sideInputEl.scrollHeight));
        sideInputEl.style.height = `${nextH}px`;
      }

      function updateScrollBottomVisibility() {
        if (!sideMsgsContainer || !btnSideScrollBottom) return;
        const distFromBottom = sideMsgsContainer.scrollHeight - sideMsgsContainer.scrollTop - sideMsgsContainer.clientHeight;
        btnSideScrollBottom.classList.toggle('hidden', distFromBottom < 80);
      }

      if (btnSideScrollBottom && sideMsgsContainer) {
        btnSideScrollBottom.addEventListener('click', () => {
          sideMsgsContainer.scrollTo({ top: sideMsgsContainer.scrollHeight, behavior: 'smooth' });
        });
        sideMsgsContainer.addEventListener('scroll', updateScrollBottomVisibility);
      }

      if (sideMsgsContainer) {
        sideMsgsContainer.addEventListener('click', async (e) => {
          const reuseBtn = e.target.closest('.side-msg-reuse-btn');
          if (reuseBtn && sideInputEl) {
            const msgEl = reuseBtn.closest('.side-msg');
            const contentEl = msgEl ? msgEl.querySelector('.side-msg-content') : null;
            if (!contentEl) return;
            sideInputEl.value = (contentEl.dataset.rawText || contentEl.textContent || '').trim();
            autoResizeSideInput();
            sideInputEl.focus();
            return;
          }
          const copyBtn = e.target.closest('.side-msg-copy-btn');
          if (!copyBtn) return;
          const msgEl = copyBtn.closest('.side-msg');
          const contentEl = msgEl ? msgEl.querySelector('.side-msg-content') : null;
          if (!contentEl) return;
          const raw = contentEl.dataset.rawText || contentEl.textContent || '';
          const ok = await copyTextSafe(raw.trim());
          if (ok) {
            copyBtn.textContent = 'Copiado';
            setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1400);
            showToast('Resposta copiada!');
          } else {
            showToast('Nao foi possivel copiar.');
          }
        });
      }

      // Controles de Visibilidade do UI (A+ leitura ampliada, Expandir largura, Comandos opcionais)
      const btnTextSize = document.getElementById('btn-side-chat-textsize');
      const btnWideMode = document.getElementById('btn-side-chat-wide');
      const btnToggleCmds = document.getElementById('btn-toggle-side-cmds');
      const btnHideCmds = document.getElementById('btn-hide-side-cmds');
      const cmdsPanel = document.getElementById('side-cmds-panel');
      const cmdsGrid = document.getElementById('side-quick-cmds');
      const cmdsFilterInput = document.getElementById('side-cmds-filter');
      const cmdsCountEl = document.getElementById('side-cmds-count');

      function applyReadablePreference(enabled) {
        const on = Boolean(enabled);
        sideDrawer.classList.toggle('readable-lg', on);
        if (btnTextSize) {
          btnTextSize.classList.toggle('active', on);
          btnTextSize.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        try { localStorage.setItem(LS_READABLE_LG, on ? '1' : '0'); } catch (_) {}
      }

      function applyWidePreference(enabled) {
        const on = Boolean(enabled);
        sideDrawer.classList.toggle('wide-mode', on);
        if (btnWideMode) {
          btnWideMode.classList.toggle('active', on);
          btnWideMode.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        try { localStorage.setItem(LS_WIDE_MODE, on ? '1' : '0'); } catch (_) {}
      }

      let activeCmdCat = 'all';
      let lastCmdRenderKey = '';
      function renderQuickCommands() {
        if (!cmdsGrid) return;
        const q = normalizeQuickText(cmdsFilterInput ? cmdsFilterInput.value.trim() : '');
        const renderKey = `${activeCmdCat}|${q}`;
        if (renderKey === lastCmdRenderKey) return;
        lastCmdRenderKey = renderKey;

        const list = SIDE_QUICK_COMMANDS.filter((item) => {
          if (activeCmdCat !== 'all' && item.cat !== activeCmdCat) return false;
          if (!q) return true;
          return (item._searchHay || '').includes(q);
        });

        if (cmdsCountEl) cmdsCountEl.textContent = String(list.length);

        if (!list.length) {
          cmdsGrid.innerHTML = '<div class="side-cmds-empty">Nenhum comando encontrado para esse filtro.</div>';
          return;
        }

        cmdsGrid.innerHTML = list
          .map((item) => {
            const kindClass = item.uiAction ? 'ui-action' : item.send ? 'instant' : 'fill';
            const badge = item.uiAction ? 'UI' : item.send ? 'RUN' : '...';
            return (
              `<button type="button" class="side-cmd-chip ${kindClass}" data-cmd-id="${escapeHtml(item.id)}" title="${escapeHtml(item.hint)}">` +
              `<span>${escapeHtml(item.label)}</span>` +
              `<span class="side-cmd-badge">${badge}</span>` +
              `</button>`
            );
          })
          .join('');
      }

      function setSideCmdsVisible(visible) {
        const show = Boolean(visible);
        if (cmdsPanel) cmdsPanel.classList.toggle('hidden', !show);
        if (sideDrawer) sideDrawer.classList.toggle('cmds-open', show);
        if (btnToggleCmds) {
          btnToggleCmds.classList.toggle('active', show);
          btnToggleCmds.setAttribute('aria-expanded', show ? 'true' : 'false');
        }
        try { localStorage.setItem(LS_CMDS_VISIBLE, show ? '1' : '0'); } catch (_) {}
        if (show) renderQuickCommands();
        syncMiniWindowSize();
      }

      async function runUiCommand(actionId) {
        const inp = document.getElementById('side-chat-input');
        const miniTxt = document.getElementById('mini-ai-textarea');
        const msgs = document.getElementById('side-chat-messages');

        switch (actionId) {
          case 'pull-mini': {
            let source = miniTxt ? miniTxt.value.trim() : '';
            if (!source && navigator.clipboard && navigator.clipboard.readText) {
              try { source = (await navigator.clipboard.readText()).trim(); } catch (_) {}
            }
            if (!source) {
              showToast('Mini Assistente e area de transferencia vazios.');
              return;
            }
            if (inp) {
              inp.value = inp.value.trim() ? `${inp.value.trim()} ${source}` : source;
              inp.focus();
            }
            showToast('Texto inserido no chat.');
            break;
          }
          case 'push-mini': {
            const text = lastSideResponse || (() => {
              const items = document.querySelectorAll('#side-chat-messages .side-msg.assistant .side-msg-content');
              const last = items[items.length - 1];
              return last ? (last.dataset.rawText || last.textContent) : '';
            })();
            if (!text) {
              showToast('Nenhuma resposta da I.A para enviar.');
              return;
            }
            if (miniTxt) {
              miniTxt.value = text;
              showToast('Resposta aplicada no Mini Assistente!');
            } else {
              await copyTextSafe(text);
              showToast('Resposta copiada.');
            }
            break;
          }
          case 'paste-review': {
            let clip = '';
            if (navigator.clipboard && navigator.clipboard.readText) {
              try { clip = (await navigator.clipboard.readText()).trim(); } catch (_) {}
            }
            if (inp) {
              inp.value = clip ? `/revisar ${clip}` : '/revisar ';
              inp.focus();
            }
            showToast(clip ? 'Texto colado com /revisar pronto.' : 'Cole seu texto apos /revisar.');
            break;
          }
          case 'copy-last': {
            const items = document.querySelectorAll('#side-chat-messages .side-msg.assistant .side-msg-content');
            const last = items[items.length - 1];
            const text = lastSideResponse || (last ? (last.dataset.rawText || last.textContent) : '');
            const ok = await copyTextSafe((text || '').trim());
            showToast(ok ? 'Ultima resposta copiada!' : 'Nenhuma resposta para copiar.');
            break;
          }
          case 'copy-chat': {
            if (!msgs) return;
            const lines = Array.from(msgs.querySelectorAll('.side-msg')).map((el) => {
              const who = el.classList.contains('user') ? 'VOCE' : 'AI KATAROS';
              const contentEl = el.querySelector('.side-msg-content');
              const txt = contentEl ? (contentEl.dataset.rawText || contentEl.textContent || '').trim() : '';
              return `[${who}]\n${txt}`;
            });
            const ok = await copyTextSafe(lines.join('\n\n'));
            showToast(ok ? 'Conversa inteira copiada!' : 'Nada para copiar.');
            break;
          }
          case 'toggle-readable':
            applyReadablePreference(!sideDrawer.classList.contains('readable-lg'));
            showToast(sideDrawer.classList.contains('readable-lg') ? 'Texto ampliado ativado.' : 'Texto padrao restaurado.');
            break;
          case 'toggle-wide':
            if (document.body.classList.contains('mode-mini-assistant')) {
              showToast('Largura automatica no Mini Assistente.');
              return;
            }
            applyWidePreference(!sideDrawer.classList.contains('wide-mode'));
            showToast(sideDrawer.classList.contains('wide-mode') ? 'Painel expandido.' : 'Largura padrao restaurada.');
            break;
          case 'scroll-top':
            if (msgs) msgs.scrollTo({ top: 0, behavior: 'smooth' });
            break;
        }
      }

      if (btnTextSize) {
        btnTextSize.addEventListener('click', () => {
          applyReadablePreference(!sideDrawer.classList.contains('readable-lg'));
        });
      }
      if (btnWideMode) {
        btnWideMode.addEventListener('click', () => {
          applyWidePreference(!sideDrawer.classList.contains('wide-mode'));
        });
      }
      if (btnToggleCmds) {
        btnToggleCmds.addEventListener('click', () => {
          const isCurrentlyHidden = cmdsPanel ? cmdsPanel.classList.contains('hidden') : true;
          setSideCmdsVisible(isCurrentlyHidden);
        });
      }
      if (btnHideCmds) {
        btnHideCmds.addEventListener('click', () => setSideCmdsVisible(false));
      }
      document.querySelectorAll('.side-cmd-cat').forEach((tab) => {
        tab.addEventListener('click', () => {
          activeCmdCat = tab.dataset.cat || 'all';
          document.querySelectorAll('.side-cmd-cat').forEach((t) => t.classList.toggle('active', t === tab));
          renderQuickCommands();
        });
      });
      let cmdFilterTimer = null;
      if (cmdsFilterInput) {
        cmdsFilterInput.addEventListener('input', () => {
          clearTimeout(cmdFilterTimer);
          cmdFilterTimer = setTimeout(renderQuickCommands, 60);
        });
      }
      if (cmdsGrid) {
        cmdsGrid.addEventListener('click', (e) => {
          const chip = e.target.closest('.side-cmd-chip');
          if (!chip) return;
          const spec = SIDE_QUICK_COMMANDS.find((c) => c.id === chip.dataset.cmdId);
          if (!spec) return;
          if (spec.uiAction) {
            runUiCommand(spec.uiAction);
            return;
          }
          const inp = document.getElementById('side-chat-input');
          if (!inp) return;
          if (spec.send) {
            inp.value = spec.cmd;
            sendSideChatMessage();
            return;
          }
          const cur = inp.value.trim();
          if (cur && !cur.startsWith('/') && !spec.selectFrom) {
            inp.value = `${spec.cmd}${cur}`;
          } else {
            inp.value = spec.cmd;
          }
          inp.focus();
          autoResizeSideInput();
          if (spec.selectFrom) {
            const idx = inp.value.indexOf(spec.selectFrom);
            if (idx >= 0) inp.setSelectionRange(idx, inp.value.length);
          }
        });
      }

      // Restaura preferencias visuais (comandos pre-prontos permanecem ocultos ate o usuario ativar)
      try {
        applyReadablePreference(localStorage.getItem(LS_READABLE_LG) === '1');
        applyWidePreference(localStorage.getItem(LS_WIDE_MODE) === '1');
        setSideCmdsVisible(localStorage.getItem(LS_CMDS_VISIBLE) === '1');
      } catch (_) {
        setSideCmdsVisible(false);
      }

      // Streaming: tokens chegam do processo principal e sao anexados a bolha ativa
      if (window.mpeApi.onAiChatChunk) {
        window.mpeApi.onAiChatChunk(({ requestId, delta }) => {
          if (!activeRequest || activeRequest.id !== requestId) return;
          if (!activeRequest.started) {
            activeRequest.started = true;
            activeRequest.content.textContent = '';
          }
          activeRequest.content.textContent += delta;
          const msgsBox = document.getElementById('side-chat-messages');
          msgsBox.scrollTop = msgsBox.scrollHeight;
        });
      }
      if (window.mpeApi.onAiChatStatus) {
        window.mpeApi.onAiChatStatus(({ requestId, status }) => {
          if (!activeRequest || activeRequest.id !== requestId || activeRequest.started) return;
          if (status) activeRequest.content.textContent = status;
        });
      }

      const statusEl = document.getElementById('side-ai-status');
      const STATUS_LABEL = {
        online: 'Motor online',
        external: 'Servidor local conectado',
        starting: 'Carregando modelo...',
        offline: 'Motor desligado',
        error: 'Erro no motor'
      };
      function mascotIdleFromStatus(s) {
        if (!katarosMascot || !katarosMascot.setIdleText || !s) return;
        if (s.error || s.engine === 'error' || s.modelFound === false) katarosMascot.setIdleText('MODELO PARADO');
        else if (s.engine === 'starting') katarosMascot.setIdleText('CARREGANDO');
        else katarosMascot.setIdleText('PRONTO');
      }
      refreshMascotIdleRef = async () => {
        if (!window.mpeApi.aiStatus) return;
        try {
          mascotIdleFromStatus(await window.mpeApi.aiStatus({ warmUp: false }));
        } catch (_) {}
      };

      async function refreshAiStatus(warmUp) {
        if (!statusEl || !window.mpeApi.aiStatus) return;
        try {
          const s = await window.mpeApi.aiStatus({ warmUp });
          mascotIdleFromStatus(s);
          let label = STATUS_LABEL[s.engine] || s.engine;
          if (s.provider !== 'auto' && s.provider !== 'llamafile') label = `${s.provider} (${s.engine})`;
          if (!s.modelFound && !s.ready && s.engine === 'offline') label = 'Sem modelo em models/ - envie /status';
          if (s.modelName && (s.engine === 'online' || s.engine === 'starting')) label += ` | ${s.modelName.replace(/\.llamafile(\.exe)?$/i, '')}`;
          statusEl.textContent = `${label} | ${s.facts} fatos | ${s.examples} exemplos | ${s.documents || 0} docs`;
          statusEl.className = `side-ai-status ${s.ready ? 'online' : s.engine === 'starting' ? 'starting' : 'offline'}`;
        } catch (_) {
          statusEl.textContent = 'Motor indisponivel';
        }
      }

      let statusTimer = null;
      const drawerObserver = new MutationObserver(() => {
        const open = !sideDrawer.classList.contains('hidden');
        if (open && !statusTimer) {
          refreshAiStatus(true);
          statusTimer = setInterval(() => refreshAiStatus(false), 3000);
          setTimeout(() => document.getElementById('side-chat-input').focus(), 50);
        } else if (!open && statusTimer) {
          clearInterval(statusTimer);
          statusTimer = null;
        }
      });
      drawerObserver.observe(sideDrawer, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(() => updateSizeUi()).observe(sideDrawer, { attributes: true, attributeFilter: ['class'] });

      sendSideChatMessageRef = () => sendSideChatMessage();
      // =====================================================================
      // RESPOSTAS COM GRAFICO, TELA INICIAL, RELATORIO DO EXTRATO E CONVERSAS
      // Grafico so quando o documento tem numeros; todo grafico diz de qual arquivo veio.
      // =====================================================================
      const KN_ROUTE_COLOR = { ia: 'var(--kn-ask)', local: 'var(--kn-find)', nota: 'var(--kn-keep)' };
      let knDocsCache = { at: 0, docs: [] };
      let knHistoryItems = [];

      async function knLoadDocs(force) {
        if (!window.mpeApi.listDocuments) return [];
        if (!force && Date.now() - knDocsCache.at < 15000) return knDocsCache.docs;
        try {
          const res = await window.mpeApi.listDocuments({});
          const docs = res && Array.isArray(res.documents) ? res.documents : [];
          knDocsCache = { at: Date.now(), docs };
          return docs;
        } catch (_) {
          return knDocsCache.docs;
        }
      }

      function knChartsOn() {
        const ui = (currentConfig && currentConfig.ui) || {};
        return ui.showCharts !== false;
      }

      async function knAttachInsight(astDiv, prompt, res, route) {
        if (!knChartsOn() || !window.KnInsights || !window.KnInsightsView) return;
        if (!res || !res.ok) return;
        const realRoute = res.route || route;
        const docs = await knLoadDocs(true);
        const msgsEl = document.getElementById('side-chat-messages');
        const scrollEnd = () => {
          if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
        };
        const spec = window.KnInsights.detectIntent(prompt) ? window.KnInsights.buildInsight(prompt, docs, { route: realRoute }) : null;
        if (spec) {
          const card = window.KnInsightsView.renderInsightCard(spec, { onOpenReport: knOpenReport });
          if (card) astDiv.appendChild(card);
        }
        // Outros jeitos de ver: oferecidos como pergunta, o grafico so aparece se escolher
        const options = window.KnInsights.viewOptions(prompt, docs, { route: realRoute, shown: spec && spec.kind });
        const ask = window.KnInsightsView.renderViewAsk(options, (id) => {
          const view = window.KnInsights.buildView(id, knDocsCache.docs);
          if (!view) return;
          const card = window.KnInsightsView.renderInsightCard(view, { onOpenReport: knOpenReport });
          if (!card) return;
          if (ask && ask.isConnected) astDiv.insertBefore(card, ask);
          else astDiv.appendChild(card);
          scrollEnd();
        });
        if (ask) astDiv.appendChild(ask);
        scrollEnd();
      }

      async function knOpenReport(docId) {
        const docs = await knLoadDocs(false);
        const doc = docs.find((d) => d.id === docId) || window.KnInsights.pickFinancialDoc(docs);
        const rep = window.KnInsights.buildReport(doc);
        if (!rep) {
          showToast('Não achei lançamentos neste documento.');
          return;
        }
        document.getElementById('kn-report-title').textContent = rep.title;
        document.getElementById('kn-report-sub').textContent = `De: ${rep.source}${rep.accountInfo ? ` | ${rep.accountInfo}` : ''}`;
        document.getElementById('kn-report-body').replaceChildren(window.KnInsightsView.renderReport(rep));
        document.getElementById('modal-report').classList.remove('hidden');
        syncMiniWindowSize();
        document.getElementById('btn-report-close').focus();
      }

      function knCloseModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.add('hidden');
        syncMiniWindowSize();
      }

      function knGreeting() {
        const h = new Date().getHours();
        return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
      }

      function knDayLabel(day) {
        const pad = (n) => String(n).padStart(2, '0');
        const d = new Date();
        const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        d.setDate(d.getDate() - 1);
        const yday = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (day === today) return 'Hoje';
        if (day === yday) return 'Ontem';
        const m = String(day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}` : String(day);
      }

      function knUsePrompt(text, route) {
        if (!sideInputEl) return;
        sideInputEl.value = text;
        if (route) setRoute(route);
        autoResizeSideInput();
        renderRoute();
        sideInputEl.focus();
      }

      async function knRenderHome() {
        const msgsEl = document.getElementById('side-chat-messages');
        if (!msgsEl || !window.KnInsights || !window.KnInsightsView) return;
        if (msgsEl.querySelector('.side-msg.user')) return;
        const V = window.KnInsightsView;
        const el = V.el;
        const docs = await knLoadDocs(true);
        let recent = [];
        try {
          recent = window.mpeApi.historyList ? await window.mpeApi.historyList({ maxDays: 7, maxItems: 20 }) : [];
        } catch (_) {}
        if (msgsEl.querySelector('.side-msg.user')) return;
        const old = msgsEl.querySelector('.kn-home');
        if (old) old.remove();
        const sum = window.KnInsights.homeSummary(docs);

        const home = el('section', 'kn-home');
        home.setAttribute('aria-label', 'Início');
        const hello = el('div', 'kn-home-hello');
        hello.appendChild(el('strong', '', knGreeting()));
        hello.appendChild(el('span', '', new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })));
        home.appendChild(hello);

        // A - Pergunta primeiro: sugestoes conforme o que ja foi guardado
        const cats = new Set(docs.map((d) => window.KnInsights.norm(d.category)));
        const sugg = [];
        if (cats.has('extratos')) sugg.push(['Qual meu saldo?', 'qual meu saldo?']);
        if (cats.has('contratos')) sugg.push(['O que diz o contrato?', '/pdf contrato ']);
        if (cats.has('curriculos')) sugg.push(['Resumo do currículo', '/curriculo resumo das minhas experiencias']);
        if (cats.has('codigos')) sugg.push(['Explicar um código', '/codigo explicar ']);
        if (docs.length) sugg.push(['Quantos documentos tenho?', 'quantos documentos eu tenho?']);
        if (sugg.length) {
          const box = el('div', 'kn-home-sugg');
          box.appendChild(el('span', 'kn-card-lbl', 'Pergunte'));
          const row = el('div', 'kn-ask-row');
          sugg.slice(0, 4).forEach(([label, prompt]) => {
            const b = el('button', 'kn-chip-btn', label);
            b.type = 'button';
            b.addEventListener('click', () => knUsePrompt(prompt, 'ia'));
            row.appendChild(b);
          });
          box.appendChild(row);
          home.appendChild(box);
        }

        const grid = el('div', 'kn-home-grid');
        // B - Mural de pastas: quantos documentos em cada tipo + Trazer arquivo
        const c1 = el('div', 'kn-home-card');
        c1.appendChild(el('span', 'kn-card-lbl', `Guardados · ${sum.total}`));
        if (sum.byType.length) {
          const mural = el('div', 'kn-mural');
          sum.byType.forEach((t) => {
            const tile = el('div', 'kn-mural-tile');
            tile.appendChild(el('span', 'kn-big-lbl', t.label));
            tile.appendChild(el('span', 'kn-mural-n', String(t.value)));
            mural.appendChild(tile);
          });
          c1.appendChild(mural);
        } else {
          c1.appendChild(el('span', 'kn-big-lbl', 'Nada guardado ainda'));
        }
        const bring = el('button', 'kn-btn-outline', 'Trazer arquivo');
        bring.type = 'button';
        bring.addEventListener('click', () => openSaveAiFileModal({}));
        c1.appendChild(bring);
        grid.appendChild(c1);

        const c2 = el('div', 'kn-home-card');
        c2.appendChild(el('span', 'kn-card-lbl', 'Último guardado'));
        c2.appendChild(el('span', '', sum.last ? sum.last.title : 'Nenhum ainda'));
        c2.appendChild(el('span', 'kn-big-lbl', sum.last ? sum.last.category : 'Use Guardar ou Trazer arquivo'));
        grid.appendChild(c2);

        if (sum.saldo && knChartsOn()) {
          const c3 = el('div', 'kn-home-card');
          c3.appendChild(el('span', 'kn-card-lbl', 'Extrato mais recente'));
          c3.appendChild(el('span', 'kn-big', sum.saldo.big));
          c3.appendChild(V.sparkline(sum.saldo.points));
          c3.appendChild(el('span', 'kn-big-lbl', `De: ${sum.saldo.source}`));
          grid.appendChild(c3);
        }
        home.appendChild(grid);

        // C - Resumo do dia (ou, se hoje esta vazio, continuar de onde parou)
        const pad2 = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
        const list0 = Array.isArray(recent) ? recent : [];
        const today = list0.filter((r) => r.day === todayKey).slice(0, 5);
        const VERB = { ia: 'Perguntou', local: 'Procurou', nota: 'Guardou' };
        const rows = today.length ? today : list0.slice(0, 3);
        if (rows.length) {
          const box = el('div', 'kn-home-card');
          box.appendChild(el('span', 'kn-card-lbl', today.length ? 'Hoje' : 'Continuar de onde parou'));
          const list = el('div', 'kn-home-list');
          rows.forEach((r) => {
            const b = el('button', 'kn-home-item');
            b.type = 'button';
            const dot = el('span', 'kn-dot');
            dot.style.background = KN_ROUTE_COLOR[r.route] || KN_ROUTE_COLOR.ia;
            b.appendChild(dot);
            if (today.length) b.appendChild(el('span', 'kn-big-lbl kn-home-time', r.time));
            b.appendChild(el('span', 'kn-home-txt', today.length ? `${VERB[r.route] || 'Perguntou'}: ${r.text}` : r.text));
            if (!today.length) b.appendChild(el('span', 'kn-big-lbl', knDayLabel(r.day)));
            b.addEventListener('click', () => knUsePrompt(r.text, r.route));
            list.appendChild(b);
          });
          box.appendChild(list);
          home.appendChild(box);
        }

        const tips = [
          'Comece com @nota para guardar sem passar pela I.A.',
          'Use /curriculo para perguntar sobre o seu currículo.',
          'Use /pdf e um tema para perguntar sobre um PDF guardado.',
          'Use /codigo para pedir, explicar ou revisar um trecho de código.',
          'Depois de trazer um extrato, pergunte "qual meu saldo?".',
          'Use /modelo salvar para guardar um texto que você repete sempre.'
        ];
        const tip = el('div', 'kn-home-card kn-home-tip');
        tip.appendChild(el('span', 'kn-card-lbl', 'Dica'));
        tip.appendChild(el('span', '', tips[Math.floor(Math.random() * tips.length)]));
        home.appendChild(tip);

        msgsEl.insertBefore(home, msgsEl.firstChild);
      }

      let knHistRoute = 'all';

      // Texto com o termo da busca destacado (sem innerHTML)
      function knHighlight(text, q) {
        const el = window.KnInsightsView.el;
        const span = el('span', '');
        const raw = String(text || '');
        if (!q) {
          span.textContent = raw;
          return span;
        }
        const normRaw = window.KnInsights.norm(raw);
        let pos = 0;
        let idx = normRaw.indexOf(q, pos);
        while (idx !== -1) {
          span.appendChild(document.createTextNode(raw.slice(pos, idx)));
          span.appendChild(el('mark', 'kn-mark', raw.slice(idx, idx + q.length)));
          pos = idx + q.length;
          idx = normRaw.indexOf(q, pos);
        }
        span.appendChild(document.createTextNode(raw.slice(pos)));
        return span;
      }

      // Trecho da resposta perto do termo buscado
      function knSnippet(answer, q) {
        const raw = String(answer || '');
        if (!q) return raw.slice(0, 140) + (raw.length > 140 ? '…' : '');
        const i = window.KnInsights.norm(raw).indexOf(q);
        if (i === -1) return raw.slice(0, 140) + (raw.length > 140 ? '…' : '');
        const from = Math.max(0, i - 50);
        return (from ? '…' : '') + raw.slice(from, from + 150) + (from + 150 < raw.length ? '…' : '');
      }

      // Documento citado na pergunta ou na resposta (pelo nome do arquivo guardado)
      function knDocOf(item) {
        const hay = window.KnInsights.norm(`${item.text} ${item.answer || ''}`);
        for (const d of knDocsCache.docs || []) {
          const names = [d.fileName, d.title].filter(Boolean).map((n) => window.KnInsights.norm(n).replace(/\.[a-z0-9]+$/, ''));
          if (names.some((n) => n.length >= 4 && hay.includes(n))) return d.fileName || d.title;
        }
        return '';
      }

      function knHistCard(i, q) {
        const el = window.KnInsightsView.el;
        const card = el('div', 'kn-hist-card');
        const dot = el('span', 'kn-dot');
        dot.style.background = KN_ROUTE_COLOR[i.route] || KN_ROUTE_COLOR.ia;
        card.appendChild(dot);
        const txt = el('div', 'kn-hist-txt');
        const title = el('span', 'kn-hist-title');
        title.appendChild(knHighlight(i.text, q));
        txt.appendChild(title);
        if (i.answer) {
          const ans = el('span', 'kn-hist-ans');
          ans.appendChild(document.createTextNode('Resposta: '));
          ans.appendChild(knHighlight(knSnippet(i.answer, q), q));
          txt.appendChild(ans);
        }
        txt.appendChild(el('span', 'kn-hist-meta', `${(ROUTE_UI[i.route] || ROUTE_UI.ia).tag} | ${knDayLabel(i.day)}, ${i.time}`));
        card.appendChild(txt);
        if (window.KnInsights.detectIntent(i.text)) card.appendChild(el('span', 'kn-hist-meta', 'com gráfico'));
        const b = el('button', 'kn-btn-outline', 'Abrir');
        b.type = 'button';
        b.addEventListener('click', () => {
          knCloseModal('modal-history');
          knUsePrompt(i.text, i.route);
        });
        card.appendChild(b);
        return card;
      }

      function knRenderHistory(filter) {
        const list = document.getElementById('kn-history-list');
        if (!list || !window.KnInsightsView) return;
        const el = window.KnInsightsView.el;
        const q = window.KnInsights.norm(filter || '').trim();
        const byDoc = Boolean(document.getElementById('kn-history-bydoc') && document.getElementById('kn-history-bydoc').checked);
        const items = knHistoryItems.filter(
          (i) => (knHistRoute === 'all' || i.route === knHistRoute) && (!q || window.KnInsights.norm(`${i.text} ${i.answer || ''}`).includes(q))
        );
        list.replaceChildren();
        if (!items.length) {
          list.appendChild(el('p', 'kn-muted', q ? 'Nada encontrado.' : 'Nenhuma conversa ainda.'));
          return;
        }
        if (byDoc) {
          const groups = new Map();
          items.forEach((i) => {
            const k = knDocOf(i) || '';
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(i);
          });
          const keys = Array.from(groups.keys()).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : groups.get(b).length - groups.get(a).length));
          keys.forEach((k) => {
            const n = groups.get(k).length;
            list.appendChild(el('div', 'kn-hist-day', k ? `${k} · ${n} ${n === 1 ? 'conversa' : 'conversas'}` : 'Sem documento citado'));
            groups.get(k).forEach((i) => list.appendChild(knHistCard(i, q)));
          });
          return;
        }
        let lastDay = '';
        items.forEach((i) => {
          if (i.day !== lastDay) {
            lastDay = i.day;
            list.appendChild(el('div', 'kn-hist-day', knDayLabel(i.day)));
          }
          list.appendChild(knHistCard(i, q));
        });
      }

      document.querySelectorAll('[data-hist-route]').forEach((b) => {
        b.addEventListener('click', () => {
          knHistRoute = b.dataset.histRoute;
          document.querySelectorAll('[data-hist-route]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
          const f = document.getElementById('kn-history-filter');
          knRenderHistory(f ? f.value : '');
        });
      });
      const knByDoc = document.getElementById('kn-history-bydoc');
      if (knByDoc) {
        knByDoc.addEventListener('change', () => {
          const f = document.getElementById('kn-history-filter');
          knRenderHistory(f ? f.value : '');
        });
      }

      async function knOpenHistory() {
        try {
          knHistoryItems = window.mpeApi.historyList ? await window.mpeApi.historyList({ maxDays: 14, maxItems: 60 }) : [];
        } catch (_) {
          knHistoryItems = [];
        }
        await knLoadDocs(false);
        const f = document.getElementById('kn-history-filter');
        if (f) f.value = '';
        knRenderHistory('');
        document.getElementById('modal-history').classList.remove('hidden');
        syncMiniWindowSize();
        if (f) f.focus();
      }

      const knBtnHistory = document.getElementById('btn-side-chat-history');
      if (knBtnHistory) knBtnHistory.addEventListener('click', () => knOpenHistory());
      const knHistFilter = document.getElementById('kn-history-filter');
      if (knHistFilter) knHistFilter.addEventListener('input', () => knRenderHistory(knHistFilter.value));
      const knBtnHistClose = document.getElementById('btn-history-close');
      if (knBtnHistClose) knBtnHistClose.addEventListener('click', () => knCloseModal('modal-history'));
      const knBtnRepClose = document.getElementById('btn-report-close');
      if (knBtnRepClose) knBtnRepClose.addEventListener('click', () => knCloseModal('modal-report'));
      const knBtnRepAsk = document.getElementById('btn-report-ask');
      if (knBtnRepAsk) {
        knBtnRepAsk.addEventListener('click', () => {
          knCloseModal('modal-report');
          knUsePrompt('/extrato ', 'ia');
        });
      }
      knRenderHome().catch(() => {});

      async function sendSideChatMessage() {
        const input = document.getElementById('side-chat-input');
        const prompt = input.value.trim();
        if (!prompt || chatBusy) return;

        if (sentPromptHistory[sentPromptHistory.length - 1] !== prompt) {
          sentPromptHistory.push(prompt);
          if (sentPromptHistory.length > 40) sentPromptHistory.shift();
        }
        historyCursor = -1;
        historyDraft = '';

        const sentRoute = detectRouteFromText(prompt) || currentRoute;
        input.value = '';
        autoResizeSideInput();
        renderRoute();
        chatBusy = true;
        document.body.classList.add('kn-busy');
        const sendBtn = document.getElementById('btn-side-chat-send');
        sendBtn.disabled = true;
        const msgs = document.getElementById('side-chat-messages');
        const knHomeEl = msgs.querySelector('.kn-home');
        if (knHomeEl) knHomeEl.remove();

        const userDiv = document.createElement('div');
        userDiv.className = 'side-msg user';
        userDiv.innerHTML = `
          <div class="side-msg-header">
            <button type="button" class="side-msg-reuse-btn" title="Colocar mensagem de volta na caixa">Reusar</button>
            <span class="side-msg-author">VOCE</span>
            <span class="side-msg-route route-${sentRoute}">${ROUTE_UI[sentRoute].tag}</span>
            <span class="side-msg-time">Agora</span>
          </div>
          <div class="side-msg-content">${escapeHtml(prompt)}</div>
        `;
        userDiv.querySelector('.side-msg-content').dataset.rawText = prompt;
        msgs.appendChild(userDiv);

        const astDiv = document.createElement('div');
        astDiv.className = 'side-msg assistant';
        astDiv.innerHTML = `
          <div class="side-msg-header">
            <span class="side-msg-author">AI KATAROS</span>
            <span class="side-msg-time">Processando...</span>
            <button type="button" class="side-msg-copy-btn" title="Copiar resposta">Copiar</button>
          </div>
          <div class="side-msg-content">Processando...</div>
        `;
        msgs.appendChild(astDiv);
        msgs.scrollTop = msgs.scrollHeight;

        const mode = document.getElementById('side-ai-mode').value;
        const tone = document.getElementById('side-ai-tone').value;
        const requestId = `r${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
        const contentEl = astDiv.querySelector('.side-msg-content');
        activeRequest = { id: requestId, content: contentEl, started: false };

        try {
          const runChat = () => window.mpeApi.aiChat({ message: prompt, mode, tone, route: currentRoute, requestId });
          const res = katarosMascot
            ? await katarosMascot.runWithProcessing(runChat, { minDurationMs: 1500, subText: 'CHAT' })
            : await runChat();
          const finalText = (res && res.text) || 'Sem resposta.';
          if (res && ROUTE_UI[res.route] && res.route !== sentRoute) {
            const tagEl = userDiv.querySelector('.side-msg-route');
            if (tagEl) {
              tagEl.textContent = ROUTE_UI[res.route].tag;
              setRouteClass(tagEl, res.route);
            }
          }
          contentEl.dataset.rawText = finalText;
          contentEl.innerHTML = formatSideMessageHtml(finalText);
          knAttachInsight(astDiv, prompt, res, sentRoute).catch(() => {});
          if (res && (res.source === 'llm' || res.source === 'builtin')) lastSideResponse = finalText;
          astDiv.querySelector('.side-msg-time').textContent =
            res && res.source === 'llm'
              ? 'Modelo local'
              : res && res.route === 'local'
              ? 'Busca nos arquivos'
              : res && res.route === 'nota' && res.source === 'route'
              ? 'Anotação'
              : res && res.source === 'command'
              ? 'Comando'
              : 'AI Kataros';
          if (!res || !res.ok) astDiv.classList.add('error');

          if (res && res.action) {
            if (res.action.type === 'set-tone' && res.action.tone) {
              const toneSel = document.getElementById('side-ai-tone');
              if (toneSel) toneSel.value = res.action.tone;
            } else if (res.action.type === 'set-preset' && res.action.preset) {
              const presetSel = document.getElementById('side-ai-preset');
              if (presetSel) presetSel.value = res.action.preset;
            }
          }
        } catch (err) {
          contentEl.textContent = 'Erro de conexao com o motor de I.A local.';
          astDiv.classList.add('error');
        }
        activeRequest = null;
        chatBusy = false;
        document.body.classList.remove('kn-busy');
        if (document.body.classList.contains('mode-bubble')) {
          const plain = (contentEl.textContent || '').replace(/\s+/g, ' ').trim();
          knBubbleSayRef(plain.length > 150 ? `${plain.slice(0, 150)}…` : plain || 'Pronto.', 'answer');
        }
        sendBtn.disabled = false;
        msgs.scrollTop = msgs.scrollHeight;
        updateScrollBottomVisibility();
        refreshAiStatus(false);
        input.focus();
      }

      const sidePresetSelect = document.getElementById('side-ai-preset');
      if (sidePresetSelect) {
        sidePresetSelect.addEventListener('change', async () => {
          const val = sidePresetSelect.value;
          try {
            const res = await window.mpeApi.aiChat({ message: `/param perfil ${val}` });
            if (res && res.text) showToast(res.text.split('\n')[0]);
          } catch (_) {}
        });
      }

      document.getElementById('btn-side-chat-send').addEventListener('click', sendSideChatMessage);
      if (sideInputEl) {
        sideInputEl.addEventListener('input', () => {
          autoResizeSideInput();
          renderRoute();
        });
        sideInputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendSideChatMessage();
            return;
          }
          if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
            const pos = sideInputEl.selectionStart || 0;
            const before = sideInputEl.value.slice(0, pos);
            if (!before.includes('\n') && sentPromptHistory.length > 0) {
              e.preventDefault();
              if (historyCursor === -1) {
                historyDraft = sideInputEl.value;
                historyCursor = sentPromptHistory.length - 1;
              } else if (historyCursor > 0) {
                historyCursor--;
              }
              sideInputEl.value = sentPromptHistory[historyCursor] || '';
              autoResizeSideInput();
              const endPos = sideInputEl.value.length;
              sideInputEl.setSelectionRange(endPos, endPos);
            }
          } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && !e.altKey && historyCursor !== -1) {
            const pos = sideInputEl.selectionEnd || 0;
            const after = sideInputEl.value.slice(pos);
            if (!after.includes('\n')) {
              e.preventDefault();
              if (historyCursor < sentPromptHistory.length - 1) {
                historyCursor++;
                sideInputEl.value = sentPromptHistory[historyCursor] || '';
              } else {
                historyCursor = -1;
                sideInputEl.value = historyDraft;
              }
              autoResizeSideInput();
              const endPos = sideInputEl.value.length;
              sideInputEl.setSelectionRange(endPos, endPos);
            }
          }
        });
      }

      if (cmdsFilterInput) {
        cmdsFilterInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && cmdsFilterInput.value) {
            e.stopPropagation();
            cmdsFilterInput.value = '';
            renderQuickCommands();
          }
        });
      }

      sideDrawer.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
          e.preventDefault();
          const show = cmdsPanel ? cmdsPanel.classList.contains('hidden') : true;
          setSideCmdsVisible(show);
          if (show && cmdsFilterInput) {
            setTimeout(() => cmdsFilterInput.focus(), 20);
          } else if (!show && sideInputEl) {
            sideInputEl.focus();
          }
        }
      });

      const btnSideChatSaveFile = document.getElementById('btn-side-chat-save-file');
      if (btnSideChatSaveFile) {
        btnSideChatSaveFile.addEventListener('click', () => {
          const draft = document.getElementById('side-chat-input').value.trim();
          const content = lastSideResponse || draft || document.getElementById('mini-ai-textarea').value.trim();
          openSaveAiFileModal({
            title: content ? '' : 'Documento_IA',
            category: 'Auto',
            text: content
          });
        });
      }

      document.getElementById('btn-side-chat-to-obsidian').addEventListener('click', async () => {
        if (!lastSideResponse) {
          showToast('Nenhuma resposta recente para salvar no Obsidian.');
          return;
        }
        showToast('Catalogando nota no Obsidian...');
        const res = await window.mpeApi.saveToObsidian({
          title: 'Conversa MPE AI',
          text: lastSideResponse,
          folder: 'Notas/IA'
        });
        if (res && res.ok) {
          showToast(`Salvo no Obsidian: ${res.fileName}`);
        } else {
          showToast('Erro ao salvar resposta no Obsidian.');
        }
      });

      function escapeHtml(str) {
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }
    }

    setupMiniAssistant();
    applyUiPrefs(currentConfig);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleEscapeKey();
      }
    });

    if (window.mpeApi.onEscapePressed) {
      window.mpeApi.onEscapePressed(() => {
        handleEscapeKey();
      });
    }

    if (window.mpeApi.onMiniAssistantSummoned) {
      window.mpeApi.onMiniAssistantSummoned((payload) => {
        document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach((m) => m.classList.add('hidden'));
        document.body.classList.remove('mode-bubble', 'bubble-left');
        document.body.classList.add('mode-mini-assistant');
        const miniOverlay = document.getElementById('mini-assistant-overlay');
        if (miniOverlay) miniOverlay.classList.remove('hidden');
        const miniDrawer = document.getElementById('side-chat-drawer');
        if (miniDrawer) {
          miniDrawer.classList.toggle('hidden', !(payload && payload.openChat));
        }
        if (katarosMascot) {
          katarosMascot.setProcessing(false);
          katarosMascot.resume();
        }
        refreshMascotIdleRef();
        if (payload && payload.windowMode === 'barra') {
          applyWindowModeRef('barra', payload.side);
        } else {
          applyWindowModeRef(payload && payload.openChat ? 'grande' : 'simples');
        }
        if (payload && payload.openSettings) {
          openSettingsModal();
        }
        requestAnimationFrame(() => syncMiniWindowSize());

        const txtArea = (payload && payload.openChat)
          ? document.getElementById('side-chat-input')
          : document.getElementById('mini-ai-textarea');
        if (txtArea) {
          txtArea.focus();
        }

        if (payload && payload.config) {
          currentConfig = payload.config;
          applyUiPrefs(currentConfig);
          const folderEl = document.getElementById('mini-note-folder');
          if (folderEl && currentConfig.obsidian && currentConfig.obsidian.defaultFolder) {
            folderEl.value = currentConfig.obsidian.defaultFolder;
          }
          const sideToneEl = document.getElementById('side-ai-tone');
          const cfgTone = currentConfig.profile && currentConfig.profile.languageTone;
          if (sideToneEl && cfgTone && Array.from(sideToneEl.options).some((o) => o.value === cfgTone)) {
            sideToneEl.value = cfgTone;
          }
        }
      });
    }

    if (katarosMascot) {
      katarosMascot.setProcessing(false);
      katarosMascot.resume();
    }
    requestAnimationFrame(() => syncMiniWindowSize());
  }

  window.addEventListener('DOMContentLoaded', init);
})();
