const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const { shell } = require('electron');

const AiMemory = require('./aiMemory');
const ObsidianIndex = require('./obsidianIndex');
const LlamafileManager = require('./llamafileManager');
const AiDocuments = require('./aiDocuments');
const { resolveRoute, normalizeRoute } = require('./routeResolver');
const ChatHistoryStore = require('./chatHistoryStore');

/**
 * Servico de I.A Local, Contexto Raiz e Integracao com Obsidian (Katharos Nous | katharos AI)
 * - Motor LLM local via Mozilla llamafile (servidor OpenAI-compativel, offline)
 * - Suporte opcional a Ollama / LM Studio (mesmo formato /v1/chat/completions)
 * - Contexto permanente lido automaticamente de CONTEXTO_IA.md na raiz
 * - Memoria persistente (fatos, exemplos de treinamento, modelos automatizados, parametros, historico)
 * - Documentos organizados em ./arquivos com busca rapida, PDFs, extratos, curriculos e codigos
 * - Contexto alimentado pelas notas do cofre do Obsidian
 * - Motor embutido de regras gramaticais como fallback (~2ms)
 */
const HELP_TEXT = [
  'COMANDOS DE TEXTO, EDICAO E MODELOS',
  '/revisar [texto|doc]    Revisa gramatica e clareza (aceita /revise, /corrigir ou referencia a doc)',
  '/resumir [texto|doc]    Resume texto, PDF, nota ou documento salvo',
  '/explicar [tema|doc]    Explica um termo, PDF, codigo ou documento passo a passo',
  '/traduzir [idioma] txt  Traduz texto (ex: /traduzir ingles Ola mundo)',
  '/editar [ajuste|doc]    Edita a ultima resposta, documento ou modelo no chat (alias /adaptar)',
  '/codigo <pedido|doc>    Redige, explica ou revisa codigo usando memoria e Obsidian',
  '/redigir <pedido>       Redige um texto ou documento completo',
  '/organizar <texto>      Estrutura e organiza texto/notas para o Obsidian',
  '/modelo listar          Lista modelos de textos salvos e automatizados no chat',
  '/modelo salvar <n>::<t> Salva texto padrao (ou omite ::<t> para guardar a ultima resposta)',
  '/modelo usar <n> [aj]   Aplica um modelo salvo no chat (com ajuste opcional)',
  '/modelo remover <id>    Remove um modelo (numero, nome ou "tudo")',
  '',
  'BUSCA ULTRA-RAPIDA, PDFs, EXTRATOS, CURRICULO E OBSIDIAN',
  '/rapido <termo>         Busca ultra-rapida (<5ms) em Docs, PDFs, Obsidian, Memoria e Modelos',
  '/buscar <termo>         Busca unificada detalhada em Documentos, Obsidian e Memoria',
  '/pdf [termo|pergunta]   Lista PDFs salvos ou consulta conteudo de PDFs indexados',
  '/curriculo [pergunta]   Consulta dados de curriculos salvos, memoria e CONTEXTO_IA.md',
  '/extrato [termo]        Consulta extratos e movimentacoes',
  '/saldo [termo]          Exibe saldos detectados nos arquivos',
  '/recibo [termo]         Busca recibos e comprovantes',
  '/arquivos [termo]       Lista ou busca arquivos salvos na I.A Local',
  '/historico [termo]      Lista os ultimos dias de conversa ou busca no historico local',
  '/obsidian [termo]       Lista notas ou busca no cofre do Obsidian',
  '/salvar [titulo]        Salva a ultima resposta no Obsidian',
  '/salvar-arquivo [nome]  Salva a ultima resposta nos documentos da I.A',
  '',
  'MEMORIA E TREINO',
  '/lembrar <fato>         Guarda um fato permanente',
  '/memoria                Lista fatos guardados',
  '/esquecer <n|tudo>      Remove fato',
  '/treinar <p> => <r>     Ensina um exemplo de pergunta e resposta',
  '/exemplos               Lista exemplos de treino',
  '/desaprender <n|tudo>   Remove exemplo',
  '/limpar                 Limpa o historico da conversa',
  '',
  'PARAMETROS E ESTILO DE RESPOSTA',
  '/param                  Lista parametros ativos e atalhos',
  '/param <nome> <valor>   Ajusta temperatura, top_p, repeat_penalty, presence_penalty, tokens, historico, detalhe, persona, linguagem, obsidian, documentos',
  '/param perfil <nome>    Aplica perfil pronto (equilibrado, preciso, direto, criativo, detalhado)',
  '/param reset            Restaura padroes',
  '/perfil [nome]          Atalho para trocar o perfil de resposta',
  '/tom [valor]            Define tom (amigavel, neutra, profissional, conciso, didatico)',
  '/persona <texto>        Define instrucao fixa de comportamento',
  '/vault <caminho>        Define a pasta do cofre do Obsidian',
  '',
  'MOTOR & PERFORMANCE',
  '/status [termo]         Estado do motor, memoria e busca opcional por termo',
  '/boost [turbo|eco|balanced|status]  Otimiza RAM/velocidade e exibe kits minimos',
  '/kits                   Exibe calculo de memoria, velocidade e kits minimos',
  '/iniciar   /parar       Inicia ou encerra o servidor llamafile'
].join('\n');

const COMMAND_SPECS = [
  { name: 'ajuda', aliases: ['help', 'comandos', 'comando', '?', 'menu'] },
  { name: 'status', aliases: ['estado', 'info', 'saude'] },
  { name: 'boost', aliases: ['desempenho', 'ram', 'velocidade', 'turbo', 'eco', 'balanceado', 'balanced'] },
  { name: 'kits', aliases: ['kit', 'hardware', 'requisitos', 'pc'] },
  { name: 'iniciar', aliases: ['start', 'ligar', 'conectar', 'acordar'] },
  { name: 'parar', aliases: ['stop', 'desligar', 'encerrar'], destructive: true },
  { name: 'revisar', aliases: ['revise', 'revisao', 'corrigir', 'corrija', 'correcao', 'review'] },
  { name: 'resumir', aliases: ['resuma', 'resumo', 'sintetizar', 'sintese', 'sumario', 'summary'] },
  { name: 'explicar', aliases: ['explique', 'explicacao', 'detalhar', 'oquee'] },
  { name: 'traduzir', aliases: ['traduz', 'traduza', 'translate'] },
  { name: 'adaptar', aliases: ['adapte', 'melhorar', 'melhore', 'reescrever', 'reescreva', 'ajustar', 'editar', 'edite', 'modificar'] },
  { name: 'codigo', aliases: ['code', 'programar', 'programe', 'script', 'funcao'] },
  { name: 'redigir', aliases: ['redija', 'escrever', 'escreva', 'draft', 'texto', 'email', 'receita'] },
  { name: 'organizar', aliases: ['organiza', 'organizador', 'classificar'] },
  { name: 'rapido', aliases: ['fast', 'acha', 'achar', 'localizar', 'doc', 'docs-rapido'] },
  { name: 'historico', aliases: ['historia', 'conversas', 'history'] },
  { name: 'buscar', aliases: ['busca', 'pesquisar', 'procurar', 'encontrar', 'search', 'find'] },
  { name: 'pdf', aliases: ['pdfs'] },
  { name: 'curriculo', aliases: ['curriculos', 'cv', 'resume', 'perfil-profissional'] },
  { name: 'modelo', aliases: ['modelos', 'template', 'templates', 'automacao', 'automatizar', 'texto-pronto'] },
  { name: 'obsidian', aliases: ['nota', 'notas', 'cofre'] },
  { name: 'salvar', aliases: ['save', 'guardar', 'salvar-obsidian'] },
  { name: 'arquivos', aliases: ['arquivo', 'documentos', 'documento', 'docs', 'listar'] },
  { name: 'extrato', aliases: ['extratos'] },
  { name: 'saldo', aliases: ['saldos'] },
  { name: 'recibo', aliases: ['recibos', 'comprovante', 'comprovantes'] },
  { name: 'salvar-arquivo', aliases: ['salvararquivo', 'arquivar'] },
  { name: 'lembrar', aliases: ['lembre', 'anotar', 'anote', 'fato'] },
  { name: 'memoria', aliases: ['fatos', 'lembrancas'] },
  { name: 'esquecer', aliases: ['esqueca', 'apagar-fato'], destructive: true },
  { name: 'treinar', aliases: ['treino', 'ensinar'] },
  { name: 'exemplos', aliases: ['treinos'] },
  { name: 'desaprender', aliases: ['remover-exemplo'], destructive: true },
  { name: 'limpar', aliases: ['clear', 'reset-chat', 'novo', 'nova'], destructive: true },
  { name: 'param', aliases: ['params', 'parametro', 'parametros', 'config', 'configurar', 'ajuste', 'ajustes'] },
  { name: 'perfil', aliases: ['preset', 'perfis'] },
  { name: 'tom', aliases: ['estilo', 'humor'] },
  { name: 'persona', aliases: ['comportamento', 'papel'] },
  { name: 'vault', aliases: ['cofre-pasta'] }
];

const COMMAND_ALIAS_MAP = new Map();
const DESTRUCTIVE_COMMANDS = new Set();
for (const spec of COMMAND_SPECS) {
  COMMAND_ALIAS_MAP.set(spec.name, spec.name);
  if (spec.destructive) DESTRUCTIVE_COMMANDS.add(spec.name);
  for (const al of spec.aliases) {
    COMMAND_ALIAS_MAP.set(al, spec.name);
  }
}

function normalizeCmdToken(token) {
  return ObsidianIndex.normalize(token).replace(/[:.,;!?]+$/g, '').trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      // Transposicao de caracteres adjacentes (Damerau-Levenshtein: ex "stauts" -> "status")
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}

function resolveSlashCommand(rawToken) {
  const norm = normalizeCmdToken(rawToken);
  if (!norm) return { matched: null, rawNorm: '', autoCorrected: false, suggestions: [] };

  if (COMMAND_ALIAS_MAP.has(norm)) {
    return {
      matched: COMMAND_ALIAS_MAP.get(norm),
      rawNorm: norm,
      autoCorrected: false,
      suggestions: []
    };
  }

  // Prefixo unico (ex: /ajud -> /ajuda, /rev -> /revisar)
  if (norm.length >= 3) {
    const prefixCanonical = new Set();
    for (const [alias, canonical] of COMMAND_ALIAS_MAP.entries()) {
      if (alias.startsWith(norm)) prefixCanonical.add(canonical);
    }
    if (prefixCanonical.size === 1) {
      const target = Array.from(prefixCanonical)[0];
      if (!DESTRUCTIVE_COMMANDS.has(target)) {
        return { matched: target, rawNorm: norm, autoCorrected: true, suggestions: [target] };
      }
      return { matched: null, rawNorm: norm, autoCorrected: false, suggestions: [target] };
    }
  }

  // Distancia de edicao <= 2 contra nomes canonicos e aliases principais
  const candidates = new Map();
  for (const [alias, canonical] of COMMAND_ALIAS_MAP.entries()) {
    if (alias === '?' || alias.length < 3) continue;
    const d = levenshtein(norm, alias);
    const prev = candidates.get(canonical);
    if (prev === undefined || d < prev) candidates.set(canonical, d);
  }
  const ranked = Array.from(candidates.entries())
    .sort((a, b) => a[1] - b[1])
    .filter(([, d]) => d <= Math.max(2, Math.floor(norm.length / 2)));

  if (ranked.length && ranked[0][1] <= 1 && norm.length >= 4 && !DESTRUCTIVE_COMMANDS.has(ranked[0][0])) {
    const tie = ranked.length > 1 && ranked[1][1] === ranked[0][1];
    if (!tie) {
      return { matched: ranked[0][0], rawNorm: norm, autoCorrected: true, suggestions: [ranked[0][0]] };
    }
  }

  return {
    matched: null,
    rawNorm: norm,
    autoCorrected: false,
    suggestions: ranked.slice(0, 3).map(([name]) => `/${name}`)
  };
}

class LocalAiService {
  constructor(rootDirOrConfig, maybeConfig, codeDir) {
    if (maybeConfig) {
      this.rootDir = rootDirOrConfig;
      this.configManager = maybeConfig;
      this.codeDir = codeDir || maybeConfig.codeDir || rootDirOrConfig;
    } else {
      this.configManager = rootDirOrConfig;
      this.rootDir = process.cwd();
      this.codeDir = (rootDirOrConfig && rootDirOrConfig.codeDir) || this.rootDir;
    }
    this.memory = new AiMemory(this.codeDir);
    this.obsidian = new ObsidianIndex();
    this.engine = new LlamafileManager(this.rootDir, this.codeDir);
    this.documents = new AiDocuments(this.rootDir, this.configManager, this.codeDir);
    this.history = new ChatHistoryStore(this.rootDir, { getDocumentsFolder: () => this.documents.getDocumentsFolder() });
    this.lastAssistantText = '';
    this._exampleTokenCache = new WeakMap();
    this._rootContextCache = { mtimeMs: -1, content: '' };
  }

  /**
   * Le o arquivo de contexto permanente CONTEXTO_IA.md da raiz do projeto com cache por mtimeMs.
   */
  loadRootContextMd() {
    const contextPath = path.join(this.rootDir, 'CONTEXTO_IA.md');
    try {
      if (!fs.existsSync(contextPath)) {
        this._rootContextCache = { mtimeMs: -1, content: '' };
        return '';
      }
      const stat = fs.statSync(contextPath);
      if (this._rootContextCache.mtimeMs === stat.mtimeMs) {
        return this._rootContextCache.content;
      }
      const raw = fs.readFileSync(contextPath, 'utf8').slice(0, 12000).trim();
      this._rootContextCache = { mtimeMs: stat.mtimeMs, content: raw };
      return raw;
    } catch (_) {
      return '';
    }
  }

  _extractMarkdownSection(raw, headingFragment) {
    if (!raw) return '';
    const lines = String(raw).split(/\r?\n/);
    const normTarget = ObsidianIndex.normalize(headingFragment);
    let collecting = false;
    let baseLevel = 0;
    const collected = [];

    for (const line of lines) {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        const level = m[1].length;
        const normHeading = ObsidianIndex.normalize(m[2]);
        if (!collecting && normHeading.includes(normTarget)) {
          collecting = true;
          baseLevel = level;
          collected.push(line);
          continue;
        }
        if (collecting && level <= baseLevel) {
          break;
        }
      }
      if (collecting) collected.push(line);
    }
    return collected.join('\n').trim();
  }

  _getRootContextPromptBlock() {
    const raw = this.loadRootContextMd();
    if (!raw) return '';
    const personal = this._extractMarkdownSection(raw, 'base de contexto pessoal');
    const source = personal || raw;
    const placeholderRx = /\((?:Preencha aqui|Ex:|Descreva ou deixe vazio|Opcional:)/i;

    // Remove placeholders, divisores e cabecalhos markdown sem conteudo util abaixo
    const kept = [];
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || /^---+$/.test(trimmed) || placeholderRx.test(trimmed)) continue;
      const hm = trimmed.match(/^(#{1,6})\s+/);
      if (hm) {
        const level = hm[1].length;
        let hasBody = false;
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j].trim();
          if (!next || /^---+$/.test(next) || placeholderRx.test(next)) continue;
          const nhm = next.match(/^(#{1,6})\s+/);
          if (nhm) {
            if (nhm[1].length <= level) break;
            continue;
          }
          hasBody = true;
          break;
        }
        if (!hasBody) continue;
      }
      kept.push(trimmed);
    }

    const clean = kept.join('\n').trim();
    if (!clean) return '';
    if (clean.length <= 320) return clean;
    const sliced = clean.slice(0, 320);
    const lastSpace = Math.max(sliced.lastIndexOf('\n'), sliced.lastIndexOf(' '));
    return (lastSpace > 180 ? sliced.slice(0, lastSpace) : sliced).trim();
  }

  _searchRootContext(query, limit = 6) {
    const raw = this.loadRootContextMd();
    if (!raw) return [];
    const terms = Array.from(new Set(ObsidianIndex.tokenize(query)));
    const qNorm = ObsidianIndex.normalize(query);
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^---+$/.test(l));
    if (!terms.length && !qNorm) return [];

    const scored = [];
    for (const line of lines) {
      const lNorm = ObsidianIndex.normalize(line);
      let score = 0;
      if (terms.length) {
        for (const t of terms) {
          if (lNorm.includes(t)) score += 2;
        }
      } else if (qNorm && lNorm.includes(qNorm)) {
        score = 2;
      }
      if (score > 0) scored.push({ line, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.line);
  }

  getFullConfig() {
    if (this.configManager && typeof this.configManager.get === 'function') return this.configManager.get();
    return {};
  }

  getAiConfig() {
    const cfg = this.getFullConfig();
    const defaults = {
      provider: 'auto',
      endpoint: '',
      port: 18080,
      modelsDir: './codigo/models',
      llamafilePath: '',
      contextSize: 4096,
      autoStart: false,
      requestTimeoutMs: 240000,
      model: 'local',
      vaultPath: './arquivos/Obsidian_Vault',
      defaultFolder: 'Notas'
    };
    const merged = Object.assign({}, defaults, cfg.obsidian || {}, cfg.ai || {}, cfg.localAi || {});
    if (!merged.provider || merged.provider === 'builtin') merged.provider = 'auto';
    if (parseInt(merged.port, 10) === 8080 && !merged.endpoint) {
      merged.port = 18080;
    }
    return merged;
  }

  getVaultPath() {
    const aiCfg = this.getAiConfig();
    const raw = aiCfg.vaultPath || aiCfg.obsidianVaultFolder || './Obsidian_Vault';
    return this.configManager && typeof this.configManager.resolvePath === 'function'
      ? this.configManager.resolvePath(raw)
      : path.resolve(this.rootDir, raw);
  }

  isExternalProvider(aiCfg) {
    return ['ollama', 'lmstudio', 'openai'].includes(aiCfg.provider);
  }

  chatUrl(aiCfg) {
    if (this.isExternalProvider(aiCfg) && aiCfg.endpoint) {
      if (aiCfg.endpoint.includes('/v1/')) return aiCfg.endpoint;
      try {
        return `${new URL(aiCfg.endpoint).origin}/v1/chat/completions`;
      } catch (_) {}
    }
    if (aiCfg.provider === 'ollama' && !aiCfg.endpoint) {
      return 'http://127.0.0.1:11434/v1/chat/completions';
    }
    if (aiCfg.provider === 'lmstudio' && !aiCfg.endpoint) {
      return 'http://127.0.0.1:1234/v1/chat/completions';
    }
    const port = this.engine.getActivePort(aiCfg);
    return `http://127.0.0.1:${port}/v1/chat/completions`;
  }

  pingExternalUrl(chatUrlStr, timeoutMs = 1500) {
    return new Promise((resolve) => {
      try {
        const u = new URL(chatUrlStr);
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.get(
          {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: '/v1/models',
            timeout: timeoutMs
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              const ct = String(res.headers['content-type'] || '').toLowerCase();
              resolve(res.statusCode >= 200 && res.statusCode < 300 && !ct.includes('text/html') && !body.trim().startsWith('<'));
            });
          }
        );
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
        req.on('error', () => resolve(false));
      } catch (_) {
        resolve(false);
      }
    });
  }

  cleanModelOutput(text) {
    return String(text || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();
  }

  // =========================================================================
  // MOTOR
  // =========================================================================
  async getStatus() {
    const aiCfg = this.getAiConfig();
    const vault = this.getVaultPath();
    const isExt = this.isExternalProvider(aiCfg);
    const s = isExt
      ? {
          state: (await this.pingExternalUrl(this.chatUrl(aiCfg))) ? 'external' : 'offline',
          modelFound: true,
          modelName: aiCfg.model || aiCfg.provider,
          error: ''
        }
      : await this.engine.status(aiCfg);
    const mem = this.memory.load();
    const docs = this.documents.load().documents;
    return {
      ok: true,
      provider: aiCfg.provider,
      engine: s.state,
      ready: aiCfg.provider === 'offline' ? false : isExt ? s.state === 'external' : this.engine.isReady(),
      modelFound: s.modelFound,
      modelName: s.modelName,
      error: s.error,
      vaultPath: vault,
      vaultExists: fs.existsSync(vault),
      facts: mem.facts.length,
      examples: mem.examples.length,
      documents: docs.length,
      documentsDir: this.documents.getDocumentsFolder(),
      boostMode: aiCfg.boostMode || 'balanced'
    };
  }

  getPerformanceProfile() {
    const aiCfg = this.getAiConfig();
    return this.engine.getPerformanceProfile(aiCfg);
  }

  async setBoostMode(mode = 'turbo', { restartIfOnline = true } = {}) {
    const valid = ['eco', 'balanced', 'turbo'].includes(mode) ? mode : 'turbo';
    const cfg = this.getFullConfig();
    const nextAi = Object.assign({}, cfg.ai || {}, { boostMode: valid });
    if (this.configManager && typeof this.configManager.save === 'function') {
      this.configManager.save({ ai: nextAi });
    }
    const wasActive = this.engine.state === 'online' || this.engine.state === 'starting';
    if (restartIfOnline && wasActive) {
      await this.engine.stopAsync();
      this.engine.startPromise = null;
      await this.engine.ensureStarted(this.getAiConfig());
    }
    return this.getPerformanceProfile();
  }

  formatBoostReport(profile, changedToMode) {
    const p = profile || this.getPerformanceProfile();
    const lines = [];
    if (changedToMode) {
      lines.push(`Modo /boost ajustado para: ${p.boostLabel}`);
    } else {
      lines.push(`TELEMETRIA DE MEMORIA, VELOCIDADE E KITS (${p.boostLabel})`);
    }
    const loadInfo = p.speed.lastLoadMs > 0
      ? `carga ${(p.speed.lastLoadMs / 1000).toFixed(2)} s`
      : 'servidor ainda nao iniciado nesta sessao';
    const speedTag = p.speed.measured ? 'medido' : 'estimado';
    lines.push(
      `Hardware detectado: ${p.hardware.cpuModel} (${p.hardware.logicalCores} threads) | RAM: ${p.hardware.freeRamGb} GB livres / ${p.hardware.totalRamGb} GB totais`,
      `Modelo ativo: ${p.model.name} (${p.model.ggufGb} GB GGUF, disco modelos ${p.model.diskModelsGb} GB, estado: ${p.model.engineState})`,
      '',
      'CALCULO DE MEMORIA RAM:',
      `- HUD Electron (${p.memory.electronProcesses} processos): ~${p.memory.electronSuiteMb} MB WS / ~${p.memory.electronPrivateMb} MB priv. (0% CPU quando minimizado)`,
      `- Hook Win32 (MpeHook.exe): ~${p.memory.hookMb} MB`,
      `- Motor LLM (GGUF + KV ${p.tuning.kvType.toUpperCase()} ctx ${p.tuning.contextSize} + buffer): ~${p.memory.llmEstimatedMb} MB (economia KV: ~${p.memory.kvCacheSavedMb} MB)`,
      `- Total Katharos + LLM: ~${p.memory.totalMpeWithLlmGb} GB | Total c/ Windows: ~${p.memory.totalSystemWithLlmGb} GB`,
      '',
      'VELOCIDADE:',
      `- Motor Embutido Kataros (revisao/comandos): ~${p.speed.builtinMs} ms`,
      `- LLM Local (${p.tuning.threads} threads gen / ${p.tuning.threadsBatch} batch, Flash-Attn ${p.tuning.flashAttn}, ${speedTag}): ~${p.speed.promptTokPerSec} tok/s prompt | ~${p.speed.genTokPerSec} tok/s resposta (${loadInfo})`,
      '',
      `KIT RECOMENDADO P/ ESTE PC: ${p.recommendedKit.name}`,
      'KITS MINIMOS DE REFERENCIA:'
    );
    p.kits.forEach((k) => {
      lines.push(`- ${k.name}: ${k.ram} | ${k.cpu} | ${k.disk} | ${k.speed}`);
    });
    lines.push('', 'Uso: /boost turbo | /boost eco | /boost balanced | /kits');
    return lines.join('\n');
  }

  saveDocumentFile(payload) {
    return this.documents.addDocument(payload || {});
  }

  listDocuments(category = '') {
    return this.documents.list(category);
  }

  removeDocument(idOrIndex) {
    return this.documents.removeDocument(idOrIndex);
  }

  async warmUp() {
    const aiCfg = this.getAiConfig();
    if (aiCfg.provider === 'offline' || this.isExternalProvider(aiCfg)) return;
    this.engine.ensureStarted(aiCfg).catch(() => {});
  }

  /**
   * Garante o motor pronto. wait=false nao bloqueia (usa fallback enquanto carrega).
   */
  async ensureEngine({ wait = true, onStatus } = {}) {
    const aiCfg = this.getAiConfig();
    if (aiCfg.provider === 'offline') return false;
    if (this.isExternalProvider(aiCfg)) return true;
    if (this.engine.isReady()) {
      if (this.engine.child && this.engine.child.exitCode === null && !this.engine.child.killed) {
        return true;
      }
      const verified = await this.engine.status(aiCfg);
      if (verified.state === 'online' || verified.state === 'external') return true;
    }
    const st = await this.engine.status(aiCfg);
    if (st.state === 'online' || st.state === 'external') return true;
    if (!st.modelFound) return false;
    if (!wait) {
      this.engine.ensureStarted(aiCfg).catch(() => {});
      return false;
    }
    if (onStatus) onStatus('Carregando modelo local na memoria...');
    return this.engine.ensureStarted(aiCfg);
  }

  shutdown() {
    this.engine.stop();
  }

  // =========================================================================
  // CHAMADA AO LLM (OpenAI-compativel, com streaming)
  // =========================================================================
  callChat(messages, { temperature, maxTokens, topP, repeatPenalty, presencePenalty, onChunk } = {}) {
    const aiCfg = this.getAiConfig();
    const memParams = this.memory.load().params;
    const url = new URL(this.chatUrl(aiCfg));
    const lib = url.protocol === 'https:' ? https : http;
    const stream = typeof onChunk === 'function';
    const bodyObj = {
      model: aiCfg.model || 'local',
      messages,
      temperature: typeof temperature === 'number' ? temperature : memParams.temperatura,
      top_p: typeof topP === 'number' ? topP : memParams.top_p,
      presence_penalty: typeof presencePenalty === 'number' ? presencePenalty : memParams.presence_penalty,
      max_tokens: maxTokens || memParams.tokens || 1024,
      stream
    };
    if (aiCfg.provider !== 'openai') {
      bodyObj.repeat_penalty = typeof repeatPenalty === 'number' ? repeatPenalty : memParams.repeat_penalty;
    }
    const payload = JSON.stringify(bodyObj);

    return new Promise((resolve, reject) => {
      let full = '';
      let buffer = '';
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          timeout: parseInt(aiCfg.requestTimeoutMs, 10) || 240000,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Authorization: `Bearer ${aiCfg.apiKey || 'no-key'}`
          }
        },
        (res) => {
          res.setEncoding('utf8');
          if (res.statusCode >= 400) {
            let errBody = '';
            res.on('data', (c) => (errBody += c));
            res.on('end', () => {
              const err = new Error(`HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`);
              err.statusCode = res.statusCode;
              reject(err);
            });
            return;
          }
          res.on('data', (chunk) => {
            if (!stream) {
              full += chunk;
              return;
            }
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              const l = line.trim();
              if (!l.startsWith('data:')) continue;
              const data = l.slice(5).trim();
              if (data === '[DONE]') continue;
              try {
                const j = JSON.parse(data);
                if (j && j.timings) {
                  this.engine.recordMetrics({
                    promptTokPerSec: Number((j.timings.prompt_per_second || 0).toFixed(2)),
                    genTokPerSec: Number((j.timings.predicted_per_second || 0).toFixed(2))
                  });
                }
                const delta =
                  (j.choices && j.choices[0] && ((j.choices[0].delta && j.choices[0].delta.content) || j.choices[0].text)) || '';
                if (delta) {
                  full += delta;
                  onChunk(delta);
                }
              } catch (_) {}
            }
          });
          res.on('end', () => {
            if (!stream) {
              try {
                const j = JSON.parse(full);
                if (j && j.timings) {
                  this.engine.recordMetrics({
                    promptTokPerSec: Number((j.timings.prompt_per_second || 0).toFixed(2)),
                    genTokPerSec: Number((j.timings.predicted_per_second || 0).toFixed(2))
                  });
                }
                return resolve(
                  (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''
                );
              } catch (e) {
                return reject(e);
              }
            }
            resolve(full);
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Tempo esgotado aguardando a I.A local')));
      req.write(payload);
      req.end();
    });
  }

  // =========================================================================
  // MONTAGEM DE CONTEXTO (memoria + treino + Obsidian + historico)
  // =========================================================================
  buildMessages({ task, text, tone, useHistory = true, extraContext = '' }) {
    const mem = this.memory.load();
    const p = mem.params;

    const toneMap = {
      amigavel: 'amigavel, acolhedor e claro',
      neutra: 'neutro, equilibrado e natural',
      profissional: 'profissional, preciso e objetivo',
      conciso: 'conciso, tecnico e sem rodeios',
      didatico: 'didatico, paciente e facil de entender'
    };

    const detailMap = {
      curto: 'Prefira respostas curtas e objetivas, em poucas linhas ou topicos essenciais.',
      medio: 'Entregue respostas claras, completas e bem estruturadas na medida certa.',
      completo: 'Entregue respostas completas e detalhadas, com passos claros e exemplos uteis.'
    };

    const sys = [
      'Voce e a Katharos Nous (katharos AI), assistente local executando 100% offline no computador do usuario.',
      'REGRAS OBRIGATORIAS DE RESPOSTA:',
      '- Responda sempre em portugues do Brasil (salvo quando /traduzir pedir outro idioma).',
      '- NUNCA use emojis ou icones Unicode decorativos.',
      '- Seja proativo e resolutivo: entregue o resultado pronto imediatamente (receita completa, texto revisado, resumo, codigo funcional ou resposta direta) em vez de devolver perguntas desnecessarias ao usuario.',
      '- Se o pedido omitir um detalhe opcional (ex: sabor ou formato), adote uma escolha padrao sensata, entregue a resposta completa e, se fizer sentido, diga em 1 linha ao final que pode ajustar outro detalhe.',
      '- Em continuacoes curtas ("pode adaptar", "sim", "faca", "melhore"), conecte automaticamente com o historico da conversa, notas do Obsidian e documentos indexados.',
      '- Ao citar extratos, saldos, recibos ou arquivos locais, use apenas valores e fatos realmente presentes nos documentos fornecidos.',
      `Tom: ${toneMap[tone] || toneMap.profissional}.`,
      `Profundidade: ${detailMap[p.detalhe] || detailMap.medio}`
    ];
    if (p.persona) sys.push(`Instrucao fixa do usuario: ${p.persona}`);

    if (task !== 'review') {
      const rootBlock = this._getRootContextPromptBlock();
      if (rootBlock) {
        sys.push('', 'CONTEXTO RAIZ (CONTEXTO_IA.md):', rootBlock);
      }
    }

    if (mem.facts.length) {
      sys.push('', 'MEMORIA (fatos que o usuario pediu para lembrar):');
      mem.facts.slice(-30).forEach((f) => sys.push(`- ${f.text}`));
    }

    if (mem.templates && mem.templates.length && task !== 'review') {
      const qNorm = ObsidianIndex.normalize(text);
      const qTerms = new Set(ObsidianIndex.tokenize(text));
      const matchedTpls = mem.templates.filter((t) => {
        const tNorm = ObsidianIndex.normalize(t.name);
        if (qNorm.includes(tNorm)) return true;
        return ObsidianIndex.tokenize(t.name).some((w) => qTerms.has(w));
      });
      if (matchedTpls.length) {
        sys.push('', 'MODELOS DE TEXTO AUTOMATIZADOS DISPONIVEIS:');
        matchedTpls.slice(0, 2).forEach((t) => sys.push(`[${t.name}]\n${t.content.slice(0, 700)}`));
      } else if (/\b(modelo|modelos|template|templates|automacao|texto padrao)\b/.test(qNorm)) {
        sys.push('', `Modelos salvos do usuario: ${mem.templates.map((t) => t.name).join(', ')}`);
      }
    }

    // Para continuacoes curtas (ex: "pode adaptar"), combina palavras recentes do historico na busca contextual
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    let ragQuery = text;
    if (words.length <= 6 && mem.history && mem.history.length) {
      const recentText = mem.history
        .slice(-4)
        .map((h) => h.content)
        .join(' ');
      ragQuery = `${text} ${recentText}`.slice(0, 600);
    }

    if (p.obsidian === 'on' && task !== 'review') {
      const hits = this.obsidian.search(this.getVaultPath(), ragQuery, 3, 700);
      if (hits.length) {
        sys.push('', 'NOTAS DO OBSIDIAN RELEVANTES (use se ajudar, cite o titulo):');
        hits.forEach((h) => sys.push(`[${h.title}]\n${h.snippet}`));
      }
    }
    if (p.documentos !== 'off' && task !== 'review') {
      const docHits = this.documents.search(ragQuery, 3, 900);
      if (docHits.length) {
        sys.push('', 'DOCUMENTOS SALVOS NA I.A LOCAL (PDFs, extratos, curriculos, codigos e arquivos):');
        docHits.forEach((dh) => {
          const finReport = this.documents.formatFinancialReport(dh.document, 'extrato');
          sys.push(finReport);
          const hasFinEntries = dh.document.parsedFinancial && dh.document.parsedFinancial.isFinancial && dh.document.parsedFinancial.entryCount > 0;
          if (!hasFinEntries && dh.snippet) {
            sys.push(`Trecho (${dh.document.title}):\n${dh.snippet}`);
          }
        });
      }
    }
    if (extraContext) sys.push('', extraContext);

    const messages = [{ role: 'system', content: sys.join('\n') }];

    // Exemplos de treinamento (few-shot): os mais parecidos com a pergunta atual
    const examples = this.pickExamples(text, mem.examples, 4);
    examples.forEach((ex) => {
      messages.push({ role: 'user', content: ex.q });
      messages.push({ role: 'assistant', content: ex.a });
    });

    if (useHistory) {
      this.memory.recentHistory(p.historico).forEach((h) => messages.push(h));
    }

    const clipped = text.length > 9000 ? `${text.slice(0, 9000)}\n[texto cortado]` : text;
    let userContent = clipped;
    if (task === 'review') {
      userContent =
        'Revise o texto abaixo corrigindo ortografia, acentuacao, pontuacao, concordancia e clareza, ' +
        'mantendo o sentido e o estilo do autor. Responda no formato:\n' +
        'TEXTO REVISADO:\n<texto>\n\nCORRECOES:\n- <principais correcoes, no maximo 5>\n\n' +
        `TEXTO:\n${clipped}`;
    } else if (task === 'summarize') {
      userContent =
        'Resuma o conteudo abaixo em topicos objetivos, destacando os pontos principais e decisoes/acoes:\n\n' +
        clipped;
    } else if (task === 'explain') {
      userContent =
        'Explique de forma clara, pratica e passo a passo o tema ou conteudo abaixo (sem termos complicados sem explicacao):\n\n' +
        clipped;
    } else if (task === 'translate') {
      userContent =
        'Traduza com fidelidade e naturalidade mantendo a formatacao original:\n\n' +
        clipped;
    } else if (task === 'adapt') {
      userContent =
        'Com base no historico da conversa e nos documentos relevantes, execute diretamente a adaptacao solicitada abaixo (entregue a versao pronta completa):\n\n' +
        clipped;
    } else if (task === 'code') {
      userContent =
        `Escreva codigo em ${p.linguagem || 'JavaScript'} (ou na linguagem pedida) para o pedido abaixo. ` +
        'Use as notas do Obsidian e a memoria quando forem relevantes. ' +
        'Entregue um bloco de codigo completo e funcional, seguido de uma explicacao curta.\n\n' +
        `PEDIDO:\n${clipped}`;
    } else if (task === 'draft') {
      userContent = `Redija um texto completo, claro e bem estruturado em Markdown para:\n${clipped}`;
    } else if (task === 'obsidian') {
      userContent =
        'Organize o conteudo abaixo como uma nota do Obsidian: sugira titulo, pasta e tags, ' +
        `e reescreva em Markdown limpo.\n\n${clipped}`;
    }
    messages.push({ role: 'user', content: userContent });
    return messages;
  }

  pickExamples(text, examples, limit) {
    if (!examples.length) return [];
    const terms = new Set(ObsidianIndex.tokenize(text));
    if (!terms.size) return examples.slice(-Math.min(limit, 2));
    const scored = examples.map((ex, i) => {
      let tokSet = this._exampleTokenCache.get(ex);
      if (!tokSet) {
        tokSet = new Set(ObsidianIndex.tokenize(ex.q));
        this._exampleTokenCache.set(ex, tokSet);
      }
      let score = 0;
      for (const w of terms) {
        if (tokSet.has(w)) score += 1;
      }
      return { ex, score, i };
    });
    const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    const chosen = relevant.length ? relevant : scored.slice(-2);
    return chosen.slice(0, limit).map((s) => s.ex);
  }

  async generate({ task, text, tone, useHistory = true, extraContext = '', onChunk, onStatus }) {
    const ready = await this.ensureEngine({ wait: true, onStatus });
    if (!ready) return null;
    const p = this.memory.load().params;
    if (onStatus) onStatus('');
    const messages = this.buildMessages({ task, text, tone, useHistory, extraContext });
    const temperature =
      task === 'review'
        ? Math.min(0.25, p.temperatura)
        : task === 'code'
        ? Math.min(0.3, p.temperatura)
        : p.temperatura;
    const out = await this.callChat(messages, {
      temperature,
      topP: p.top_p,
      repeatPenalty: p.repeat_penalty,
      presencePenalty: p.presence_penalty,
      maxTokens: p.tokens,
      onChunk
    });
    return this.cleanModelOutput(out);
  }

  offlineNotice(text) {
    const aiCfg = this.getAiConfig();
    const st = this.engine;
    const lines = [];
    if (aiCfg.provider === 'offline') {
      lines.push('Modo offline sem modelo ativado (ai.provider = "offline").');
    } else if (!st.findModel(aiCfg)) {
      lines.push('Modelo local nao encontrado em codigo/models/.');
      lines.push('Coloque um arquivo .llamafile ou .gguf na pasta codigo/models/ e envie /iniciar.');
    } else {
      lines.push(`Motor local indisponivel. ${st.lastError || ''}`.trim());
      lines.push('Envie /iniciar ou consulte codigo/logs/llamafile.log.');
    }
    const hits = this.obsidian.search(this.getVaultPath(), text, 3, 260);
    if (hits.length) {
      lines.push('', 'Notas relacionadas no Obsidian:');
      hits.forEach((h) => lines.push(`[${h.title}] ${h.snippet.replace(/\s+/g, ' ')}`));
    }
    const facts = this._matchFacts(text, 5);
    if (facts.length) {
      lines.push('', 'Da memoria:');
      facts.forEach((f) => lines.push(`- ${f.text}`));
    }
    return lines.join('\n');
  }

  _matchFacts(query, limit = 6) {
    const qRaw = String(query || '').trim();
    if (!qRaw) return [];
    const qNorm = ObsidianIndex.normalize(qRaw);
    const qTerms = new Set(ObsidianIndex.tokenize(qRaw));
    if (!qNorm && !qTerms.size) return [];
    const facts = this.memory.load().facts || [];
    const hits = [];
    for (let i = 0; i < facts.length && hits.length < limit; i++) {
      const f = facts[i];
      const fNorm = ObsidianIndex.normalize(f.text);
      if ((qNorm && fNorm.includes(qNorm)) || ObsidianIndex.tokenize(f.text).some((t) => qTerms.has(t))) {
        hits.push(f);
      }
    }
    return hits;
  }

  // =========================================================================
  // CHAT (ponto de entrada do drawer lateral)
  // =========================================================================
  getDefaultRoute() {
    try {
      const cfg = this.configManager && typeof this.configManager.get === 'function' ? this.configManager.get() : null;
      return normalizeRoute(cfg && cfg.ui && cfg.ui.defaultRoute, 'ia');
    } catch (_) {
      return 'ia';
    }
  }

  async saveNoteQuick(text) {
    const body = String(text || '').trim();
    const firstLine = body.split(/\r?\n/)[0] || '';
    const title = firstLine.slice(0, 40).trim() || `Nota_${Date.now()}`;
    try {
      const res = await this.saveToObsidian({ title, text: body });
      return res || { ok: false, error: 'sem resposta' };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async chat({ message, mode = 'free', tone = 'profissional', route } = {}, { onChunk, onStatus } = {}) {
    const text = String(message || '').trim();
    if (!text) return { ok: false, text: 'Mensagem vazia.' };

    const resolved = resolveRoute(text, normalizeRoute(route, this.getDefaultRoute()));
    let res;
    try {
      res = await this._chatByRoute(resolved, { mode, tone, onChunk, onStatus });
    } catch (err) {
      const cleanMsg = String(err.message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      res = { ok: false, text: `Erro na I.A local: ${cleanMsg}` };
    }
    res = Object.assign({}, res, { route: resolved.route, routeSource: resolved.source });
    this._recordHistory(text, resolved.route, res);
    return res;
  }

  _recordHistory(userText, route, res) {
    const cmd = (String(userText).match(/^\s*\/([a-z-]+)/i) || [])[1];
    if (cmd && ['limpar', 'param', 'historico', 'historia', 'conversas', 'history'].includes(cmd.toLowerCase())) return;
    try {
      this.history.append({ role: 'user', route, text: userText });
      if (res && res.text) {
        this.history.append({ role: 'assistant', route, text: String(res.text).slice(0, 2000) });
      }
    } catch (err) {
      console.warn('[LocalAiService] Falha ao gravar historico:', err.message);
    }
  }

  async _chatByRoute({ route, cleanText }, { mode, tone, onChunk, onStatus }) {
    if (cleanText.startsWith('/')) {
      return await this.handleCommand(cleanText, { tone, onChunk, onStatus });
    }

    if (!cleanText) {
      const what = route === 'local' ? 'encontrar' : route === 'nota' ? 'guardar' : 'perguntar';
      return { ok: false, text: `Escreva o que quer ${what}.`, source: 'route' };
    }

    if (route === 'local') {
      const found = await this.handleCommand(`/buscar ${cleanText}`, { tone, onChunk, onStatus });
      return Object.assign({}, found, {
        text: `Busca nos seus arquivos, sem passar pela inteligencia.\n\n${(found && found.text) || ''}`
      });
    }

    if (route === 'nota') {
      const saved = await this.saveNoteQuick(cleanText);
      if (saved && saved.ok) {
        return {
          ok: true,
          source: 'route',
          text: `Guardei em ${saved.folder} como "${saved.fileName}". Nada foi enviado para a inteligencia.`,
          savedNote: { fileName: saved.fileName, folder: saved.folder }
        };
      }
      return { ok: false, source: 'route', text: `Nao consegui guardar: ${(saved && saved.error) || 'erro desconhecido'}` };
    }

    const taskByMode = { review: 'review', code: 'code', draft: 'draft', obsidian: 'obsidian', free: 'chat' };
    const task = taskByMode[mode] || 'chat';
    return await this.runTask(task, cleanText, { tone, onChunk, onStatus });
  }

  async runTask(task, text, { tone, onChunk, onStatus, useHistory, extraContext = '' } = {}) {
    const aiCfg = this.getAiConfig();
    const shouldUseHistory = typeof useHistory === 'boolean' ? useHistory : task !== 'review';
    let out = null;
    let fallbackReason = '';
    let streamedChunks = 0;

    const trackedOnChunk = typeof onChunk === 'function'
      ? (delta) => {
          if (delta) streamedChunks++;
          onChunk(delta);
        }
      : undefined;

    const invokeOnce = async () => {
      return await this.generate({
        task,
        text,
        tone,
        useHistory: shouldUseHistory,
        extraContext,
        onChunk: trackedOnChunk,
        onStatus
      });
    };

    try {
      out = await invokeOnce();
      if (out !== null && !String(out).trim()) {
        throw new Error('Resposta vazia do servidor LLM');
      }
    } catch (err) {
      fallbackReason = String(err.message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
      console.warn('[LocalAiService] Erro na chamada LLM:', fallbackReason);

      const canRecover = aiCfg.provider === 'auto' && !this.isExternalProvider(aiCfg) && streamedChunks === 0;
      if (canRecover) {
        try {
          const port = this.engine.getActivePort(aiCfg);
          const pingState = await this.engine.ping(port, 2000);
          if (pingState === 'fail') {
            if (onStatus) onStatus('Reconectando motor local...');
            await this.engine.stopAsync(3000);
            this.engine.startPromise = null;
          } else {
            await new Promise((r) => setTimeout(r, 450));
          }
          out = await invokeOnce();
          if (out !== null && String(out).trim()) {
            fallbackReason = '';
          } else {
            out = null;
          }
        } catch (retryErr) {
          fallbackReason = String(retryErr.message || fallbackReason || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
          console.warn('[LocalAiService] Retry LLM tambem falhou:', fallbackReason);
          out = null;
        }
      } else if (aiCfg.provider !== 'auto' || this.isExternalProvider(aiCfg)) {
        throw new Error(fallbackReason || 'Falha ao consultar o provedor de I.A.');
      } else {
        out = null;
      }
    }

    if (out === null) {
      const built = this.builtinRespond(task, text, { tone });
      let finalFallback = built.text;
      if (fallbackReason && this.engine.findModel(aiCfg)) {
        finalFallback += `\n\n[Aviso: resposta pelo motor embutido (${fallbackReason}). Envie /status ou /iniciar]`;
      }
      if (task !== 'review') {
        this.memory.pushHistory('user', text);
        this.memory.pushHistory('assistant', finalFallback);
      }
      this.lastAssistantText = built.copyText || finalFallback;
      return { ok: true, text: finalFallback, source: 'builtin' };
    }
    if (task !== 'review') {
      this.memory.pushHistory('user', text);
      this.memory.pushHistory('assistant', out);
    }
    this.lastAssistantText = out;
    return { ok: true, text: out, source: 'llm', streamed: typeof onChunk === 'function' };
  }

  /**
   * Motor local embutido da AI Kataros (funciona imediatamente sem .llamafile externo).
   * Usa memoria (/lembrar), exemplos treinados (/treinar), parametros (/param) e notas do Obsidian.
   */
  builtinRespond(task, text, { tone = 'profissional' } = {}) {
    const mem = this.memory.load();
    const p = mem.params;
    const vault = this.getVaultPath();
    const hits = p.obsidian === 'on' ? this.obsidian.search(vault, text, 3, 500) : [];
    const terms = new Set(ObsidianIndex.tokenize(text));
    const relatedFacts = mem.facts.filter((f) =>
      ObsidianIndex.tokenize(f.text).some((w) => terms.has(w))
    );
    const activeFacts = relatedFacts.length ? relatedFacts : mem.facts.slice(-5);

    // 1. Revisao de texto
    if (task === 'review') {
      const r = this.builtinGrammarAndStyleReview(text);
      return {
        text: `TEXTO REVISADO:\n${r.revised}\n\nOBSERVACOES:\n- ${r.summary}`,
        copyText: r.revised
      };
    }

    // 1b. Resumo rapido offline
    if (task === 'summarize') {
      const sentences = String(text || '')
        .replace(/\r?\n+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const picked = sentences.slice(0, 4).map((s) => `- ${s}`);
      const out = picked.length
        ? `RESUMO:\n${picked.join('\n')}`
        : `RESUMO:\n- ${String(text || '').slice(0, 300)}`;
      return { text: out, copyText: out };
    }

    // 1c. Explicacao / Traducao / Adaptacao ou Edicao offline
    if (task === 'explain' || task === 'translate' || task === 'adapt') {
      if (task === 'adapt' && (text.includes('TEXTO BASE:\n') || text.includes('TEXTO ORIGINAL ('))) {
        const marker = text.includes('TEXTO ORIGINAL (') ? 'TEXTO ORIGINAL (' : 'TEXTO BASE:\n';
        const idx = text.indexOf(marker);
        const bodyPart = idx >= 0
          ? text.slice(text.indexOf('\n', idx) + 1).trim()
          : text;
        const outLines = [
          bodyPart,
          '',
          '[Edicao/modelo preparado no chat. Para reescrita automatica com I.A, inicie o modelo local com /iniciar.]'
        ];
        return { text: outLines.join('\n'), copyText: bodyPart };
      }

      const r = this.builtinGrammarAndStyleReview(text);
      const docHits = p.documentos !== 'off' ? this.documents.search(text, 2, 500) : [];
      const lines = [];
      if (docHits.length) {
        lines.push('Conteudo encontrado nos documentos locais:');
        docHits.forEach((dh) => lines.push(`- ${dh.document.summary} (${dh.document.relPath})`));
      } else {
        lines.push(r.revised);
      }
      if (hits.length) {
        lines.push('', 'Notas relacionadas no Obsidian:');
        hits.forEach((h) => lines.push(`- [${h.title}] ${h.snippet.replace(/\s+/g, ' ').slice(0, 200)}`));
      }
      lines.push('', 'Para explicacao, traducao ou adaptacao completa, inicie o modelo local com /iniciar.');
      const out = lines.join('\n');
      return { text: out, copyText: out };
    }

    // 2. Verifica correspondencia com exemplos treinados (/treinar)
    if (mem.examples.length && task !== 'code') {
      const qNorm = ObsidianIndex.normalize(text);
      let best = null;
      let bestScore = 0;
      for (const ex of mem.examples) {
        const exNorm = ObsidianIndex.normalize(ex.q);
        if (qNorm === exNorm || qNorm.includes(exNorm) || exNorm.includes(qNorm)) {
          best = ex;
          bestScore = 999;
          break;
        }
        const exTerms = ObsidianIndex.tokenize(ex.q);
        const overlap = exTerms.filter((w) => terms.has(w)).length;
        const ratio = exTerms.length ? overlap / exTerms.length : 0;
        if (overlap >= 1 && ratio > bestScore) {
          bestScore = ratio;
          best = ex;
        }
      }
      if (best && bestScore >= 0.45) {
        return { text: best.a, copyText: best.a };
      }
    }

    // 3. Programacao (/codigo ou modo Programacao) alimentada por Obsidian + Memoria
    if (task === 'code') {
      const lower = ObsidianIndex.normalize(text);
      let lang = p.linguagem || 'JavaScript';
      if (/\bpython\b|\bpy\b/.test(lower)) lang = 'Python';
      else if (/\btypescript\b|\bts\b/.test(lower)) lang = 'TypeScript';
      else if (/\bc#\b|csharp/.test(lower)) lang = 'C#';
      else if (/powershell|\bps1\b/.test(lower)) lang = 'PowerShell';
      else if (/\bsql\b/.test(lower)) lang = 'SQL';
      else if (/\bhtml\b/.test(lower)) lang = 'HTML';

      const codeBlocks = [];
      hits.forEach((h) => {
        const matches = h.snippet.match(/```[\s\S]*?```/g);
        if (matches) matches.forEach((b) => codeBlocks.push({ title: h.title, block: b }));
      });

      const fnNameMatch = text.match(/(?:funcao|function|def|metodo|criar|escreva)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      const fnName = (fnNameMatch && fnNameMatch[1] && !/^(para|em|com|que|uma|um|de)$/i.test(fnNameMatch[1]))
        ? fnNameMatch[1]
        : 'executarTarefa';

      const codeDocHits = p.documentos !== 'off'
        ? this.documents.search(text, 2, 700).filter(
            (dh) =>
              ObsidianIndex.normalize(dh.document.category) === 'codigos' ||
              /(explic|analis|como funciona|o que faz|revis|bug|otimiz)/.test(lower)
          )
        : [];

      let codeOut = '';
      if (codeBlocks.length) {
        codeOut = codeBlocks.map((c) => `// Referencia do Obsidian: ${c.title}\n${c.block}`).join('\n\n');
      } else if (codeDocHits.length && /(explic|analis|como funciona|o que faz|revis|bug|otimiz)/.test(lower)) {
        codeOut = codeDocHits
          .map((dh) => `[${dh.document.category}] ${dh.document.title} (${dh.document.relPath})\n${dh.snippet}`)
          .join('\n\n');
      } else {
        codeOut = this.generateCodeTemplate(lang, fnName, text, activeFacts, hits);
      }

      const outLines = [codeOut];
      if (codeDocHits.length && !codeOut.includes(codeDocHits[0].document.relPath)) {
        outLines.push('', 'Codigos/documentos relacionados:');
        codeDocHits.forEach((dh) => outLines.push(`- [${dh.document.category}] ${dh.document.title} (${dh.document.relPath})`));
      }
      if (hits.length) {
        outLines.push('', 'Referencias do Obsidian usadas:');
        hits.forEach((h) => outLines.push(`- [${h.title}] ${h.rel}`));
      }
      if (activeFacts.length) {
        outLines.push('', 'Memoria aplicada:');
        activeFacts.slice(0, 4).forEach((f) => outLines.push(`- ${f.text}`));
      }
      return { text: outLines.join('\n'), copyText: codeOut };
    }

    // 4. Redacao / Organizacao Obsidian
    if (task === 'draft' || task === 'obsidian') {
      const cls = this.classifyForObsidian(text);
      const r = this.builtinGrammarAndStyleReview(text);
      const lines = [
        `# ${cls.title}`,
        `Pasta sugerida: ${cls.suggestedFolder} | Tags: ${cls.tags.map((t) => `#${t}`).join(', ')}`,
        '',
        r.revised
      ];
      if (hits.length) {
        lines.push('', 'Notas relacionadas no Obsidian:');
        hits.forEach((h) => lines.push(`- [${h.title}]: ${h.snippet.replace(/\s+/g, ' ').slice(0, 180)}`));
      }
      if (activeFacts.length) {
        lines.push('', 'Contexto da Memoria:');
        activeFacts.slice(0, 3).forEach((f) => lines.push(`- ${f.text}`));
      }
      return { text: lines.join('\n'), copyText: lines.join('\n') };
    }

    // 5. Conversa geral (leitura de texto, consulta a documentos/extratos/recibos, memoria e Obsidian)
    const lower = ObsidianIndex.normalize(text);
    if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|hey)\b/.test(lower)) {
      const greet =
        tone === 'conciso'
          ? 'AI Kataros ativa.'
          : 'Ola! AI Kataros pronta. Posso revisar textos, salvar arquivos e consultar extratos/saldos/recibos (/extrato, /saldo, /recibo, /arquivos), lembrar fatos (/lembrar) e gerar codigo.';
      return { text: greet, copyText: greet };
    }

    if (/(o que.*lembra|minha memoria|fatos salvos|quais.*regras)/.test(lower)) {
      if (!mem.facts.length) return { text: 'Memoria vazia. Use /lembrar <fato> para me ensinar algo.' };
      const list = mem.facts.map((f, i) => `${i + 1}. ${f.text}`).join('\n');
      return { text: `Fatos na memoria:\n${list}`, copyText: list };
    }

    // Consulta a modelos salvos (/modelo)
    const templateIntent = /(meus modelos|modelos salvos|templates salvos|quais modelos|quais templates)/.test(lower);
    if (templateIntent) {
      const tpls = this.memory.listTemplates();
      if (!tpls.length) {
        const emptyMsg = 'Nenhum modelo salvo ainda. Use /modelo salvar <nome> :: <texto>.';
        return { text: emptyMsg, copyText: emptyMsg };
      }
      const txt = [
        `Modelos salvos no chat (${tpls.length}):`,
        ...tpls.map((t, i) => `${i + 1}. ${t.name}: ${t.content.replace(/\s+/g, ' ').slice(0, 140)}`)
      ].join('\n');
      return { text: txt, copyText: txt };
    }

    // Consulta a curriculo / dados profissionais
    const resumeIntent = /(curriculo|curriculum|resume|\bcv\b|experiencia profissional|formacao academica|minhas habilidades|meus dados)/.test(lower);
    if (resumeIntent) {
      const cvTxt = this._buildCurriculoOfflineReply(text);
      return { text: cvTxt, copyText: cvTxt };
    }

    // Consulta a PDFs salvos
    const pdfIntent = /\bpdfs?\b/.test(lower);
    if (pdfIntent) {
      this.documents.syncExternalFiles({ force: true });
      const pdfHits = this.documents
        .search(text, 4, 900, { sync: false })
        .filter((dh) => String(dh.document.ext || '').toLowerCase() === '.pdf' || ObsidianIndex.normalize(dh.document.category) === 'pdfs');
      const allPdfs = pdfHits.length
        ? pdfHits.map((dh) => dh.document)
        : this.documents.list('', { sync: false }).filter((d) => String(d.ext || '').toLowerCase() === '.pdf' || ObsidianIndex.normalize(d.category) === 'pdfs');
      if (allPdfs.length) {
        const pdfLines = [`PDFs consultados para "${text}":`];
        allPdfs.slice(0, 3).forEach((d) => {
          pdfLines.push('', `[${d.category}] ${d.title} (${d.relPath})`);
          if (d.parsedFinancial && d.parsedFinancial.isFinancial) {
            pdfLines.push(this.documents.formatFinancialReport(d, 'extrato'));
          } else {
            pdfLines.push(this._extractRelevantLines(d.textContent || d.summary, text, 6) || (d.textContent || d.summary || '').slice(0, 450));
          }
        });
        const pdfReply = pdfLines.join('\n');
        return { text: pdfReply, copyText: pdfReply };
      }
    }

    // Consulta a documentos salvos na I.A local (extratos, saldos, recibos, comprovantes)
    const docQueryIntent = /(extrato|saldo|recibo|comprovante|pix|fatura|boleto|arquivo|documento|entrada|saida|receita|despesa|quanto entrou|quanto saiu|quanto gast|maior gasto|valores?|pagamentos)/.test(
      lower
    );
    const docHits = this.documents.search(text, 3, 700);
    if (docQueryIntent) {
      if (!docHits.length) {
        const msg =
          'Nenhum documento ou extrato encontrado na I.A local para essa consulta.\n' +
          'Coloque o arquivo em ./arquivos ou use o botao "Salvar Arquivo" para indexar PDFs, OFX, CSV ou TXT.';
        return { text: msg, copyText: msg };
      }
      const wantsBalanceOnly = /\bsaldo\b/.test(lower) && !/(extrato|lancamento|entrada|saida|recibo|comprovante)/.test(lower);
      const reportBlocks = docHits.map((dh) =>
        this.documents.formatFinancialReport(dh.document, wantsBalanceOnly ? 'saldo' : 'extrato')
      );
      const docReply = reportBlocks.join('\n\n---\n\n');
      return { text: docReply, copyText: docReply };
    }

    const matchedTpls = this._matchTemplates(text, 2);
    const rootHits = this._searchRootContext(text, 3);
    const lines = [];
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 8) {
      const r = this.builtinGrammarAndStyleReview(text);
      lines.push(`Leitura e revisao rapida (${wordCount} palavras):`, r.revised);
    } else if (docHits.length || hits.length || activeFacts.length || matchedTpls.length || rootHits.length) {
      lines.push('Baseado nos arquivos da I.A local, memoria e Obsidian:');
    } else {
      lines.push(`AI Kataros (motor embutido) recebeu: "${text}"`);
      lines.push('Dica: use /rapido, /pdf, /curriculo, /extrato, /codigo, /modelo, /editar ou /ajuda.');
    }

    if (docHits.length) {
      lines.push('', 'Documentos da I.A Local relacionados:');
      docHits.forEach((dh) => lines.push(`- ${dh.document.summary} (${dh.document.relPath})`));
    }
    if (hits.length) {
      lines.push('', 'Notas do Obsidian relacionadas:');
      hits.forEach((h) => lines.push(`- [${h.title}] ${h.snippet.replace(/\s+/g, ' ').slice(0, 220)}`));
    }
    if (matchedTpls.length) {
      lines.push('', 'Modelos salvos relacionados:');
      matchedTpls.forEach((t) => lines.push(`- [${t.name}] ${t.content.replace(/\s+/g, ' ').slice(0, 180)}`));
    }
    if (activeFacts.length) {
      lines.push('', 'Da memoria:');
      activeFacts.slice(0, 4).forEach((f) => lines.push(`- ${f.text}`));
    }
    if (!docHits.length && !hits.length && rootHits.length) {
      lines.push('', 'De CONTEXTO_IA.md:');
      rootHits.forEach((l) => lines.push(`- ${l}`));
    }
    const finalTxt = lines.join('\n');
    return { text: finalTxt, copyText: finalTxt };
  }

  generateCodeTemplate(lang, fnName, prompt, facts, hits) {
    const lower = ObsidianIndex.normalize(prompt);
    const hints = [];
    if (facts.length) hints.push(`Memoria: ${facts.map((f) => f.text).slice(0, 2).join('; ')}`);
    if (hits.length) hints.push(`Obsidian: ${hits.map((h) => h.title).join(', ')}`);
    const header = hints.length ? `// ${hints.join(' | ')}\n` : '';

    if (lang === 'Python') {
      return [
        '```python',
        header.replace(/\/\//g, '#').trimEnd(),
        `def ${fnName}(dados):`,
        `    """${prompt.slice(0, 90)}"""`,
        '    if not dados:',
        '        return None',
        '    resultado = dados',
        '    return resultado',
        '```'
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (/debounce/.test(lower)) {
      return [
        '```javascript',
        header.trimEnd(),
        `function ${fnName === 'executarTarefa' ? 'debounce' : fnName}(fn, delayMs = 250) {`,
        '  let timer = null;',
        '  return function (...args) {',
        '    clearTimeout(timer);',
        '    timer = setTimeout(() => fn.apply(this, args), delayMs);',
        '  };',
        '}',
        '```'
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (/fetch|api|http|requisic/.test(lower)) {
      return [
        '```javascript',
        header.trimEnd(),
        `async function ${fnName}(url, options = {}) {`,
        '  const res = await fetch(url, options);',
        '  if (!res.ok) {',
        '    throw new Error(`HTTP ${res.status}`);',
        '  }',
        '  return await res.json();',
        '}',
        '```'
      ]
        .filter(Boolean)
        .join('\n');
    }

    return [
      '```' + lang.toLowerCase(),
      header.trimEnd(),
      `async function ${fnName}(entrada) {`,
      `  // Objetivo: ${prompt.slice(0, 90)}`,
      '  if (entrada == null) {',
      '    throw new Error("Entrada invalida");',
      '  }',
      '  return entrada;',
      '}',
      '```'
    ]
      .filter(Boolean)
      .join('\n');
  }

  stripFrontmatter(content) {
    return String(content || '')
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      .trim();
  }

  _matchTemplates(query, limit = 4) {
    const tpls = this.memory.listTemplates();
    if (!tpls.length) return [];
    const qNorm = ObsidianIndex.normalize(query);
    const terms = ObsidianIndex.tokenize(query);
    const scored = [];
    for (const t of tpls) {
      const nameNorm = ObsidianIndex.normalize(t.name);
      const bodyNorm = ObsidianIndex.normalize(t.content);
      let score = 0;
      if (qNorm && nameNorm.includes(qNorm)) score += 6;
      for (const term of terms) {
        if (nameNorm.includes(term)) score += 4;
        if (bodyNorm.includes(term)) score += 1;
      }
      if (score > 0) scored.push({ t, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.t);
  }

  _extractRelevantLines(rawText, query, maxLines = 6) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return '';
    const terms = Array.from(new Set(ObsidianIndex.tokenize(query)));
    if (!terms.length) return lines.slice(0, maxLines).join('\n');

    const scored = [];
    lines.forEach((line, idx) => {
      const lNorm = ObsidianIndex.normalize(line);
      let score = 0;
      for (const t of terms) {
        if (lNorm.includes(t)) score += 1;
      }
      if (score > 0) scored.push({ line, score, idx });
    });
    if (!scored.length) return lines.slice(0, maxLines).join('\n');
    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
    return scored.slice(0, maxLines).map((s) => s.line).join('\n');
  }

  _collectCurriculoData(query = '') {
    this.documents.syncExternalFiles({ force: true });
    const allDocs = this.documents.list('', { sync: false });
    const cvDocs = allDocs.filter((d) => {
      const cat = ObsidianIndex.normalize(d.category);
      const meta = ObsidianIndex.normalize(`${d.title} ${d.relPath}`);
      return cat === 'curriculos' || /\b(curriculo|curriculum|resume|cv)\b/.test(meta);
    });
    const docHits = cvDocs.length
      ? cvDocs
      : this.documents.search(query || 'curriculo experiencia formacao habilidades', 3, 1000, { sync: false }).map((dh) => dh.document);

    const obsHits = this.obsidian.search(this.getVaultPath(), query || 'curriculo cv experiencia formacao', 3, 500);
    const cvSection = this._extractMarkdownSection(this.loadRootContextMd(), 'resumo de curriculo');
    const memFacts = (this.memory.load().facts || []).filter((f) =>
      /(curriculo|cv|experiencia|formacao|faculdade|stack|linguagem|cargo|empresa|trabalho|projeto)/.test(
        ObsidianIndex.normalize(f.text)
      )
    );
    return { docs: docHits, obsHits, cvSection, memFacts };
  }

  _buildCurriculoOfflineReply(query = '') {
    const { docs, obsHits, cvSection, memFacts } = this._collectCurriculoData(query);
    if (!docs.length && !obsHits.length && !memFacts.length && !cvSection) {
      return (
        'Nenhum dado de curriculo encontrado ainda.\n' +
        'Salve seu curriculo (PDF/MD/TXT) em ./arquivos/Curriculos, adicione fatos com /lembrar ou preencha a Secao 7 em CONTEXTO_IA.md.'
      );
    }
    const out = [query ? `DADOS DE CURRICULO PARA "${query}":` : 'DADOS DE CURRICULO DISPONIVEIS:'];
    if (docs.length) {
      out.push('', 'ARQUIVOS DE CURRICULO:');
      docs.slice(0, 3).forEach((d) => {
        out.push(`- [${d.category}] ${d.title} (${d.relPath})`);
        const excerpt = this._extractRelevantLines(d.textContent || d.summary, query, 6);
        if (excerpt) out.push(excerpt);
      });
    }
    if (memFacts.length) {
      out.push('', 'MEMORIA PROFISSIONAL:');
      memFacts.forEach((f) => out.push(`- ${f.text}`));
    }
    if (obsHits.length) {
      out.push('', 'NOTAS NO OBSIDIAN:');
      obsHits.forEach((h) => out.push(`- [${h.title}] (${h.rel}): ${h.snippet.replace(/\s+/g, ' ').slice(0, 200)}`));
    }
    if (cvSection) {
      out.push('', 'CONTEXTO_IA.md:', cvSection);
    }
    return out.join('\n');
  }

  _handleFastSearchCommand(arg, reply) {
    this.documents.syncExternalFiles({ force: true });
    const startNs = process.hrtime.bigint();
    if (!arg) {
      const docs = this.documents.list('', { sync: false });
      const pdfCount = docs.filter((d) => String(d.ext || '').toLowerCase() === '.pdf' || ObsidianIndex.normalize(d.category) === 'pdfs').length;
      const obsCount = this.obsidian.count(this.getVaultPath());
      const tpls = this.memory.listTemplates();
      const facts = this.memory.load().facts;
      const elapsedMs = (Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(1);
      const txt = [
        `BUSCA ULTRA-RAPIDA (${elapsedMs} ms) — INDICE ATIVO:`,
        `- Documentos em ./arquivos: ${docs.length} (${pdfCount} PDFs)`,
        `- Notas no Obsidian: ${obsCount}`,
        `- Fatos na memoria: ${facts.length}`,
        `- Modelos salvos (/modelo): ${tpls.length}`,
        'Uso: /rapido <termo ou pergunta curta>'
      ].join('\n');
      return reply(txt);
    }

    const docHits = this.documents.search(arg, 5, 220, { sync: false });
    const obsHits = this.obsidian.search(this.getVaultPath(), arg, 4, 200);
    const factHits = this._matchFacts(arg, 5);
    const tplHits = this._matchTemplates(arg, 4);
    const ctxHits = this._searchRootContext(arg, 3);
    const elapsedMs = (Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(1);

    if (!docHits.length && !obsHits.length && !factHits.length && !tplHits.length && !ctxHits.length) {
      return reply(`Busca rapida (${elapsedMs} ms): nenhum resultado para "${arg}".`);
    }

    const out = [`BUSCA RAPIDA (${elapsedMs} ms) PARA "${arg}":`];
    if (docHits.length) {
      out.push('', 'DOCUMENTOS:');
      docHits.forEach((dh) => {
        out.push(`- ${dh.document.summary} (${dh.document.relPath})`);
        if (dh.snippet) out.push(`  Trecho: ${dh.snippet.replace(/\s+/g, ' ').slice(0, 180)}`);
      });
    }
    if (obsHits.length) {
      out.push('', 'OBSIDIAN:');
      obsHits.forEach((oh) => out.push(`- [${oh.title}] (${oh.rel}): ${oh.snippet.replace(/\s+/g, ' ').slice(0, 160)}`));
    }
    if (tplHits.length) {
      out.push('', 'MODELOS SALVOS:');
      tplHits.forEach((t) => out.push(`- [${t.name}]: ${t.content.replace(/\s+/g, ' ').slice(0, 160)}`));
    }
    if (factHits.length) {
      out.push('', 'MEMORIA:');
      factHits.forEach((f) => out.push(`- ${f.text}`));
    }
    if (ctxHits.length) {
      out.push('', 'CONTEXTO_IA.md:');
      ctxHits.forEach((line) => out.push(`- ${line}`));
    }
    const joined = out.join('\n');
    this.lastAssistantText = joined;
    return reply(joined);
  }

  async _handlePdfCommand(arg, ctx, reply) {
    this.documents.syncExternalFiles({ force: true });
    const allPdfs = this.documents
      .list('', { sync: false })
      .filter((d) => String(d.ext || '').toLowerCase() === '.pdf' || ObsidianIndex.normalize(d.category) === 'pdfs');

    if (!allPdfs.length) {
      return reply(
        'Nenhum PDF indexado em ./arquivos ainda.\n' +
        'Coloque seus PDFs na pasta ./arquivos (ou use "Salvar Arquivo") e execute /pdf novamente.'
      );
    }

    if (!arg) {
      const lines = [`PDFs indexados (${allPdfs.length}):`];
      allPdfs.slice(-20).reverse().forEach((d, i) => {
        lines.push(`${i + 1}. ${d.summary} (${d.relPath})`);
      });
      lines.push('', 'Use: /pdf <pergunta ou termo> para consultar o conteudo dos PDFs.');
      const txt = lines.join('\n');
      this.lastAssistantText = txt;
      return reply(txt);
    }

    const searched = this.documents
      .search(arg, 6, 1200, { sync: false })
      .filter((dh) => String(dh.document.ext || '').toLowerCase() === '.pdf' || ObsidianIndex.normalize(dh.document.category) === 'pdfs');
    const targetDocs = searched.length ? searched.map((dh) => dh.document) : allPdfs.slice(-3).reverse();

    const aiCfg = this.getAiConfig();
    if (aiCfg.provider !== 'offline') {
      const extraBlocks = ['CONTEUDO DOS PDFs CONSULTADOS (use exclusivamente estes dados para responder):'];
      targetDocs.slice(0, 3).forEach((d) => {
        extraBlocks.push(`[PDF: ${d.title} | ${d.relPath}]\n${(d.textContent || d.summary || '').slice(0, 2500)}`);
      });
      return await this.runTask(
        'chat',
        `Com base nos PDFs salvos abaixo, responda: ${arg}`,
        Object.assign({}, ctx, { extraContext: extraBlocks.join('\n\n') })
      );
    }

    const lines = [`CONSULTA NOS PDFs PARA "${arg}":`];
    targetDocs.slice(0, 3).forEach((d) => {
      lines.push('', `[${d.category}] ${d.title} (${d.relPath})`);
      if (d.parsedFinancial && d.parsedFinancial.isFinancial) {
        lines.push(this.documents.formatFinancialReport(d, 'extrato'));
      } else {
        const excerpt = this._extractRelevantLines(d.textContent || d.summary, arg, 6) || (d.textContent || d.summary || '').slice(0, 450);
        lines.push(excerpt);
      }
    });
    const txt = lines.join('\n');
    this.lastAssistantText = txt;
    return reply(txt);
  }

  async _handleCurriculoCommand(arg, ctx, reply) {
    if (!arg) {
      const txt = this._buildCurriculoOfflineReply('');
      this.lastAssistantText = txt;
      return reply(txt);
    }

    const aiCfg = this.getAiConfig();
    if (aiCfg.provider !== 'offline') {
      const { docs, obsHits, cvSection, memFacts } = this._collectCurriculoData(arg);
      const extraBlocks = ['DADOS DE CURRICULO DO USUARIO (use apenas estes fatos):'];
      docs.slice(0, 3).forEach((d) => {
        extraBlocks.push(`[${d.title} | ${d.relPath}]\n${(d.textContent || d.summary || '').slice(0, 2200)}`);
      });
      if (memFacts.length) {
        extraBlocks.push('Fatos de memoria:\n' + memFacts.map((f) => `- ${f.text}`).join('\n'));
      }
      if (obsHits.length) {
        obsHits.forEach((h) => extraBlocks.push(`[Obsidian ${h.title}]\n${h.snippet}`));
      }
      if (cvSection) extraBlocks.push(cvSection);
      return await this.runTask(
        'chat',
        `Com base nos dados de curriculo disponiveis, responda: ${arg}`,
        Object.assign({}, ctx, { extraContext: extraBlocks.join('\n\n') })
      );
    }

    const txt = this._buildCurriculoOfflineReply(arg);
    this.lastAssistantText = txt;
    return reply(txt);
  }

  _splitTemplateNameAndExtra(rest) {
    const clean = String(rest || '').trim();
    if (!clean) return { tpl: null, extra: '' };

    for (const sep of ['::', '|', '=>']) {
      const idx = clean.indexOf(sep);
      if (idx > -1) {
        const left = clean.slice(0, idx).trim();
        const right = clean.slice(idx + sep.length).trim();
        const tpl = this.memory.getTemplate(left);
        if (tpl) return { tpl, extra: right };
      }
    }

    const all = this.memory.listTemplates().slice().sort((a, b) => b.name.length - a.name.length);
    const normRest = this.memory._normalizeName(clean);
    for (const t of all) {
      const normName = this.memory._normalizeName(t.name);
      if (!normName) continue;
      if (normRest === normName) return { tpl: t, extra: '' };
      if (normRest.startsWith(`${normName} `)) {
        const extra = clean.slice(t.name.length).replace(/^[\s:|\-,]+/, '').trim();
        return { tpl: t, extra };
      }
    }
    return { tpl: this.memory.getTemplate(clean), extra: '' };
  }

  async _handleTemplateCommand(arg, ctx, reply) {
    const clean = String(arg || '').trim();
    const parts = clean ? clean.match(/^(\S+)\s*([\s\S]*)$/) : null;
    const sub = parts ? ObsidianIndex.normalize(parts[1]) : '';
    const rest = parts ? parts[2].trim() : '';

    if (!clean || /^(listar|lista|list)$/.test(sub)) {
      const tpls = this.memory.listTemplates();
      if (!tpls.length) {
        return reply(
          'Nenhum modelo de texto salvo no chat ainda.\n' +
          'Uso: /modelo salvar <nome> :: <texto> (ou "/modelo salvar <nome>" para guardar a ultima resposta).'
        );
      }
      const txt = [
        `Modelos salvos no chat (${tpls.length}):`,
        ...tpls.map((t, i) => `${i + 1}. [${t.name}] — ${t.content.replace(/\s+/g, ' ').slice(0, 140)}`),
        '',
        'Use: /modelo usar <nome> [ajuste] | /editar <nome> <ajuste>'
      ].join('\n');
      this.lastAssistantText = txt;
      return reply(txt);
    }

    if (/^(salvar|save|criar|add|novo)$/.test(sub)) {
      if (!rest) {
        return reply('Uso: /modelo salvar <nome> :: <texto> (ou "/modelo salvar <nome>" apos uma resposta).');
      }
      let name = '';
      let content = '';
      for (const sep of ['::', '=>', '|']) {
        const idx = rest.indexOf(sep);
        if (idx > -1) {
          name = rest.slice(0, idx).trim();
          content = rest.slice(idx + sep.length).trim();
          break;
        }
      }
      if (!name) {
        const nlMatch = rest.match(/^([^\r\n]+)\r?\n([\s\S]+)$/);
        if (nlMatch) {
          name = nlMatch[1].trim();
          content = nlMatch[2].trim();
        } else {
          name = rest;
          content = this.lastAssistantText || '';
        }
      }
      const saved = this.memory.saveTemplate(name, content);
      if (!saved.ok) return reply(saved.error || 'Informe nome e texto para o modelo.');
      this.lastAssistantText = saved.template.content;
      return reply(
        `Modelo #${saved.index} "${saved.template.name}" ${saved.updated ? 'atualizado' : 'salvo'} no chat (${saved.template.content.length} caracteres).\nUse: /modelo usar ${saved.template.name}`
      );
    }

    if (/^(remover|remove|rm|apagar|del|excluir)$/.test(sub)) {
      if (!rest) return reply('Uso: /modelo remover <nome | numero | tudo>');
      const count = this.memory.removeTemplate(rest);
      return reply(count ? `Modelo(s) removido(s): ${count}.` : 'Modelo nao encontrado.');
    }

    const queryTarget = /^(usar|use|aplicar|abrir|inserir)$/.test(sub) ? rest : clean;
    if (!queryTarget) {
      return reply('Uso: /modelo usar <nome ou numero> [instrucao de ajuste]');
    }
    const { tpl, extra } = this._splitTemplateNameAndExtra(queryTarget);
    if (!tpl) {
      const avail = this.memory.listTemplates().map((t) => t.name).join(', ');
      return reply(
        `Modelo nao encontrado para "${queryTarget}".` +
        (avail ? ` Disponiveis: ${avail}` : ' Use /modelo salvar <nome> :: <texto>.')
      );
    }

    if (!extra) {
      this.lastAssistantText = tpl.content;
      return reply(`[Modelo: ${tpl.name}]\n${tpl.content}`, { templateName: tpl.name });
    }

    const aiCfg = this.getAiConfig();
    if (aiCfg.provider !== 'offline') {
      return await this.runTask(
        'adapt',
        `${extra}\n\nTEXTO ORIGINAL (Modelo "${tpl.name}"):\n${tpl.content}`,
        Object.assign({}, ctx, { extraContext: `Origem do texto: Modelo "${tpl.name}"` })
      );
    }

    const prepared = `[Modelo: ${tpl.name} | Ajuste solicitado: ${extra}]\n${tpl.content}`;
    this.lastAssistantText = tpl.content;
    return reply(prepared, { templateName: tpl.name });
  }

  /**
   * Resolve texto alvo para /revisar, /resumir, /explicar, /traduzir e /adaptar.
   * Suporta texto direto, referencia ao historico ("isso", "acima") ou referencia a documentos/notas ("o que foi enviado para o jorge").
   */
  resolveTextTarget(arg, { task = 'review' } = {}) {
    const cleanArg = String(arg || '').trim();
    const normArg = ObsidianIndex.normalize(cleanArg);
    const words = cleanArg ? cleanArg.split(/\s+/).filter(Boolean) : [];
    const mem = this.memory.load();

    // 1. Sem argumento ou referencia direta ao turno anterior
    const backRefRx = /^(isso|acima|anterior|ultimo|ultima|ultima resposta|ultimo texto|essa resposta|esta resposta|ele|ela)$/;
    if (!cleanArg || backRefRx.test(normArg)) {
      let candidate = this.lastAssistantText || '';
      if (!candidate && mem.history && mem.history.length) {
        const lastHist = mem.history[mem.history.length - 1];
        candidate = (lastHist && lastHist.content) || '';
      }
      if (!candidate) {
        const docs = this.documents.list();
        if (docs.length) {
          const latest = docs[docs.length - 1];
          candidate = latest.textContent || latest.summary || '';
          if (candidate) {
            return {
              text: candidate,
              originLabel: `Documento "${latest.title}" (${latest.relPath})`,
              instruction: cleanArg || ''
            };
          }
        }
      }
      if (!candidate) return { empty: true };
      return { text: candidate, originLabel: 'ultima resposta/conversa', instruction: cleanArg || '' };
    }

    // 1.5 Verifica se o argumento referencia um modelo de texto salvo (/modelo)
    if (mem.templates && mem.templates.length) {
      const sortedTpls = mem.templates.slice().sort((a, b) => b.name.length - a.name.length);
      const matchedTpl = sortedTpls.find((t) => {
        const tNorm = this.memory._normalizeName(t.name);
        return tNorm && (normArg === tNorm || normArg.includes(tNorm));
      });
      if (matchedTpl) {
        return {
          text: matchedTpl.content,
          originLabel: `Modelo "${matchedTpl.name}"`,
          instruction: cleanArg
        };
      }
    }

    // 2. Verifica se o argumento referencia um documento salvo ou nota do Obsidian
    const referentialLead = /^(o\s+que|o\s+texto|a\s+mensagem|a\s+nota|o\s+arquivo|o\s+documento|do\s+|da\s+|dos\s+|das\s+|sobre\s+|para\s+|pro\s+|no\s+|na\s+|enviad[oa]|salvo|salva|documento|arquivo|nota|ultimo|ultima)\b/.test(
      normArg
    );
    const shortLookup = words.length <= 5;
    if (referentialLead || (task !== 'review' && words.length <= 8) || (task === 'review' && shortLookup && words.length <= 3)) {
      const docHits = this.documents.search(cleanArg, 2, 2400);
      if (docHits.length) {
        const doc = docHits[0].document;
        const body = String(doc.textContent || doc.summary || '').trim();
        if (body) {
          return {
            text: body,
            originLabel: `Documento "${doc.title}" (${doc.relPath})`,
            instruction: cleanArg
          };
        }
      }

      const obsHits = this.obsidian.search(this.getVaultPath(), cleanArg, 2, 1800);
      if (obsHits.length) {
        const note = obsHits[0];
        const body = this.stripFrontmatter(note.snippet);
        if (body) {
          return {
            text: body,
            originLabel: `Nota Obsidian "${note.title}" (${note.rel})`,
            instruction: cleanArg
          };
        }
      }
    }

    // 3. Caso para /adaptar com pedido curto (ex: "/adaptar sem acucar"): usa ultima resposta como base
    if (task === 'adapt' && words.length <= 12) {
      let base = this.lastAssistantText || '';
      if (!base && mem.history && mem.history.length) {
        for (let i = mem.history.length - 1; i >= 0; i--) {
          if (mem.history[i].role === 'assistant' && mem.history[i].content) {
            base = mem.history[i].content;
            break;
          }
        }
      }
      if (base) {
        return {
          text: `${cleanArg}\n\nTEXTO BASE:\n${base}`,
          originLabel: 'ultima resposta',
          instruction: cleanArg
        };
      }
    }

    return { text: cleanArg, originLabel: '', instruction: '' };
  }

  async handleCommand(raw, ctx) {
    const m = raw.match(/^\/(\S+)\s*([\s\S]*)$/);
    const rawToken = m ? m[1] : '';
    const arg = (m ? m[2] : '').trim();
    const resolved = resolveSlashCommand(rawToken);
    const reply = (text, extra = {}) => {
      const prefix =
        resolved.autoCorrected && resolved.matched
          ? `[Comando interpretado como /${resolved.matched}]\n`
          : '';
      return Object.assign({ ok: true, text: `${prefix}${text}`, source: 'command' }, extra);
    };
    const aiCfg = this.getAiConfig();

    if (!resolved.matched) {
      const sug = resolved.suggestions && resolved.suggestions.length
        ? ` Voce quis dizer: ${resolved.suggestions.join(', ')}?`
        : '';
      return {
        ok: true,
        text: `Comando desconhecido: /${resolved.rawNorm || rawToken}.${sug} Envie /ajuda para ver os comandos.`,
        source: 'command'
      };
    }

    const cmd = resolved.matched;

    switch (cmd) {
      case 'ajuda':
        return reply(HELP_TEXT);

      case 'status': {
        const s = await this.getStatus();
        const perf = this.getPerformanceProfile();
        const lines = [
          `Motor: ${s.engine}${s.modelName ? ` (${s.modelName})` : ''} | Modo: ${perf.boostLabel}`,
          `Provedor: ${s.provider}`,
          `Modelo encontrado: ${s.modelFound ? 'sim' : 'nao'}`,
          `RAM estimada: HUD ~${perf.memory.totalMpeBaseMb} MB | Total c/ LLM ~${perf.memory.totalMpeWithLlmGb} GB`,
          `Cofre Obsidian: ${s.vaultPath} ${s.vaultExists ? `(${this.obsidian.count(s.vaultPath)} notas)` : '(nao existe)'}`,
          `Documentos na I.A Local: ${s.documents} arquivos (${s.documentsDir})`,
          `Memoria: ${s.facts} fatos, ${s.examples} exemplos`,
          s.error ? `Ultimo erro: ${s.error}` : ''
        ].filter(Boolean);

        // Se o usuario passou um termo (ex: "/status do bolo"), inclui busca rapida em documentos e notas
        if (arg && !/^(motor|geral|tudo|completo)$/i.test(ObsidianIndex.normalize(arg))) {
          const docHits = this.documents.search(arg, 3, 240);
          const obsHits = this.obsidian.search(this.getVaultPath(), arg, 3, 200);
          lines.push('', `BUSCA RAPIDA PARA "${arg}":`);
          if (!docHits.length && !obsHits.length) {
            lines.push('- Nenhum arquivo ou nota encontrado com esse termo.');
          } else {
            docHits.forEach((dh) => lines.push(`- Doc: ${dh.document.summary} (${dh.document.relPath})`));
            obsHits.forEach((oh) => lines.push(`- Obsidian [${oh.title}]: ${oh.snippet.replace(/\s+/g, ' ').slice(0, 140)}`));
          }
        }
        return reply(lines.join('\n'));
      }

      case 'boost': {
        const rawAliasBoost = ['turbo', 'eco', 'balanceado', 'balanced'].includes(resolved.rawNorm)
          ? resolved.rawNorm
          : '';
        const sub = ObsidianIndex.normalize(arg || rawAliasBoost);
        if (!sub || sub === 'on' || sub === 'turbo' || sub === 'max') {
          if (ctx.onStatus) ctx.onStatus('Aplicando modo /boost Turbo...');
          const profile = await this.setBoostMode('turbo', { restartIfOnline: true });
          if (ctx.onStatus) ctx.onStatus('');
          return reply(this.formatBoostReport(profile, 'turbo'));
        }
        if (sub === 'eco' || sub === 'lite' || sub === 'minimo') {
          if (ctx.onStatus) ctx.onStatus('Aplicando modo Eco (baixa RAM)...');
          const profile = await this.setBoostMode('eco', { restartIfOnline: true });
          if (ctx.onStatus) ctx.onStatus('');
          return reply(this.formatBoostReport(profile, 'eco'));
        }
        if (sub === 'balanced' || sub === 'balanceado' || sub === 'normal' || sub === 'auto') {
          if (ctx.onStatus) ctx.onStatus('Aplicando modo Balanceado...');
          const profile = await this.setBoostMode('balanced', { restartIfOnline: true });
          if (ctx.onStatus) ctx.onStatus('');
          return reply(this.formatBoostReport(profile, 'balanced'));
        }
        return reply(this.formatBoostReport(this.getPerformanceProfile(), null));
      }

      case 'kits':
        return reply(this.formatBoostReport(this.getPerformanceProfile(), null));

      case 'iniciar': {
        if (ctx.onStatus) ctx.onStatus('Carregando modelo local na memoria...');
        const ok = await this.engine.ensureStarted(aiCfg);
        if (ctx.onStatus) ctx.onStatus('');
        return reply(ok ? `Motor online: ${this.engine.modelName || 'servidor local'}` : this.offlineNotice(''));
      }

      case 'parar':
        this.engine.stop();
        return reply('Motor local encerrado. Memoria RAM liberada.');

      case 'lembrar': {
        if (!arg) return reply('Uso: /lembrar <fato>');
        const n = this.memory.addFact(arg);
        return reply(`Guardado na memoria (#${n}).`);
      }

      case 'memoria': {
        const facts = this.memory.load().facts;
        if (!facts.length) return reply('Memoria vazia. Use /lembrar <fato>.');
        return reply(facts.map((f, i) => `${i + 1}. ${f.text}`).join('\n'));
      }

      case 'esquecer': {
        if (!arg) return reply('Uso: /esquecer <numero|tudo>');
        const n = this.memory.removeFact(arg.toLowerCase());
        return reply(n ? `Removido(s): ${n}` : 'Item nao encontrado.');
      }

      case 'treinar': {
        const parts = arg.split(/\s*=>\s*/);
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          return reply('Uso: /treinar <pergunta> => <resposta ideal>');
        }
        const n = this.memory.addExample(parts[0], parts.slice(1).join(' => '));
        return reply(`Exemplo de treino #${n} aprendido.`);
      }

      case 'exemplos': {
        const ex = this.memory.load().examples;
        if (!ex.length) return reply('Nenhum exemplo. Use /treinar <pergunta> => <resposta>.');
        return reply(ex.map((e, i) => `${i + 1}. ${e.q}\n   => ${e.a.slice(0, 160)}`).join('\n'));
      }

      case 'desaprender': {
        if (!arg) return reply('Uso: /desaprender <numero|tudo>');
        const n = this.memory.removeExample(arg.toLowerCase());
        return reply(n ? `Removido(s): ${n}` : 'Exemplo nao encontrado.');
      }

      case 'param': {
        if (!arg) {
          const p = this.memory.load().params;
          const lines = Object.keys(AiMemory.PARAM_INFO).map(
            (k) => `${k} = ${p[k] === '' ? '(vazio)' : p[k]}   -- ${AiMemory.PARAM_INFO[k]}`
          );
          lines.push(
            '',
            `Perfis prontos (/param perfil <nome>): ${Object.keys(AiMemory.RESPONSE_PRESETS).join(', ')}`,
            'Dica: /param reset restaura os padroes.'
          );
          return reply(lines.join('\n'));
        }
        const normArg = ObsidianIndex.normalize(arg);
        if (normArg === 'reset' || normArg === 'padrao' || normArg === 'restaurar') {
          this.memory.resetParams();
          return reply('Parametros restaurados para os valores padrao otimizados.');
        }
        const pm = arg.match(/^(\S+)\s*([\s\S]*)$/);
        const pName = ObsidianIndex.normalize(pm[1]);
        const pVal = (pm[2] || '').trim();
        if (pName === 'perfil' || pName === 'preset') {
          if (!pVal) {
            return reply(
              'Perfis disponiveis:\n' +
              Object.entries(AiMemory.RESPONSE_PRESETS)
                .map(([k, v]) => `- ${k}: ${v.label}`)
                .join('\n')
            );
          }
          const pr = this.memory.applyPreset(pVal);
          if (!pr.ok) return reply(pr.error);
          return reply(
            `Perfil aplicado: ${pr.label} (temp=${pr.params.temperatura}, top_p=${pr.params.top_p}, tokens=${pr.params.tokens}, detalhe=${pr.params.detalhe}).`,
            { action: { type: 'set-preset', preset: pr.preset } }
          );
        }
        const res = this.memory.setParam(pm[1], pm[2]);
        return reply(res.ok ? `${res.key} = ${res.value === '' ? '(vazio)' : res.value}` : res.error);
      }

      case 'perfil': {
        if (!arg) {
          return reply(
            'Perfis de resposta (/perfil <nome>):\n' +
            Object.entries(AiMemory.RESPONSE_PRESETS)
              .map(([k, v]) => `- ${k}: ${v.label}`)
              .join('\n')
          );
        }
        const pr = this.memory.applyPreset(arg);
        if (!pr.ok) return reply(pr.error);
        return reply(
          `Perfil aplicado: ${pr.label} (temp=${pr.params.temperatura}, top_p=${pr.params.top_p}, tokens=${pr.params.tokens}, detalhe=${pr.params.detalhe}).`,
          { action: { type: 'set-preset', preset: pr.preset } }
        );
      }

      case 'tom': {
        const allowed = {
          amigavel: 'amigavel',
          neutra: 'neutra',
          neutro: 'neutra',
          profissional: 'profissional',
          conciso: 'conciso',
          tecnico: 'conciso',
          didatico: 'didatico'
        };
        if (!arg) {
          return reply('Uso: /tom <amigavel | neutra | profissional | conciso | didatico>');
        }
        const t = allowed[ObsidianIndex.normalize(arg)];
        if (!t) {
          return reply('Tom invalido. Use: amigavel, neutra, profissional, conciso ou didatico.');
        }
        if (this.configManager && typeof this.configManager.save === 'function') {
          const curProf = (this.getFullConfig().profile) || {};
          if (['amigavel', 'neutra', 'profissional'].includes(t)) {
            this.configManager.save({ profile: Object.assign({}, curProf, { languageTone: t }) });
          }
        }
        return reply(`Tom de resposta ajustado para: ${t}.`, { action: { type: 'set-tone', tone: t } });
      }

      case 'persona': {
        const res = this.memory.setParam('persona', arg);
        return reply(res.ok ? (arg ? 'Persona definida.' : 'Persona removida.') : res.error);
      }

      case 'limpar':
        this.memory.clearHistory();
        return reply('Historico da conversa limpo. Memoria e treino mantidos.');

      case 'vault': {
        if (!arg) return reply(`Cofre atual: ${this.getVaultPath()}`);
        const cfg = this.getFullConfig();
        const obs = Object.assign({}, cfg.obsidian || {}, { vaultPath: arg });
        this.configManager.save({ obsidian: obs });
        this.obsidian.invalidate();
        const vp = this.getVaultPath();
        return reply(`Cofre definido: ${vp} ${fs.existsSync(vp) ? `(${this.obsidian.count(vp)} notas)` : '(pasta nao existe)'}`);
      }

      case 'obsidian': {
        const vault = this.getVaultPath();
        if (!arg) {
          const notes = this.obsidian.build(vault);
          if (!notes.length) return reply(`Cofre vazio (${vault}). Use /salvar para criar notas.`);
          const list = notes.slice(0, 15).map((n, i) => `${i + 1}. [${n.title}] (${n.rel})`).join('\n');
          return reply(`Notas no Obsidian (${notes.length} no total):\n${list}`);
        }
        const hits = this.obsidian.search(vault, arg, 5, 300);
        if (!hits.length) return reply(`Nenhuma nota encontrada para "${arg}".`);
        return reply(hits.map((h) => `[${h.title}]  ${h.rel}\n${h.snippet.replace(/\s+/g, ' ')}`).join('\n\n'));
      }

      case 'rapido':
        return this._handleFastSearchCommand(arg, reply);

      case 'historico': {
        if (arg) {
          const hits = this.history.search(arg, 10);
          if (!hits.length) return reply(`Nada encontrado no historico para "${arg}".`);
          return reply([`HISTORICO PARA "${arg}":`].concat(hits.map((h) => `- ${h.day} ${h.time} [${h.who}][${h.route}] ${h.text.slice(0, 200)}`)).join('\n'));
        }
        const days = this.history.listDays().slice(0, 7);
        if (!days.length) return reply('Nenhuma conversa guardada ainda.');
        return reply(['ULTIMOS DIAS DE CONVERSA:'].concat(days.map((d) => {
          const n = this.history.countDay(d);
          return `- ${d} (${n} ${n === 1 ? 'mensagem' : 'mensagens'})`;
        })).concat(['', 'Use /historico <termo> para buscar.']).join('\n'));
      }

      case 'pdf':
        return this._handlePdfCommand(arg, ctx, reply);

      case 'curriculo':
        return this._handleCurriculoCommand(arg, ctx, reply);

      case 'modelo':
        return this._handleTemplateCommand(arg, ctx, reply);

      case 'buscar': {
        if (!arg) return reply('Uso: /buscar <termo> (procura em Documentos, Obsidian e Memoria)');
        this.documents.syncExternalFiles({ force: true });
        const docHits = this.documents.search(arg, 4, 260, { sync: false });
        const obsHits = this.obsidian.search(this.getVaultPath(), arg, 4, 220);
        const factHits = this._matchFacts(arg, 6);
        const tplHits = this._matchTemplates(arg, 3);
        if (!docHits.length && !obsHits.length && !factHits.length && !tplHits.length) {
          return reply(`Nenhum resultado encontrado para "${arg}".`);
        }
        const out = [`RESULTADOS PARA "${arg}":`];
        if (docHits.length) {
          out.push('', 'DOCUMENTOS (I.A Local):');
          docHits.forEach((dh) => {
            out.push(`- ${dh.document.summary} (${dh.document.relPath})`);
            if (dh.snippet) out.push(`  Trecho: ${dh.snippet.replace(/\s+/g, ' ').slice(0, 180)}`);
          });
        }
        if (obsHits.length) {
          out.push('', 'NOTAS DO OBSIDIAN:');
          obsHits.forEach((oh) => {
            out.push(`- [${oh.title}] (${oh.rel}): ${oh.snippet.replace(/\s+/g, ' ').slice(0, 180)}`);
          });
        }
        if (tplHits.length) {
          out.push('', 'MODELOS SALVOS:');
          tplHits.forEach((t) => out.push(`- [${t.name}]: ${t.content.replace(/\s+/g, ' ').slice(0, 160)}`));
        }
        if (factHits.length) {
          out.push('', 'MEMORIA:');
          factHits.slice(0, 6).forEach((f) => out.push(`- ${f.text}`));
        }
        const joined = out.join('\n');
        this.lastAssistantText = joined;
        return reply(joined);
      }

      case 'salvar': {
        if (!this.lastAssistantText) return reply('Nenhuma resposta para salvar.');
        const res = await this.saveToObsidian({
          title: arg || `MPE IA ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`,
          text: this.lastAssistantText,
          folder: 'Notas/IA',
          tags: ['mpe', 'ia']
        });
        this.obsidian.invalidate();
        return reply(res.ok ? `Salvo: ${res.folder}/${res.fileName}` : 'Falha ao salvar.');
      }

      case 'arquivos': {
        this.documents.syncExternalFiles({ force: true });
        if (!arg) {
          const docs = this.documents.list('', { sync: false });
          if (!docs.length) {
            return reply(
              'Nenhum documento salvo na I.A local ainda.\n' +
              'Coloque seus PDFs, extratos, curriculos ou codigos em ./arquivos ou use o botao "Salvar Arquivo".'
            );
          }
          const lines = [`Documentos organizados (${this.documents.getDocumentsFolder()}):`];
          docs.slice(-20).reverse().forEach((d, idx) => {
            lines.push(`${idx + 1}. ${d.summary} (${d.relPath})`);
          });
          return reply(lines.join('\n'));
        }
        const hits = this.documents.search(arg, 6, 350, { sync: false });
        if (!hits.length) return reply(`Nenhum documento encontrado para "${arg}".`);
        return reply(
          hits
            .map((h) => `${h.document.summary} (${h.document.relPath})\n${h.snippet.replace(/\s+/g, ' ').slice(0, 220)}`)
            .join('\n\n')
        );
      }

      case 'extrato': {
        this.documents.syncExternalFiles({ force: true });
        const hits = this.documents.search(arg || 'extrato saldo lancamento', 4, 800, { sync: false });
        if (!hits.length) {
          return reply('Nenhum extrato encontrado na I.A local. Coloque seu .OFX, .CSV, .PDF ou .TXT em ./arquivos ou use "Salvar Arquivo".');
        }
        const txt = hits.map((h) => this.documents.formatFinancialReport(h.document, 'extrato')).join('\n\n---\n\n');
        this.lastAssistantText = txt;
        return reply(txt);
      }

      case 'saldo': {
        this.documents.syncExternalFiles({ force: true });
        const hits = this.documents.search(arg || 'saldo extrato', 5, 600, { sync: false });
        const withBalance = hits.filter(
          (h) => h.document.parsedFinancial && h.document.parsedFinancial.isFinancial
        );
        const chosen = withBalance.length ? withBalance : hits;
        if (!chosen.length) {
          return reply('Nenhum extrato ou saldo salvo na I.A local ainda.');
        }
        const txt = chosen.map((h) => this.documents.formatFinancialReport(h.document, 'saldo')).join('\n\n');
        this.lastAssistantText = txt;
        return reply(txt);
      }

      case 'recibo': {
        const hits = this.documents.search(arg || 'recibo comprovante pix pagamento', 5, 700);
        if (!hits.length) {
          return reply('Nenhum recibo ou comprovante encontrado na I.A local.');
        }
        const txt = hits.map((h) => this.documents.formatFinancialReport(h.document, 'extrato')).join('\n\n---\n\n');
        this.lastAssistantText = txt;
        return reply(txt);
      }

      case 'salvar-arquivo': {
        const payloadText = this.lastAssistantText;
        if (!payloadText) return reply('Nenhuma resposta recente para salvar como documento.');
        const saved = this.documents.addDocument({
          title: arg || `Arquivo_IA_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`,
          category: 'Auto',
          text: payloadText
        });
        return reply(
          saved.ok
            ? `Salvo na I.A local: ${saved.document.relPath}\n${saved.document.summary}`
            : 'Falha ao salvar documento.'
        );
      }

      case 'revisar': {
        const target = this.resolveTextTarget(arg, { task: 'review' });
        if (target.empty) return reply('Uso: /revisar <texto ou nome de documento salvo>');
        const extraContext = target.originLabel
          ? `Origem do texto: ${target.originLabel}${target.instruction ? `\nPedido: ${target.instruction}` : ''}`
          : '';
        const res = await this.runTask('review', target.text, Object.assign({}, ctx, { extraContext }));
        if (target.originLabel && res && res.text) {
          res.text = `[Origem: ${target.originLabel}]\n${res.text}`;
        }
        return res;
      }

      case 'resumir': {
        const target = this.resolveTextTarget(arg, { task: 'summarize' });
        if (target.empty) return reply('Uso: /resumir <texto ou nome de documento salvo>');
        const extraContext = target.originLabel ? `Origem do texto: ${target.originLabel}` : '';
        const res = await this.runTask('summarize', target.text, Object.assign({}, ctx, { extraContext }));
        if (target.originLabel && res && res.text) {
          res.text = `[Origem: ${target.originLabel}]\n${res.text}`;
        }
        return res;
      }

      case 'explicar': {
        const target = this.resolveTextTarget(arg, { task: 'explain' });
        if (target.empty) return reply('Uso: /explicar <tema, duvida ou nome do arquivo>');
        const extraContext = target.originLabel ? `Origem do texto: ${target.originLabel}` : '';
        return this.runTask('explain', target.text, Object.assign({}, ctx, { extraContext }));
      }

      case 'traduzir': {
        if (!arg) return reply('Uso: /traduzir [idioma] <texto ou documento>');
        return this.runTask('translate', arg, ctx);
      }

      case 'adaptar': {
        const target = this.resolveTextTarget(arg, { task: 'adapt' });
        if (target.empty) return reply('Uso: /editar <instrucao, texto, documento ou modelo salvo>');
        const payloadText =
          target.originLabel && target.instruction && !target.text.includes('TEXTO BASE:')
            ? `${target.instruction}\n\nTEXTO ORIGINAL (${target.originLabel}):\n${target.text}`
            : target.text;
        const extraContext = target.originLabel ? `Origem do texto: ${target.originLabel}` : '';
        const res = await this.runTask('adapt', payloadText, Object.assign({}, ctx, { extraContext }));
        if (target.originLabel && res && res.text && !res.text.startsWith('[Origem:')) {
          res.text = `[Origem: ${target.originLabel}]\n${res.text}`;
        }
        return res;
      }

      case 'codigo':
        if (!arg) return reply('Uso: /codigo <o que a funcao deve fazer>');
        return this.runTask('code', arg, ctx);

      case 'redigir':
        if (!arg) return reply('Uso: /redigir <pedido>');
        return this.runTask('draft', arg, ctx);

      case 'organizar': {
        if (!arg) {
          return reply('Uso: /organizar <texto ou notas para estruturar no padrao Obsidian>');
        }
        return this.runTask('obsidian', arg, ctx);
      }

      default:
        return reply(`Comando desconhecido: /${rawToken}. Envie /ajuda.`);
    }
  }

  // =========================================================================
  // MINI ASSISTENTE (revisao rapida e redacao)
  // =========================================================================
  async reviewText(text) {
    const raw = (text || '').trim();
    if (!raw) {
      return { ok: false, original: '', revised: '', changesCount: 0, summary: 'Nenhum texto informado.' };
    }
    // Nao bloqueia o mini assistente esperando o modelo carregar
    const ready = await this.ensureEngine({ wait: false });
    if (ready) {
      try {
        const p = this.memory.load().params;
        const out = await this.callChat(
          [
            {
              role: 'system',
              content:
                'Voce e um revisor de textos em portugues do Brasil. Corrija ortografia, acentuacao, pontuacao, ' +
                'concordancia e clareza mantendo o sentido. Retorne EXCLUSIVAMENTE o texto revisado.' +
                (p.persona ? `\nInstrucao do usuario: ${p.persona}` : '')
            },
            { role: 'user', content: raw.slice(0, 9000) }
          ],
          { temperature: 0.2, maxTokens: Math.max(256, Math.min(2048, Math.ceil(raw.length / 2.5))) }
        );
        const revised = this.cleanModelOutput(out || '');
        if (revised) {
          return {
            ok: true,
            original: raw,
            revised,
            reviewedText: revised,
            correctionsCount: this.countDiffWords(raw, revised),
            changesCount: this.countDiffWords(raw, revised),
            readabilityScore: 'I.A local',
            summary: 'Revisao executada pelo modelo local.'
          };
        }
      } catch (err) {
        console.warn('[LocalAiService] Modelo indisponivel, usando motor de regras:', err.message);
      }
    }
    return this.builtinGrammarAndStyleReview(raw);
  }

  countDiffWords(a, b) {
    const wa = a.split(/\s+/);
    const wb = new Set(b.split(/\s+/));
    return Math.max(1, wa.filter((w) => !wb.has(w)).length);
  }

  async draftText(prompt, context = '') {
    const cleanPrompt = (prompt || '').trim();
    const out = await this.generate({
      task: 'draft',
      text: context ? `${cleanPrompt}\n\nContexto: ${context}` : cleanPrompt,
      useHistory: false
    }).catch(() => null);
    if (out) return { ok: true, text: out, source: 'llm' };
    const built = this.builtinRespond('draft', cleanPrompt);
    return { ok: true, text: built.text, source: 'builtin' };
  }

  // =========================================================================
  // OBSIDIAN
  // =========================================================================
  classifyForObsidian(text) {
    const raw = (text || '').trim();
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] || 'Nota Sem Titulo';

    let title = firstLine.replace(/^[#\-*0-9.\s]+/, '').slice(0, 50).trim();
    if (!title || title.length < 3) title = `Nota_${new Date().toISOString().slice(0, 10)}`;

    const lower = raw.toLowerCase();
    let folder = 'Notas';
    const tags = ['mpe'];

    if (lower.includes('reuniao') || lower.includes('ata') || lower.includes('alinhamento')) {
      folder = 'Reunioes';
      tags.push('reuniao', 'trabalho');
    } else if (lower.includes('todo') || lower.includes('tarefa') || lower.includes('fazer') || lower.includes('pendencia')) {
      folder = 'Tarefas';
      tags.push('tarefas', 'prioridade');
    } else if (lower.includes('projeto') || lower.includes('escopo') || lower.includes('meta')) {
      folder = 'Projetos';
      tags.push('projeto');
    } else if (lower.includes('ideia') || lower.includes('brainstorm') || lower.includes('insight')) {
      folder = 'Ideias';
      tags.push('ideia', 'criativo');
    } else if (lower.includes('codigo') || lower.includes('bug') || lower.includes('funcao') || lower.includes('api')) {
      folder = 'Desenvolvimento';
      tags.push('dev', 'codigo');
    }

    return {
      ok: true,
      title,
      suggestedTitle: title,
      suggestedFolder: folder,
      suggestedTags: Array.from(new Set(tags)),
      tags: Array.from(new Set(tags))
    };
  }

  async saveToObsidian({ title, content, text, folder, tags, openAfterSave = false }) {
    const aiCfg = this.getAiConfig();
    const vaultPath = this.getVaultPath();

    const safeFolder = (folder || aiCfg.defaultFolder || 'Notas')
      .trim()
      .split(/[\/\\]+/)
      .map((seg) => seg.replace(/[:*?"<>|]/g, '_'))
      .filter((seg) => seg && seg !== '..' && seg !== '.')
      .join(path.sep) || 'Notas';
    const targetDir = path.join(vaultPath, safeFolder);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeTitle = (title || `Nota_${Date.now()}`)
      .trim()
      .replace(/[\/\\:*?"<>|]/g, '')
      .slice(0, 60);

    const fileName = `${safeTitle}.md`;
    const filePath = path.join(targetDir, fileName);

    const tagList = Array.isArray(tags) && tags.length ? tags : ['mpe', 'notas'];
    const noteBody = content || text || '';

    const frontmatter = [
      '---',
      `title: "${safeTitle}"`,
      `date: ${new Date().toISOString()}`,
      `folder: "${safeFolder.replace(/\\/g, '/')}"`,
      `tags: [${tagList.map((t) => (t.startsWith('#') ? t.slice(1) : t)).join(', ')}]`,
      `source: "Katharos Nous | katharos AI"`,
      '---',
      '',
      `# ${safeTitle}`,
      '',
      noteBody,
      ''
    ].join('\n');

    fs.writeFileSync(filePath, frontmatter, 'utf8');
    this.obsidian.invalidate();

    if (openAfterSave) {
      try {
        await shell.openPath(filePath);
      } catch (_) {}
    }

    return { ok: true, filePath, fileName, folder: safeFolder, vaultPath };
  }

  // =========================================================================
  // MOTOR DE REGRAS (fallback offline, ~2ms)
  // =========================================================================
  builtinGrammarAndStyleReview(text) {
    let t = text;
    let changes = 0;
    const originalLen = t.length;

    t = t.replace(/[ \t]+/g, ' ');
    t = t.replace(/\s+([.,;:!?])/g, '$1');
    t = t.replace(/([.,;:!?])(?=[a-zA-Z\u00C0-\u00FF])/g, '$1 ');
    t = t.replace(/\bi\.a\b/gi, 'I.A');
    t = t.replace(/\bvc\b/gi, 'você');
    t = t.replace(/\bvcs\b/gi, 'vocês');
    t = t.replace(/\btbm\b/gi, 'também');
    t = t.replace(/\bpq\b/gi, 'porque');
    t = t.replace(/\bq\b/gi, 'que');
    t = t.replace(/\bp\/\s*/gi, 'para ');
    t = t.replace(/\bp\b/gi, 'para');
    t = t.replace(/\bn\b/gi, 'não');
    t = t.replace(/\bnao\b/gi, 'não');
    t = t.replace(/\bentao\b/gi, 'então');
    t = t.replace(/\bvoce\b/gi, 'você');
    t = t.replace(/\bta\b/gi, 'está');

    t = t.replace(/(^\s*|[.!?]\s+)([a-z\u00E0-\u00FA])/g, (match, prefix, char) => {
      changes++;
      return prefix + char.toUpperCase();
    });

    if (t.length > 5 && !/[.!?]$/.test(t.trim())) {
      t = t.trim() + '.';
      changes++;
    }
    if (Math.abs(t.length - originalLen) > 0) changes++;

    return {
      ok: true,
      original: text,
      revised: t,
      reviewedText: t,
      correctionsCount: Math.max(1, changes),
      changesCount: Math.max(1, changes),
      readabilityScore: 'Regras',
      summary: 'Revisao por regras (modelo local indisponivel).'
    };
  }
}

LocalAiService.resolveSlashCommand = resolveSlashCommand;

module.exports = LocalAiService;
