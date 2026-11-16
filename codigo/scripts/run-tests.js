const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');
const Module = require('module');

const CODE_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

// Shim leve de 'electron' quando executado via Node CLI puro
const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => path.join(os.tmpdir(), `katharos-test-${name}`),
        setAppUserModelId: () => {}
      },
      shell: {
        openExternal: async () => {},
        openPath: async () => '',
        showItemInFolder: () => {}
      },
      clipboard: { writeText: () => {}, writeImage: () => {}, readText: () => '' },
      nativeImage: { createFromDataURL: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }) },
      screen: { getPrimaryDisplay: () => ({ size: { width: 1280, height: 720 }, scaleFactor: 1 }) },
      desktopCapturer: { getSources: async () => [] }
    };
  }
  return origLoad.apply(this, arguments);
};

const ConfigManager = require('../src/main/configManager');
const LlamafileManager = require('../src/main/llamafileManager');
const LocalAiService = require('../src/main/localAiService');
const { resolveRoute } = require('../src/main/routeResolver');
const { nearestCorner, cornerBounds, pickDisplay, edgeDockSide, barBounds, BAR_SIZE } = require('../src/main/cornerSnap');
const ChatHistoryStore = require('../src/main/chatHistoryStore');

// Testes nunca gravam no historico real de conversas do usuario (somente em pastas temporarias)
const REAL_HISTORY_DIR = path.resolve(CODE_DIR, 'data', 'Historico');
const origHistoryAppend = ChatHistoryStore.prototype.append;
ChatHistoryStore.prototype.append = function guardedAppend(entry) {
  if (path.resolve(this.getDir()) === REAL_HISTORY_DIR) return '';
  return origHistoryAppend.call(this, entry);
};

const results = [];

async function runCase(suite, id, name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    const durationMs = Date.now() - start;
    results.push({ suite, id, name, status: 'PASS', durationMs, detail: detail || 'OK' });
    console.log(`[PASS] ${id} (${durationMs}ms) - ${name}: ${detail || 'OK'}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    results.push({ suite, id, name, status: 'FAIL', durationMs, detail: err.message });
    console.error(`[FAIL] ${id} (${durationMs}ms) - ${name}:`, err.message);
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function walkJs(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'bin') continue;
      out.push(...walkJs(full));
    } else if (/\.(js|html|css|json)$/i.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const realHistoryDir = REAL_HISTORY_DIR;
  const listRealHistory = () => (fs.existsSync(realHistoryDir) ? fs.readdirSync(realHistoryDir).map((f) => `${f}:${fs.statSync(path.join(realHistoryDir, f)).size}`).sort().join('|') : '');
  const realHistoryBefore = listRealHistory();
  const realCm = new ConfigManager(ROOT_DIR, CODE_DIR);
  const realCfg = realCm.load();

  // =========================================================================
  // SUITE A: ConfigManager, Tema Katharos & Migracoes
  // =========================================================================
  await runCase('Config & Identidade', 'CFG-01', 'Identidade Sci-Fi, atalho exclusivo e caminhos Katharos ativos', () => {
    assert.strictEqual(realCfg.theme.preset, 'katharos-scifi');
    assert.strictEqual(realCfg.system.fallbackKeyboardShortcut, 'CommandOrControl+Shift+J');
    assert.ok(!realCfg.system.triggerShortcut.includes('Alt'), 'Atalho Win32 da Katharos nao deve conter Alt');
    assert.strictEqual(realCfg.ai.modelsDir, './codigo/models');
    assert.strictEqual(realCfg.obsidian.vaultPath, './arquivos/Obsidian_Vault');
    return `preset=${realCfg.theme.preset}, shortcut=${realCfg.system.triggerShortcut}, fallback=${realCfg.system.fallbackKeyboardShortcut}`;
  });

  await runCase('Config & Identidade', 'CFG-02', 'Migracao automatica de caminhos legados, tema gold-obsidian e isolamento sem astrolabio', () => {
    const tmpRoot = makeTempDir('katharos-cfg-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    fs.writeFileSync(
      path.join(tmpCode, 'mpe.config.json'),
      JSON.stringify({
        profile: { userName: 'Teste', isRegistered: true },
        theme: { preset: 'gold-obsidian' },
        captures: { documentsFolder: './documentos' },
        obsidian: { vaultPath: './Obsidian_Vault' },
        ai: { provider: 'auto', modelsDir: './models' },
        points: [{ id: 'p1', code: '01 1', title: 'Print', actionType: 'print' }],
        organizer: { lastActiveTab: 'astrolabe' }
      }),
      'utf8'
    );
    const cm = new ConfigManager(tmpRoot, tmpCode);
    const loaded = cm.load();
    try {
      assert.strictEqual(loaded.theme.preset, 'katharos-scifi');
      assert.strictEqual(loaded.captures.documentsFolder, './arquivos');
      assert.strictEqual(loaded.obsidian.vaultPath, './arquivos/Obsidian_Vault');
      assert.strictEqual(loaded.ai.modelsDir, './codigo/models');
      assert.strictEqual(loaded.points, undefined);
      assert.strictEqual(loaded.organizer, undefined);
      return `tema=${loaded.theme.preset}, docs=${loaded.captures.documentsFolder}, vault=${loaded.obsidian.vaultPath}`;
    } finally {
      rmSafe(tmpRoot);
    }
  });
  // =========================================================================
  // SUITE B: Motor I.A Local (Mozilla llamafile + LocalAiService)
  // =========================================================================
  await runCase('I.A Local (llamafile)', 'AI-01', 'Binario llamafile.exe e modelo GGUF presentes e <= 15 GB', () => {
    const modelsDir = path.join(CODE_DIR, 'models');
    const files = fs.readdirSync(modelsDir).filter((f) => fs.statSync(path.join(modelsDir, f)).isFile());
    const totalBytes = files.reduce((acc, f) => acc + fs.statSync(path.join(modelsDir, f)).size, 0);
    const totalGb = totalBytes / (1024 ** 3);
    const mgr = new LlamafileManager(ROOT_DIR, CODE_DIR);
    const found = mgr.findModel(realCfg.ai);
    assert.ok(found && found.exe && found.gguf, 'Par llamafile.exe + .gguf nao detectado');
    assert.ok(totalGb > 0.5 && totalGb <= 15, `Tamanho fora do limite: ${totalGb.toFixed(2)} GB`);
    return `${found.name} + llamafile.exe (${totalGb.toFixed(2)} GB <= 15 GB)`;
  });

  await runCase('I.A Local (llamafile)', 'AI-02', 'ping() rejeita HTML 404 (protecao contra servidor Apache/IIS na porta)', async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"><html><head><title>404 Not Found</title></head><body>Not Found</body></html>');
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const mgr = new LlamafileManager(ROOT_DIR, CODE_DIR);
      const status = await mgr.ping(port, 1200);
      assert.strictEqual(status, 'fail', `ping deveria retornar fail para HTML 404, retornou ${status}`);
      return `Porta mock ${port} (HTML 404) rejeitada como '${status}'`;
    } finally {
      srv.close();
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-03', 'findFreePort() ignora porta ocupada e seleciona porta livre', async () => {
    const blocker = http.createServer((_req, res) => res.end('busy'));
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    const busyPort = blocker.address().port;
    try {
      const mgr = new LlamafileManager(ROOT_DIR, CODE_DIR);
      const chosen = await mgr.findFreePort(busyPort);
      assert.notStrictEqual(chosen, busyPort);
      assert.strictEqual(await mgr.isPortAvailable(chosen), true);
      return `Ocupada=${busyPort} -> Livre escolhida=${chosen}`;
    } finally {
      blocker.close();
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-04', 'cleanModelOutput() remove blocos internos <think>...</think>', () => {
    const svc = new LocalAiService(ROOT_DIR, realCm, CODE_DIR);
    const cleaned = svc.cleanModelOutput('<think>raciocinio oculto</think>\n\nResposta final objetiva.');
    assert.strictEqual(cleaned, 'Resposta final objetiva.');
    return `Output limpo: "${cleaned}"`;
  });

  await runCase('I.A Local (llamafile)', 'AI-05', 'Comandos slash (/ajuda, /status) e revisao offline (< 50ms)', async () => {
    const svc = new LocalAiService(ROOT_DIR, realCm, CODE_DIR);
    const helpRes = await svc.chat({ message: '/ajuda' });
    assert.ok(helpRes.ok && helpRes.source === 'command' && helpRes.text.includes('COMANDOS'));
    const rev = svc.builtinGrammarAndStyleReview('este e um texto de teste sem ponto');
    assert.ok(rev.ok && rev.revised.startsWith('Este') && rev.revised.endsWith('.'));
    const obs = svc.classifyForObsidian('Ata de reuniao sobre meta do projeto');
    assert.ok(obs.ok && obs.suggestedFolder === 'Reunioes');
    return `Help OK, Revisao="${rev.revised}", ObsidianFolder=${obs.suggestedFolder}`;
  });

  await runCase('I.A Local (llamafile)', 'AI-06', 'Inferencia LLM real via llamafile + Qwen2.5-7B-Instruct (/v1/chat/completions)', async () => {
    if (process.env.KATHAROS_SKIP_LLM === '1') return 'PULADO (KATHAROS_SKIP_LLM=1)';
    const svc = new LocalAiService(ROOT_DIR, realCm, CODE_DIR);
    // Isola historico/persistencia em memoria para nao enviar turnos antigos da sessao desktop nem sujar data/ai-memory.json
    const mem = svc.memory.load();
    svc.memory.save = () => {};
    mem.history = [];
    mem.facts = [];
    mem.examples = [];
    mem.templates = [];
    mem.params.tokens = 48;
    mem.params.historico = 0;
    mem.params.obsidian = 'off';
    mem.params.documentos = 'off';
    try {
      const res = await svc.chat({ message: 'Responda em uma frase curta: do que a agua e feita?', tone: 'amigavel', mode: 'chat' });
      assert.ok(res.ok, 'Resposta de chat falhou');
      assert.strictEqual(res.source, 'llm', `Esperado source=llm, obtido ${res.source}: ${res.text}`);
      assert.ok(/hidrog|H2O|oxig/i.test(res.text), `Conteudo inesperado: ${res.text}`);
      const status = await svc.getStatus(false);
      assert.strictEqual(status.ready, true);
      assert.ok(['online', 'external'].includes(status.engine), `Estado inesperado do motor: ${status.engine}`);
      return `source=${res.source}, engine=${status.engine}, modelo=${status.modelName}, resposta="${res.text.slice(0, 85).replace(/\s+/g, ' ')}"`;
    } finally {
      svc.shutdown();
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-07', 'Calculo de memoria/velocidade, kits minimos e comando /boost', async () => {
    const tmpRoot = makeTempDir('mpe-boost-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    const cm = new ConfigManager(tmpRoot, tmpCode);
    cm.load();
    const svc = new LocalAiService(tmpRoot, cm, tmpCode);
    try {
      const kitsRes = await svc.chat({ message: '/kits' });
      assert.ok(kitsRes.ok && kitsRes.source === 'command');
      assert.ok(kitsRes.text.includes('CALCULO DE MEMORIA RAM') && kitsRes.text.includes('KITS MINIMOS'));

      const ecoProf = await svc.setBoostMode('eco', { restartIfOnline: false });
      assert.strictEqual(ecoProf.boostMode, 'eco');
      assert.strictEqual(ecoProf.tuning.contextSize, 2048);

      const turboRes = await svc.chat({ message: '/boost turbo' });
      assert.ok(turboRes.ok && turboRes.text.includes('Turbo (/boost)'));
      const turboProf = svc.getPerformanceProfile();
      assert.strictEqual(turboProf.boostMode, 'turbo');
      assert.strictEqual(turboProf.speed.lastLoadMs, 0);
      assert.ok(Array.isArray(turboProf.kits) && turboProf.kits.length === 4);
      assert.strictEqual(typeof svc.engine.stopAsync, 'function');
      return `eco(ctx=${ecoProf.tuning.contextSize}), turbo(threads=${turboProf.tuning.threads}/${turboProf.tuning.threadsBatch}), kits=${turboProf.kits.length}, RAM=${turboProf.hardware.totalRamGb}GB`;
    } finally {
      rmSafe(tmpRoot);
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-08', 'Roteador de comandos / (aliases, fuzzy, /status termo, /revise referencia doc e /organizar)', async () => {
    const tmpRoot = makeTempDir('mpe-slash-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    const cm = new ConfigManager(tmpRoot, tmpCode);
    const cfg = cm.load();
    cfg.ai.provider = 'offline';
    cm.save(cfg);

    const svc = new LocalAiService(tmpRoot, cm, tmpCode);
    try {
      // Salva documento "bolo do jorge" simulando o cenario real
      svc.saveDocumentFile({ title: 'bolo do jorge', category: 'Geral', text: 'quero uma ravisão de bolo' });

      // 1. Fuzzy & prefixo
      const rAjud = LocalAiService.resolveSlashCommand('ajud');
      assert.strictEqual(rAjud.matched, 'ajuda');
      assert.strictEqual(rAjud.autoCorrected, true);

      const rTypo = LocalAiService.resolveSlashCommand('stauts');
      assert.strictEqual(rTypo.matched, 'status');
      assert.strictEqual(rTypo.autoCorrected, true);

      // Comandos destrutivos nao devem rodar por fuzzy automatico
      const rDest = LocalAiService.resolveSlashCommand('par');
      assert.strictEqual(rDest.matched, null);

      // 2. /status do bolo inclui busca rapida pelo termo
      const stBolo = await svc.chat({ message: '/status do bolo' });
      assert.ok(stBolo.ok && stBolo.text.includes('BUSCA RAPIDA PARA "do bolo"') && stBolo.text.includes('bolo do jorge'));

      // 3. /revise o que foi enviado para o jorge encontra o documento e revisa o conteudo dele
      const revJorge = await svc.chat({ message: '/revise o que foi enviado para o jorge' });
      assert.ok(revJorge.ok, 'Falha em /revise referencial');
      assert.ok(revJorge.text.includes('bolo do jorge'), 'Deveria informar origem do documento');
      assert.ok(revJorge.text.includes('ravisão') || revJorge.text.includes('Quero uma'), 'Deveria revisar o texto do documento');

      // 4. /buscar unificado e /organizar notas no padrao Obsidian
      const buscar = await svc.chat({ message: '/buscar bolo' });
      assert.ok(buscar.ok && buscar.text.includes('DOCUMENTOS') && buscar.text.includes('bolo do jorge'));

      const orgEmpty = await svc.chat({ message: '/organizar' });
      assert.ok(orgEmpty.ok && orgEmpty.text.includes('Obsidian'));
      const orgNotes = await svc.chat({ message: '/organizar anotacao rapida de reuniao sobre metas 2026' });
      assert.ok(orgNotes.ok && orgNotes.text.trim().length > 0 && !orgNotes.action);

      // 5. /tom e /perfil
      const tomRes = await svc.chat({ message: '/tom neutra' });
      assert.ok(tomRes.ok && tomRes.action && tomRes.action.type === 'set-tone' && tomRes.action.tone === 'neutra');

      const unkRes = await svc.chat({ message: '/revissarx algo' });
      assert.ok(unkRes.ok && unkRes.text.includes('Voce quis dizer:'));

      return 'Aliases, fuzzy (/ajud, /stauts), /status termo, /revise referencia doc, /buscar, /organizar e /tom validados';
    } finally {
      rmSafe(tmpRoot);
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-09', 'Parametros de resposta (top_p, repeat_penalty, /perfil) + retry HTTP 503 sem fallback indevido', async () => {
    const tmpRoot = makeTempDir('mpe-params-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    let hits = 0;
    let lastPayload = null;

    const srv = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-qwen' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          hits++;
          lastPayload = JSON.parse(body);
          if (hits === 1) {
            // Simula 503 transitorio (ex: slot ocupado apos /boost) na 1a tentativa
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Loading model' } }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: 'Receita de bolo pronta para o Jorge com cobertura de chocolate.' } }]
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;

    const cm = new ConfigManager(tmpRoot, tmpCode);
    const cfg = cm.load();
    cfg.ai.provider = 'lmstudio';
    cfg.ai.endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
    cm.save(cfg);

    const svc = new LocalAiService(tmpRoot, cm, tmpCode);
    try {
      const pRes = await svc.chat({ message: '/param perfil criativo' });
      assert.ok(pRes.ok && pRes.text.includes('Criativo'), 'Perfil criativo falhou');

      const aliasRes = await svc.chat({ message: '/param repeticao 1.18' });
      assert.ok(aliasRes.ok && aliasRes.text.includes('repeat_penalty = 1.18'), 'Alias repeticao falhou');

      // Simula provider auto com retry transitorio mudando temporariamente para mock em porta local
      svc.engine.ping = async () => 'ok';
      cfg.ai.provider = 'auto';
      cfg.ai.port = port;
      cm.save(cfg);

      const reply = await svc.chat({ message: 'pode adaptar', tone: 'neutra', mode: 'free' });
      assert.strictEqual(reply.source, 'llm', `Esperado source=llm apos retry, obtido ${reply.source}`);
      assert.strictEqual(hits, 2, `Esperado 2 tentativas (503 -> 200), obteve ${hits}`);
      assert.strictEqual(lastPayload.repeat_penalty, 1.18);
      assert.strictEqual(lastPayload.top_p, 0.95);
      assert.strictEqual(lastPayload.max_tokens, 1400);
      assert.ok(lastPayload.messages[0].content.includes('neutro, equilibrado'), 'Tone neutra ausente no system prompt');
      return `Retry 503->200 OK, payload top_p=${lastPayload.top_p}, repeat_penalty=${lastPayload.repeat_penalty}, max_tokens=${lastPayload.max_tokens}`;
    } finally {
      srv.close();
      rmSafe(tmpRoot);
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-10', 'CONTEXTO_IA.md raiz, busca rapida (/rapido), PDF FlateDecode (/pdf), extratos, curriculos (/curriculo), codigos e modelos (/modelo, /editar)', async () => {
    const svcReal = new LocalAiService(ROOT_DIR, realCm, CODE_DIR);
    const rootMd = svcReal.loadRootContextMd();
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'CONTEXTO_IA.md')), 'CONTEXTO_IA.md ausente na raiz do Katharos');
    assert.ok(rootMd.includes('CONTEXTO OPERACIONAL') && rootMd.includes('/rapido') && rootMd.includes('/modelo'), 'Conteudo esperado ausente em CONTEXTO_IA.md');
    const realMsgs = svcReal.buildMessages({ task: 'chat', text: 'teste contexto', tone: 'profissional' });
    assert.ok(realMsgs[0].content.includes('CONTEXTO RAIZ (CONTEXTO_IA.md):'), 'CONTEXTO_IA.md nao injetado no prompt da I.A');

    const tmpRoot = makeTempDir('katharos-ctx-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    const tmpDocs = path.join(tmpRoot, 'arquivos');
    fs.mkdirSync(tmpCode, { recursive: true });
    fs.mkdirSync(path.join(tmpDocs, 'PDFs'), { recursive: true });
    fs.mkdirSync(path.join(tmpDocs, 'Codigos'), { recursive: true });
    fs.copyFileSync(path.join(ROOT_DIR, 'CONTEXTO_IA.md'), path.join(tmpRoot, 'CONTEXTO_IA.md'));

    const cm = new ConfigManager(tmpRoot, tmpCode);
    const cfg = cm.load();
    cfg.ai.provider = 'offline';
    cfg.captures.documentsFolder = './arquivos';
    cm.save(cfg);

    // 1. PDF com stream comprimido FlateDecode em ./arquivos/PDFs
    const compressedPdfStream = zlib.deflateSync(
      Buffer.from('BT /F1 12 Tf 72 720 Td (Contrato Katharos clausula 4 multa rescisoria 10 porcento) Tj ET', 'latin1')
    );
    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressedPdfStream.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
      compressedPdfStream,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')
    ]);
    fs.writeFileSync(path.join(tmpDocs, 'PDFs', 'contrato_flate.pdf'), pdfBuffer);

    // 2. Arquivo de codigo em ./arquivos/Codigos
    fs.writeFileSync(
      path.join(tmpDocs, 'Codigos', 'importador.js'),
      'function parseExtratoBancario(linhas) { return linhas.filter(Boolean); }\nmodule.exports = { parseExtratoBancario };\n',
      'utf8'
    );

    const svc = new LocalAiService(tmpRoot, cm, tmpCode);
    try {
      // 3. Extrato bancario e Curriculo
      svc.saveDocumentFile({
        title: 'extrato_banco_mar2026',
        category: 'Auto',
        text: 'Banco Estrela Conta 123\n01/03/2026 Pix recebido salario +R$ 2.500,00\n02/03/2026 Pagamento energia -R$ 320,00\nSaldo Disponivel: R$ 4.850,00'
      });
      const cvRes = svc.saveDocumentFile({
        title: 'curriculo_leo',
        category: 'Auto',
        text: 'Experiencia profissional: Desenvolvedor Senior Node.js e Electron.\nHabilidades tecnicas: JavaScript, Python, C#, SQL.'
      });
      assert.strictEqual(cvRes.document.category, 'Curriculos', `Categoria esperada Curriculos, obteve ${cvRes.document.category}`);

      // Teste /rapido (auto-indexou o PDF FlateDecode e busca sub-ms)
      const fastRes = await svc.chat({ message: '/rapido multa rescisoria' });
      assert.ok(fastRes.ok && fastRes.source === 'command' && fastRes.text.includes('BUSCA RAPIDA'), 'Falha em /rapido');
      assert.ok(fastRes.text.includes('contrato_flate'), 'PDF FlateDecode nao encontrado via /rapido');

      // Teste /pdf (listar + questionar)
      const pdfList = await svc.chat({ message: '/pdf' });
      assert.ok(pdfList.ok && pdfList.text.includes('contrato_flate'), '/pdf sem argumento deveria listar contrato_flate');
      const pdfAsk = await svc.chat({ message: '/pdf qual a multa na clausula 4?' });
      assert.ok(pdfAsk.ok && pdfAsk.text.includes('multa rescisoria 10 porcento'), 'Falha ao extrair/responder stream FlateDecode em /pdf');

      // Teste /extrato e pergunta natural sobre valores de extrato
      const extRes = await svc.chat({ message: '/extrato' });
      assert.ok(extRes.ok && extRes.text.includes('4.850,00') && extRes.text.includes('2.500,00'), 'Falha em /extrato');
      const valAsk = await svc.chat({ message: 'quais os valores do extrato?' });
      assert.ok(valAsk.ok && valAsk.text.includes('4.850,00') && valAsk.text.includes('320,00'), 'Falha em consulta natural de valores do extrato');

      // Teste /curriculo e /codigo
      const cvAsk = await svc.chat({ message: '/curriculo habilidades e experiencia' });
      assert.ok(cvAsk.ok && cvAsk.text.includes('Node.js') && cvAsk.text.includes('Electron'), 'Falha em /curriculo');
      const codeAsk = await svc.chat({ message: '/codigo explicar parseExtratoBancario importador' });
      assert.ok(codeAsk.ok && codeAsk.text.includes('parseExtratoBancario'), 'Falha em consulta de codigo salvo via /codigo');

      // Teste /modelo (salvar, listar, usar) e /editar diretamente no chat
      const tplSave = await svc.chat({ message: '/modelo salvar cobranca :: Ola cliente, segue boleto com vencimento dia 10.' });
      assert.ok(tplSave.ok && tplSave.text.includes('cobranca') && tplSave.text.includes('salvo'), 'Falha em /modelo salvar');
      const tplList = await svc.chat({ message: '/modelo listar' });
      assert.ok(tplList.ok && tplList.text.includes('cobranca'), 'Falha em /modelo listar');
      const tplUse = await svc.chat({ message: '/modelo usar cobranca' });
      assert.ok(tplUse.ok && tplUse.text.includes('vencimento dia 10'), 'Falha em /modelo usar');
      const editRes = await svc.chat({ message: '/editar cobranca alterar vencimento para dia 15' });
      assert.ok(editRes.ok && editRes.text.includes('Modelo "cobranca"') && editRes.text.includes('vencimento dia 10'), 'Falha em /editar sobre modelo no chat');

      return 'CONTEXTO_IA.md, /rapido, PDF FlateDecode, /extrato, /curriculo, /codigo, /modelo e /editar validados';
    } finally {
      rmSafe(tmpRoot);
    }
  });

  // =========================================================================
  // =========================================================================
  // SUITE C: Integridade Estatica, Binarios Nativos & Regras AGENTS.md
  // =========================================================================
  await runCase('Integridade & AGENTS.md', 'SYS-01', 'Sintaxe Node valida em todos os arquivos JS do projeto', () => {
    const jsFiles = walkJs(path.join(CODE_DIR, 'src')).filter((f) => f.endsWith('.js'));
    for (const f of jsFiles) {
      execSync(`node -c "${f}"`, { stdio: 'pipe' });
    }
    return `${jsFiles.length} arquivos JS validados com node -c`;
  });

  await runCase('Integridade & AGENTS.md', 'SYS-02', 'Zero emojis em codigo, HTML, CSS e JSON', () => {
    const files = walkJs(path.join(CODE_DIR, 'src')).concat([
      path.join(CODE_DIR, 'mpe.config.json'),
      path.join(CODE_DIR, 'models', 'README.txt'),
      path.join(ROOT_DIR, 'CONTEXTO_IA.md'),
      path.join(ROOT_DIR, 'AGENTS.md')
    ]).filter((f) => fs.existsSync(f));
    const emojiRe = /\p{Extended_Pictographic}/gu;
    let hits = 0;
    for (const f of files) {
      const txt = fs.readFileSync(f, 'utf8');
      if (emojiRe.test(txt)) hits++;
    }
    assert.strictEqual(hits, 0, `Encontrados arquivos com emojis: ${hits}`);
    return `${files.length} arquivos auditados com 0 emojis`;
  });

  await runCase('Integridade & AGENTS.md', 'SYS-03', 'AppUserModelId, setAppDetails, hook exclusivo Katharos e binarios Win32 presentes', () => {
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    const launcherCs = fs.readFileSync(path.join(CODE_DIR, 'src', 'native', 'MpeLauncher.cs'), 'utf8');
    const hookCs = fs.readFileSync(path.join(CODE_DIR, 'src', 'native', 'MpeHook.cs'), 'utf8');
    const hasAumidConst = mainJs.includes("'DevFLeo.KatharosNousAI'");
    const aumidIdx = mainJs.indexOf('app.setAppUserModelId(');
    const winIdx = mainJs.indexOf('new BrowserWindow');
    assert.ok(hasAumidConst && aumidIdx > 0 && aumidIdx < winIdx, 'AUMID deve vir antes de createWindow/BrowserWindow');
    assert.ok(mainJs.includes('mainWindow.setAppDetails(') && mainJs.includes('Katharos.exe'), 'setAppDetails com Katharos.exe obrigatorio');
    assert.ok(launcherCs.includes('IPropertyStore') && launcherCs.includes('DevFLeo.KatharosNousAI') && launcherCs.includes('Katharos.exe'), 'MpeLauncher.cs deve apontar para Katharos.exe e AUMID DevFLeo.KatharosNousAI');
    assert.ok(hookCs.includes('TRIGGER_MINI|') && !hookCs.includes('TRIGGER_HUD|'), 'MpeHook.cs do Artharos deve emitir somente TRIGGER_MINI| e nunca TRIGGER_HUD|');
    assert.ok(fs.existsSync(path.join(CODE_DIR, 'src', 'native', 'bin', 'MpeHook.exe')), 'MpeHook.exe ausente');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'Katharos.exe')), 'Katharos.exe ausente');
    assert.ok(fs.existsSync(path.join(CODE_DIR, 'assets', 'icon.ico')), 'icon.ico ausente');
    return 'AUMID DevFLeo.KatharosNousAI + hook exclusivo TRIGGER_MINI|; Katharos.exe, MpeHook.exe e icon.ico presentes';
  });

  await runCase('Integridade & AGENTS.md', 'SYS-04', 'DOM completo do Katharos Nous | katharos AI sem acoplamento ao Astrolabio', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    assert.ok(html.includes('Katharos Nous | katharos AI'), 'Titulo Katharos Nous | katharos AI ausente');
    const requiredIds = [
      'mini-assistant-overlay',
      'kataros-mascot-canvas',
      'mini-ai-textarea',
      'btn-mini-review',
      'btn-mini-guide',
      'btn-mini-settings',
      'btn-mini-chat-toggle',
      'side-chat-drawer',
      'side-ai-preset',
      'modal-save-ai-file',
      'modal-settings',
      'cfg-start-windows',
      'cfg-ai-boost',
      'modal-guide',
      'btn-guide-open-chat',
      'btn-guide-repair-shortcut'
    ];
    for (const id of requiredIds) {
      assert.ok(html.includes(`id="${id}"`), `ID obrigatorio ausente no HTML: ${id}`);
    }
    assert.ok(!html.includes('id="modal-point"') && !html.includes('id="organizer-workspace"'), 'HTML do Katharos nao deve incluir modais exclusivos do M.P.E');
    return `Todos os ${requiredIds.length} IDs estruturais do Katharos Nous presentes`;
  });

  // =========================================================================
  // SUITE R: Rotas (Perguntar / Procurar / Guardar), canto da janela e historico
  // =========================================================================
  await runCase('Rotas', 'R1', 'codigo @ia define rota ia', () => {
    const r = resolveRoute('@ia qual meu saldo?', 'local');
    assert.deepStrictEqual(r, { route: 'ia', cleanText: 'qual meu saldo?', source: 'code' });
  });
  await runCase('Rotas', 'R2', 'maiusculas e espacos extras', () => {
    assert.strictEqual(resolveRoute('@IA  oi').cleanText, 'oi');
    assert.strictEqual(resolveRoute('@Nota\nreceita').route, 'nota');
    assert.strictEqual(resolveRoute('@local\n').cleanText, '');
  });
  await runCase('Rotas', 'R3', 'aliases em portugues', () => {
    assert.strictEqual(resolveRoute('@procurar multa').route, 'local');
    assert.strictEqual(resolveRoute('@guardar x').route, 'nota');
    assert.strictEqual(resolveRoute('@perguntar x').route, 'ia');
  });
  await runCase('Rotas', 'R4', 'comandos / escolhem rota', () => {
    assert.deepStrictEqual(resolveRoute('/buscar extrato'), { route: 'local', cleanText: '/buscar extrato', source: 'command' });
    assert.strictEqual(resolveRoute('/lembrar fato').route, 'nota');
    assert.strictEqual(resolveRoute('/resumir pdf').route, 'ia');
  });
  await runCase('Rotas', 'R5', 'sem codigo usa o padrao', () => {
    assert.deepStrictEqual(resolveRoute('oi', 'nota'), { route: 'nota', cleanText: 'oi', source: 'default' });
    assert.strictEqual(resolveRoute('oi').route, 'ia');
    assert.strictEqual(resolveRoute('email@local.com').source, 'default');
  });
  const makeIsolatedSvc = () => {
    const tmpRoot = makeTempDir('katharos-rota-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    const cm = new ConfigManager(tmpRoot, tmpCode);
    const cfg = cm.load();
    cfg.ai.provider = 'offline';
    cm.save(cfg);
    const svc = new LocalAiService(tmpRoot, cm, tmpCode);
    return { svc, cm, tmpRoot, tmpCode };
  };
  await runCase('Rotas', 'R6', 'chat @local busca sem LLM', async () => {
    const { svc, tmpRoot } = makeIsolatedSvc();
    try {
      let llmCalls = 0;
      svc.runTask = async () => { llmCalls++; return { ok: true, text: 'x' }; };
      const res = await svc.chat({ message: '@local extrato' });
      assert.strictEqual(res.route, 'local');
      assert.strictEqual(llmCalls, 0);
      assert.ok(res.text.startsWith('Busca nos seus arquivos'), res.text);
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'R7', 'chat @nota grava e nao chama LLM', async () => {
    const { svc, tmpRoot } = makeIsolatedSvc();
    try {
      let llmCalls = 0;
      svc.runTask = async () => { llmCalls++; return { ok: true, text: 'x' }; };
      svc.saveToObsidian = async ({ title }) => ({ ok: true, fileName: title + '.md', folder: 'Katharos_Notas' });
      const res = await svc.chat({ message: '@nota Bolo da vo: 3 ovos' });
      assert.strictEqual(res.route, 'nota');
      assert.ok(res.ok);
      assert.ok(res.text.includes('Guardei'), res.text);
      assert.strictEqual(llmCalls, 0);
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'R8', 'codigo vazio e falha ao guardar', async () => {
    const { svc, tmpRoot } = makeIsolatedSvc();
    try {
      const r1 = await svc.chat({ message: '@local' });
      assert.strictEqual(r1.ok, false);
      assert.ok(r1.text.includes('encontrar'), r1.text);
      svc.saveToObsidian = async () => ({ ok: false, error: 'Cofre inacessivel' });
      const r2 = await svc.chat({ message: 'texto', route: 'nota' });
      assert.strictEqual(r2.ok, false);
      assert.ok(r2.text.includes('Cofre inacessivel'), r2.text);
      svc.saveToObsidian = async () => { throw new Error('disco cheio'); };
      const r3 = await svc.chat({ message: 'outro', route: 'nota' });
      assert.strictEqual(r3.ok, false);
      assert.ok(r3.text.includes('disco cheio'), r3.text);
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'C9', 'chave ui com padroes em config antigo', () => {
    const tmpRoot = makeTempDir('katharos-ui-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    fs.writeFileSync(path.join(tmpCode, 'mpe.config.json'), JSON.stringify({ profile: { userName: 'X' } }), 'utf8');
    try {
      const loaded = new ConfigManager(tmpRoot, tmpCode).load();
      assert.deepStrictEqual(loaded.ui, { defaultRoute: 'ia', largeText: false, showCharts: true, miniCorner: null, dock: null });
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'C10', 'ui preservada ao salvar e rota invalida corrigida', () => {
    const tmpRoot = makeTempDir('katharos-ui-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    try {
      const mgr = new ConfigManager(tmpRoot, tmpCode);
      mgr.load();
      mgr.save({ ui: { defaultRoute: 'nota', largeText: true, miniCorner: { corner: 'tl', displayId: 7 } } });
      const again = new ConfigManager(tmpRoot, tmpCode).load();
      assert.strictEqual(again.ui.defaultRoute, 'nota');
      assert.strictEqual(again.ui.largeText, true);
      assert.deepStrictEqual(again.ui.miniCorner, { corner: 'tl', displayId: 7 });
      again.ui.defaultRoute = 'xyz';
      again.ui.miniCorner = { corner: 'meio' };
      new ConfigManager(tmpRoot, tmpCode).save(again);
      const fixed = new ConfigManager(tmpRoot, tmpCode).load();
      assert.strictEqual(fixed.ui.defaultRoute, 'ia');
      assert.strictEqual(fixed.ui.miniCorner, null);
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'K1', 'canto mais proximo pelo centro', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 1040 };
    assert.strictEqual(nearestCorner({ x: 10, y: 10, width: 576, height: 220 }, wa), 'tl');
    assert.strictEqual(nearestCorner({ x: 1300, y: 700, width: 576, height: 220 }, wa), 'br');
    assert.strictEqual(nearestCorner({ x: 1300, y: 10, width: 576, height: 220 }, wa), 'tr');
    assert.strictEqual(nearestCorner({ x: 20, y: 800, width: 576, height: 220 }, wa), 'bl');
    assert.strictEqual(nearestCorner({ x: 2100, y: 300, width: 576, height: 220 }, { x: 1920, y: 0, width: 1280, height: 1000 }), 'tl');
  });
  await runCase('Rotas', 'K2', 'bounds do canto com margem e janela maior que a tela', () => {
    const wa = { x: 100, y: 50, width: 1000, height: 500 };
    assert.deepStrictEqual(cornerBounds('br', { width: 300, height: 200 }, wa), { x: 788, y: 338, width: 300, height: 200 });
    assert.deepStrictEqual(cornerBounds('tl', { width: 300, height: 200 }, wa), { x: 112, y: 62, width: 300, height: 200 });
    assert.deepStrictEqual(cornerBounds('br', { width: 1200, height: 900 }, wa), { x: 100, y: 50, width: 1000, height: 500 });
  });
  await runCase('Rotas', 'K3', 'monitor salvo inexistente cai no principal', () => {
    const ds = [{ id: 1, workArea: {} }, { id: 2, workArea: {} }];
    assert.strictEqual(pickDisplay(ds, 1, 2).id, 2);
    assert.strictEqual(pickDisplay(ds, 1, 99).id, 1);
    assert.strictEqual(pickDisplay(ds, 1, null).id, 1);
    assert.strictEqual(pickDisplay(ds, 5, 99).id, 1);
  });
  await runCase('Rotas', 'R9', 'Chat com acoes Perguntar/Procurar/Guardar e status do destino', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'app.js'), 'utf8');
    assert.ok(html.includes('class="route-bar"'), 'route-bar ausente');
    for (const r of ['ia', 'local', 'nota']) {
      assert.ok(html.includes(`class="route-btn" data-route="${r}"`), `route-btn ${r} ausente`);
    }
    assert.ok(html.includes('id="route-status"') && html.includes('id="btn-side-chat-tune"'), 'route-status ou btn-side-chat-tune ausente');
    assert.ok(/aiChat\(\{[^}]*route/.test(appJs), 'aiChat deve receber route');
  });
  await runCase('Rotas', 'R10', 'Mini assistente com 3 acoes e estados do mascote', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const mascotJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'kataros3d.js'), 'utf8');
    for (const id of ['btn-mini-route-ia', 'btn-mini-route-local', 'btn-mini-route-nota']) {
      assert.ok(html.includes(`id="${id}"`), `${id} ausente`);
    }
    assert.ok(html.indexOf('class="mini-more"') < html.indexOf('id="btn-mini-send"'), 'Enviar deve ficar dentro de Mais opcoes');
    assert.ok(mascotJs.includes('setIdleText') && mascotJs.includes('flashSub') && !mascotJs.includes("'LOCAL OK'"), 'Estados do mascote ausentes');
  });
  await runCase('Rotas', 'R11', 'Ajustes basicos (acao padrao, letras grandes, canto) e Avancado recolhido', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    for (const id of ['cfg-default-route', 'cfg-large-text', 'btn-cfg-forget-corner']) {
      assert.ok(html.includes(`id="${id}"`), `${id} ausente`);
    }
    const adv = html.slice(html.indexOf('class="settings-advanced"'), html.indexOf('</details>', html.indexOf('class="settings-advanced"')));
    assert.ok(adv.includes('id="cfg-ai-provider"') && adv.includes('id="cfg-ai-boost"'), 'Motor e /boost devem ficar em Avancado');
  });
  await runCase('Rotas', 'H1', 'historico: append cria arquivo do dia e lista', () => {
    const dir = makeTempDir('kn-hist-');
    try {
      const st = new ChatHistoryStore(dir);
      const p = st.append({ role: 'user', route: 'local', text: 'multa\ncontrato', at: new Date('2026-11-14T13:40:00') });
      assert.strictEqual(p, path.join(dir, 'Historico', '2026-11-14.md'));
      assert.ok(fs.readFileSync(p, 'utf-8').includes('- 13:40 [voce][local] multa contrato'));
      assert.deepStrictEqual(st.listDays(), ['2026-11-14']);
    } finally { rmSafe(dir); }
  });
  await runCase('Rotas', 'H2', 'historico: search e recentPrompts', () => {
    const dir = makeTempDir('kn-hist-');
    try {
      const st = new ChatHistoryStore(dir);
      st.append({ role: 'user', route: 'ia', text: 'quanto entrou via pix', at: new Date('2026-11-13T10:00:00') });
      st.append({ role: 'assistant', route: 'ia', text: 'R$ 2.340,00', at: new Date('2026-11-13T10:00:05') });
      st.append({ role: 'user', route: 'nota', text: 'bolo da vo', at: new Date('2026-11-14T09:00:00') });
      assert.strictEqual(st.search('PIX').length, 1);
      assert.deepStrictEqual(st.recentPrompts(), ['quanto entrou via pix', 'bolo da vo']);
      assert.deepStrictEqual(st.recentPrompts(1), ['bolo da vo']);
      assert.deepStrictEqual(new ChatHistoryStore(makeTempDir('kn-hist-vazio-')).recentPrompts(), []);
    } finally { rmSafe(dir); }
  });
  await runCase('Rotas', 'H3', 'chat grava pergunta e resposta, ignora /limpar e /param', async () => {
    const { svc, tmpRoot } = makeIsolatedSvc();
    try {
      svc.runTask = async () => ({ ok: true, text: 'resposta', source: 'llm' });
      await svc.chat({ message: 'pergunta de teste' });
      await svc.chat({ message: '/limpar' });
      await svc.chat({ message: '/param perfil preciso' });
      assert.deepStrictEqual(svc.history.recentPrompts(), ['pergunta de teste']);
      const day = svc.history.listDays()[0];
      const body = fs.readFileSync(path.join(svc.history.getDir(), `${day}.md`), 'utf-8');
      assert.ok(body.includes('[katharos][ia] resposta'), body);
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'H4', 'comando /historico lista dias e busca termo', async () => {
    const { svc, tmpRoot } = makeIsolatedSvc();
    try {
      const empty = await svc.chat({ message: '/historico' });
      assert.ok(empty.text.includes('Nenhuma conversa'), empty.text);
      svc.history.append({ role: 'user', route: 'local', text: 'multa do contrato', at: new Date('2026-11-14T13:40:00') });
      const list = await svc.chat({ message: '/historico' });
      assert.ok(list.text.includes('2026-11-14') && list.text.includes('1 mensagem'), list.text);
      const found = await svc.chat({ message: '/historico multa' });
      assert.ok(found.text.includes('multa do contrato'), found.text);
      assert.strictEqual(found.route, 'local');
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'H5', 'bateria de testes nao grava no historico real do usuario', () => {
    assert.strictEqual(listRealHistory(), realHistoryBefore, 'Testes alteraram arquivos/Historico real');
  });
  await runCase('Rotas', 'F1', 'Guardar nunca sobrescreve anotacao existente e trata nomes invalidos', async () => {
    const { svc, tmpRoot } = makeIsolatedSvc();
    try {
      const a = await svc.saveToObsidian({ title: 'Lista de compras', text: 'arroz' });
      const b = await svc.saveToObsidian({ title: 'Lista de compras', text: 'feijao' });
      assert.ok(a.ok && b.ok);
      assert.notStrictEqual(a.filePath, b.filePath);
      assert.ok(fs.readFileSync(a.filePath, 'utf8').includes('arroz'));
      assert.ok(fs.readFileSync(b.filePath, 'utf8').includes('feijao'));
      const c = await svc.saveToObsidian({ title: '???', text: 'x' });
      assert.ok(c.ok && /^Nota_/.test(c.fileName), c.fileName);
      const d = await svc.saveToObsidian({ title: 'con', text: 'x' });
      assert.ok(d.ok && !/^con\.md$/i.test(d.fileName), d.fileName);
      const e = await svc.saveToObsidian({ title: 'fim.', text: 'x' });
      assert.ok(e.ok && !/\.\.md$/.test(e.fileName), e.fileName);
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'F2', 'codigo antes de comando / vale o codigo (nada vai para a IA em @local/@nota)', async () => {
    const { svc, tmpRoot } = makeIsolatedSvc();
    try {
      let llm = 0;
      svc.runTask = async () => { llm++; return { ok: true, text: 'x', source: 'llm' }; };
      let saved = null;
      svc.saveToObsidian = async (p) => { saved = p; return { ok: true, fileName: 'n.md', folder: 'K' }; };
      const n = await svc.chat({ message: '@nota /revisar texto' });
      assert.strictEqual(n.route, 'nota');
      assert.strictEqual(saved && saved.text, '/revisar texto');
      const l = await svc.chat({ message: '@local /resumir contrato' });
      assert.strictEqual(l.route, 'local');
      assert.ok(l.text.startsWith('Busca nos seus arquivos'), l.text);
      const l2 = await svc.chat({ message: '@local /buscar contrato' });
      assert.ok(/RESULTADOS|Nenhum resultado/.test(l2.text), l2.text);
      assert.strictEqual(llm, 0, 'nenhuma chamada ao modelo');
      const i = await svc.chat({ message: '@ia /ajuda' });
      assert.ok(i.text.includes('COMANDOS'));
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'F3', 'historico fica fora dos documentos indexados e nao copia resultados de busca', async () => {
    const { svc, tmpRoot, tmpCode } = makeIsolatedSvc();
    try {
      svc.runTask = async () => ({ ok: true, text: 'resposta da ia', source: 'llm' });
      await svc.chat({ message: 'pergunta xyzabc' });
      const docsDir = path.resolve(svc.documents.getDocumentsFolder());
      assert.strictEqual(path.resolve(svc.history.getDir()), path.join(tmpCode, 'data', 'Historico'));
      assert.ok(!path.resolve(svc.history.getDir()).startsWith(docsDir + path.sep));
      assert.strictEqual(svc.documents.search('xyzabc', 5, 200).length, 0, 'historico nao pode aparecer na busca de documentos');
      fs.mkdirSync(path.join(docsDir, 'Geral'), { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'Geral', 'contrato.txt'), 'multa de rescisao segredo123', 'utf8');
      const l = await svc.chat({ message: '@local multa' });
      assert.ok(l.text.includes('segredo123'), 'a busca deveria achar o trecho: ' + l.text);
      const day = svc.history.listDays()[0];
      const body = fs.readFileSync(path.join(svc.history.getDir(), `${day}.md`), 'utf8');
      assert.ok(!body.includes('segredo123'), body);
    } finally { rmSafe(tmpRoot); }
  });
  await runCase('Rotas', 'D1', 'soltar perto da lateral vira barra; longe nao', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 1040 };
    assert.strictEqual(edgeDockSide(10, wa), 'left');
    assert.strictEqual(edgeDockSide(1915, wa), 'right');
    assert.strictEqual(edgeDockSide(500, wa), null);
    assert.strictEqual(edgeDockSide(1930, { x: 1920, y: 0, width: 1280, height: 1000 }), 'left');
    assert.strictEqual(edgeDockSide(3195, { x: 1920, y: 0, width: 1280, height: 1000 }), 'right');
  });
  await runCase('Rotas', 'D2', 'barra encosta na borda e nao sai da tela', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 1040 };
    assert.deepStrictEqual(BAR_SIZE, { width: 84, height: 440 });
    assert.deepStrictEqual(barBounds('left', 300, wa), { x: 0, y: 300, width: 84, height: 440 });
    assert.deepStrictEqual(barBounds('right', 300, wa), { x: 1836, y: 300, width: 84, height: 440 });
    assert.deepStrictEqual(barBounds('right', 900, wa), { x: 1836, y: 600, width: 84, height: 440 });
    assert.deepStrictEqual(barBounds('left', -50, wa), { x: 0, y: 0, width: 84, height: 440 });
    assert.deepStrictEqual(barBounds('left', 0, { x: 0, y: 0, width: 1366, height: 400 }), { x: 0, y: 0, width: 84, height: 400 });
  });
  await runCase('Rotas', 'D3', 'barra lateral e setinhas de tamanho presentes na tela', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const preload = fs.readFileSync(path.join(CODE_DIR, 'src', 'preload', 'preload.js'), 'utf8');
    for (const id of ['kataros-bar', 'btn-bar-route-ia', 'btn-bar-route-local', 'btn-bar-route-nota', 'btn-bar-expand', 'btn-size-down', 'btn-size-up', 'btn-size-full', 'size-label']) {
      assert.ok(html.includes(`id="${id}"`), `${id} ausente`);
    }
    assert.ok(preload.includes('setWindowMode') && preload.includes('onWindowMode'), 'preload sem setWindowMode/onWindowMode');
  });
  await runCase('Rotas', 'D4', 'topo da janela sem texto longo nem /BOOST (nada quebra linha)', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'styles', 'main.css'), 'utf8');
    const header = html.slice(html.indexOf('class="mini-capsule-header"'), html.indexOf('id="mini-ai-textarea"'));
    assert.ok(!header.includes('mini-title-text'), 'titulo longo ainda no topo');
    const controls = header.slice(header.indexOf('mini-header-controls'));
    assert.ok(!controls.includes('id="btn-mini-guide"'), '/BOOST ainda no topo');
    assert.ok(html.includes('id="btn-mini-guide"'), 'botao de desempenho sumiu');
    assert.ok(/\.mini-tag\s*\{[^}]*white-space:\s*nowrap/.test(css), 'nome sem nowrap');
  });
  // ===== Visual ciano v2: respostas com grafico, tela inicial, relatorio, conversas =====
  const KnInsights = require('../src/renderer/js/insights.js');
  const finDoc = {
    id: 'doc-ext', title: 'Extrato Novembro', fileName: 'extrato_novembro.ofx', category: 'Extratos', createdAt: '2026-11-14T10:00:00Z',
    parsedFinancial: {
      isFinancial: true, balance: 1835.4, balanceDate: '30/11/2026', totalCredits: 4580, totalDebits: 3244.6, entryCount: 8, accountInfo: '',
      entries: [
        { date: '03/11/2026', description: 'PIX RECEBIDO JOAO', amount: 400 },
        { date: '05/11/2026', description: 'ALUGUEL', amount: -1200 },
        { date: '07/11/2026', description: 'PIX RECEBIDO MARIA', amount: 250 },
        { date: '10/11/2026', description: 'DEPOSITO', amount: 3930 },
        { date: '12/11/2026', description: 'MERCADO', amount: -640 },
        { date: '15/11/2026', description: 'LUZ', amount: -210 },
        { date: '20/11/2026', description: 'MERCADO', amount: -1000 },
        { date: '25/11/2026', description: 'FARMACIA', amount: -194.6 }
      ]
    }
  };
  const otherDocs = [
    { id: 'd1', title: 'Curriculo', category: 'Curriculos', createdAt: '2026-11-01T10:00:00Z' },
    { id: 'd2', title: 'contrato_aluguel', category: 'Contratos', createdAt: '2026-11-02T10:00:00Z' },
    { id: 'd3', title: 'script', category: 'Codigos', createdAt: '2026-11-03T10:00:00Z' }
  ];

  await runCase('Visual', 'V1', 'pergunta escolhe o tipo de grafico certo', () => {
    assert.strictEqual(KnInsights.detectIntent('quanto entrou via pix esse mes?'), 'pix');
    assert.strictEqual(KnInsights.detectIntent('qual foi o maior gasto no extrato?'), 'gastos');
    assert.strictEqual(KnInsights.detectIntent('qual meu saldo?'), 'saldo');
    assert.strictEqual(KnInsights.detectIntent('quantos documentos eu tenho?'), 'docs');
    assert.strictEqual(KnInsights.detectIntent('o que diz o contrato sobre multa?'), null);
    assert.strictEqual(KnInsights.detectIntent('/curriculo adaptar resumo'), null);
  });

  await runCase('Visual', 'V2', 'pix vira colunas com o total e o arquivo de origem', () => {
    const spec = KnInsights.buildInsight('quanto entrou via pix?', [finDoc]);
    assert.strictEqual(spec.kind, 'cols');
    assert.strictEqual(spec.items.length, 2);
    assert.strictEqual(spec.big, 'R$ 650,00');
    assert.strictEqual(spec.source, 'extrato_novembro.ofx');
  });

  await runCase('Visual', 'V3', 'gastos viram ranking somando a mesma descricao', () => {
    const spec = KnInsights.buildInsight('maior gasto', [finDoc]);
    assert.strictEqual(spec.kind, 'rank');
    assert.strictEqual(spec.items[0].label, 'Mercado');
    assert.strictEqual(spec.items[0].value, 1640);
  });

  await runCase('Visual', 'V4', 'saldo vira linha terminando no saldo do extrato', () => {
    const spec = KnInsights.buildInsight('qual meu saldo?', [finDoc]);
    assert.strictEqual(spec.kind, 'line');
    assert.ok(Math.abs(spec.items[spec.items.length - 1].value - 1835.4) < 0.001);
    assert.strictEqual(spec.trio.length, 3);
  });

  await runCase('Visual', 'V5', 'sem extrato ou em Guardar nao ha grafico; documentos contam por tipo', () => {
    assert.strictEqual(KnInsights.buildInsight('qual meu saldo?', otherDocs), null);
    assert.strictEqual(KnInsights.buildInsight('qual meu saldo?', [finDoc], { route: 'nota' }), null);
    const docs = KnInsights.buildInsight('quantos documentos eu tenho?', otherDocs.concat([finDoc]));
    assert.strictEqual(docs.kind, 'rank');
    assert.strictEqual(docs.big, '4');
  });

  await runCase('Visual', 'V6', 'relatorio e tela inicial usam dados reais do documento', () => {
    const rep = KnInsights.buildReport(finDoc);
    assert.strictEqual(rep.glance[0].value, 'R$ 4.580,00');
    assert.strictEqual(rep.recent[0].date, '25/11');
    const home = KnInsights.homeSummary(otherDocs.concat([finDoc]));
    assert.strictEqual(home.total, 4);
    assert.strictEqual(home.last.title, 'Extrato Novembro');
    assert.ok(home.saldo && home.saldo.big === 'R$ 1.835,40');
    assert.strictEqual(KnInsights.homeSummary(otherDocs).saldo, null);
  });

  await runCase('Visual', 'V7', 'conversas recentes por dia, so perguntas do usuario', () => {
    const tmpH = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-hist-'));
    const hs = new ChatHistoryStore(tmpH);
    hs.append({ role: 'user', route: 'ia', text: 'qual meu saldo?', at: new Date(2026, 10, 13, 9, 0) });
    hs.append({ role: 'assistant', route: 'ia', text: 'R$ 10', at: new Date(2026, 10, 13, 9, 1) });
    hs.append({ role: 'user', route: 'local', text: 'multa contrato', at: new Date(2026, 10, 14, 10, 0) });
    const list = hs.recentQuestions(7, 10);
    assert.deepStrictEqual(list.map((i) => i.text), ['multa contrato', 'qual meu saldo?']);
    assert.strictEqual(list[0].route, 'local');
    fs.rmSync(tmpH, { recursive: true, force: true });
  });

  await runCase('Visual', 'V8', 'tela usa o tema ciano, os scripts novos e a chave de graficos', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const theme = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'styles', 'theme.css'), 'utf8');
    const view = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'insights-view.js'), 'utf8');
    assert.ok(html.indexOf('styles/theme.css') > html.indexOf('styles/main.css'), 'theme.css precisa vir depois de main.css');
    assert.ok(html.indexOf('js/insights.js') < html.indexOf('js/app.js') && html.indexOf('js/insights-view.js') < html.indexOf('js/app.js'));
    ['id="cfg-show-charts"', 'id="modal-report"', 'id="modal-history"', 'id="kn-dropzone"', 'id="btn-side-chat-history"', 'id="kataros-mascot-canvas"'].forEach((id) => assert.ok(html.includes(id), `faltou ${id}`));
    assert.ok(/--kn-cyan-hi:\s*#73F3FF/i.test(theme) && /--kn-gold:\s*#E5B84B/i.test(theme), 'tokens ciano/dourado');
    assert.ok(!/\.innerHTML\s*=/.test(view), 'graficos sem innerHTML');
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    [html, theme, view].forEach((t) => assert.ok(!emoji.test(t), 'emoji proibido'));
  });
  await runCase('Visual', 'V9', 'chat redimensionavel pela borda e tamanho escolhido salvo', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'app.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    ['data-grip="l"', 'data-grip="r"', 'data-grip="b"', 'data-grip="bl"', 'data-grip="br"'].forEach((g) => assert.ok(html.includes(g), `faltou ${g}`));
    assert.ok(appJs.includes('chatSize') && appJs.includes('dblclick'), 'tamanho salvo e duplo clique');
    assert.ok(/keepRight \? b\.x \+ b\.width - w/.test(mainJs), 'borda direita parada ao puxar pela esquerda');
    const tmpCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-cs-'));
    const cfgPath = path.join(tmpCfgDir, 'mpe.config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ ui: { chatSize: { width: 900, height: 600 } } }));
    const cmA = new ConfigManager(tmpCfgDir, tmpCfgDir);
    assert.deepStrictEqual(cmA.get().ui.chatSize, { width: 900, height: 600 });
    fs.writeFileSync(cfgPath, JSON.stringify({ ui: { chatSize: { width: 'x', height: 10 } } }));
    const cmB = new ConfigManager(tmpCfgDir, tmpCfgDir);
    assert.ok(!('chatSize' in cmB.get().ui), 'tamanho invalido descartado');
    fs.rmSync(tmpCfgDir, { recursive: true, force: true });
  });
  await runCase('Visual', 'V10', 'trazer arquivo: pasta inteira por tipo e texto colado reconhecido', () => {
    const importHelper = require('../src/main/importHelper');
    const tmpF = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-imp-'));
    fs.writeFileSync(path.join(tmpF, 'extrato.ofx'), '<OFX><STMTTRN><DTPOSTED>20261105<TRNAMT>-10.00<MEMO>X</STMTTRN></OFX>');
    fs.mkdirSync(path.join(tmpF, 'sub'));
    fs.writeFileSync(path.join(tmpF, 'sub', 'curriculo.md'), 'Experiencia profissional\nFormacao academica');
    fs.writeFileSync(path.join(tmpF, 'foto.heic'), 'x');
    const scan = importHelper.scanFolder(tmpF);
    assert.strictEqual(scan.files.length, 2);
    assert.strictEqual(scan.skipped, 1);
    assert.deepStrictEqual(scan.byType.map((t) => t.label).sort(), ['Currículos', 'Extratos']);
    fs.rmSync(tmpF, { recursive: true, force: true });
    const rec = importHelper.recognizeText('<OFX><STMTTRN><DTPOSTED>20261105<TRNAMT>-1200.00<MEMO>ALUGUEL</STMTTRN><STMTTRN><DTPOSTED>20261130<TRNAMT>300<MEMO>PIX</STMTTRN>');
    assert.strictEqual(rec.category, 'Extratos');
    assert.ok(/2 lançamentos/.test(rec.detail));
    assert.strictEqual(importHelper.recognizeText('lembrar de comprar pao amanha cedo'), null);
    assert.strictEqual(importHelper.isSupported('a.heic'), false);
  });

  await runCase('Visual', 'V11', 'outros jeitos de ver: entrou x saiu, calendario e linha do tempo do curriculo', () => {
    const opts = KnInsights.viewOptions('qual meu saldo?', [finDoc]).map((o) => o.id);
    assert.deepStrictEqual(opts, ['balance', 'calendar', 'gastos']);
    const bal = KnInsights.buildView('balance', [finDoc]);
    assert.strictEqual(bal.big, 'R$ 1.335,40');
    const cal = KnInsights.buildView('calendar', [finDoc]);
    assert.strictEqual(cal.items.length, 30);
    assert.strictEqual(cal.items[19].level, 3);
    const cv = { id: 'cv', category: 'Curriculos', createdAt: '2026-11-01T00:00:00Z', textContent: 'Cargo A | 2018 - 2020\nCargo B\n2020 – 2023\nCargo C, 2023 - atual' };
    assert.deepStrictEqual(KnInsights.viewOptions('/curriculo minhas experiencias', [cv]).map((o) => o.id), ['timeline']);
    const tl = KnInsights.buildView('timeline', [cv]);
    assert.deepStrictEqual(tl.items.map((i) => i.label), ['Cargo A', 'Cargo B', 'Cargo C']);
    assert.strictEqual(KnInsights.viewOptions('guarda isso', [finDoc], { route: 'nota' }).length, 0);
  });

  await runCase('Visual', 'V12', 'conversas trazem a resposta junto da pergunta', () => {
    const tmpH = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-hist2-'));
    const hs = new ChatHistoryStore(tmpH);
    hs.append({ role: 'user', route: 'local', text: 'multa contrato', at: new Date(2026, 10, 14, 10, 0) });
    hs.append({ role: 'assistant', route: 'local', text: 'A multa e de 3 alugueis', at: new Date(2026, 10, 14, 10, 0) });
    hs.append({ role: 'user', route: 'ia', text: 'sem resposta', at: new Date(2026, 10, 14, 11, 0) });
    const list = hs.recentQuestions(7, 10);
    assert.strictEqual(list[1].answer, 'A multa e de 3 alugueis');
    assert.strictEqual(list[0].answer, '');
    fs.rmSync(tmpH, { recursive: true, force: true });
  });

  await runCase('Visual', 'V13', 'segurar no mascote, ESC durante pergunta e fechar totalmente', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'app.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    ['id="kn-bubble-ui"', 'data-bubble-route="ia"', 'data-bubble-route="local"', 'data-bubble-route="nota"', 'id="kn-bubble-say"', 'id="kn-history-bydoc"', 'data-hist-route="nota"', 'id="btn-kn-import-folder"', 'id="kn-paste-hint"'].forEach((id) => assert.ok(html.includes(id), `faltou ${id}`));
    assert.ok(/requestWindowMode\('mascote'\)/.test(appJs) && /kn-holding/.test(appJs), 'segurar no mascote');
    assert.ok(/kn-busy[\s\S]{0,200}knEnterBubbleRef\(\)/.test(appJs), 'ESC durante pergunta vai para o mascote');
    assert.ok(/function enterBubble/.test(mainJs) && /mode === 'mascote'/.test(mainJs), 'modo mascote no processo principal');
    assert.ok(/clearCache\(\)/.test(mainJs) && /CommandOrControl\+Shift\+Q/.test(mainJs) && /Shift\+Alt\+Escape/.test(mainJs), 'fechar totalmente limpando o cache');
  });
  await runCase('Visual', 'V14', 'modelo descarrega sozinho depois de minutos sem uso; redimensionar pelo processo principal', () => {
    const svc = Object.create(LocalAiService.prototype);
    let stopped = 0;
    let cfg = { idleUnloadMinutes: 10 };
    svc.getAiConfig = () => cfg;
    svc.engine = { child: {}, state: 'online', stopAsync: async () => { stopped++; } };
    svc.lastLlmUseAt = 1000;
    svc.llmInflight = 0;
    assert.strictEqual(svc.checkIdle(1000 + 9 * 60000), false, 'antes de 10 min nao descarrega');
    svc.llmInflight = 1;
    assert.strictEqual(svc.checkIdle(1000 + 11 * 60000), false, 'nao descarrega com pergunta em andamento');
    svc.llmInflight = 0;
    assert.strictEqual(svc.checkIdle(1000 + 11 * 60000), true);
    assert.strictEqual(stopped, 1);
    cfg = { idleUnloadMinutes: 0 };
    assert.strictEqual(svc.checkIdle(1000 + 999 * 60000), false, '0 = nunca');
    svc.engine = { child: null, state: 'external', stopAsync: async () => { stopped++; } };
    cfg = { idleUnloadMinutes: 1 };
    assert.strictEqual(svc.checkIdle(1000 + 99 * 60000), false, 'nao mexe em motor externo');
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    assert.ok(/function startMiniResize/.test(mainJs) && /mpe:mini-resize-start/.test(mainJs) && /miniResizeTimer\) return;/.test(mainJs), 'redimensionar pelo processo principal');
    const tmpCfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-idle-'));
    fs.writeFileSync(path.join(tmpCfgDir, 'mpe.config.json'), JSON.stringify({ ai: { idleUnloadMinutes: 'x' } }));
    assert.strictEqual(new ConfigManager(tmpCfgDir, tmpCfgDir).get().ai.idleUnloadMinutes, 10);
    fs.rmSync(tmpCfgDir, { recursive: true, force: true });
  });
  await runCase('Visual', 'V15', 'layout compacto, orientacao topo/lateral, modo cascata, resizer e atalhos kbd/F1', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'styles', 'main.css'), 'utf8');
    const theme = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'styles', 'theme.css'), 'utf8');
    const appJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'app.js'), 'utf8');
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');

    ['id="btn-mini-orient"', 'id="btn-mini-cascade"', 'id="mini-hud-resizer"', 'class="guide-header-badge"'].forEach((s) => {
      assert.ok(html.includes(s), `ausente no HTML: ${s}`);
    });
    assert.ok(/overflow-x:\s*hidden/.test(css) && /min-height:\s*160px/.test(css), 'side-chat-messages precisa min-height 160px e overflow-x hidden');
    assert.ok(/calc\(100vh\s*-/.test(css), 'side-chat-drawer precisa altura dinamica proporcional a tela');
    assert.ok(/body\.mode-mini-assistant\.chat-open:not\(\.mode-full\)\s*\.mini-capsule-body/.test(css), 'card superior deve recolher com chat aberto');
    assert.ok(/\.mini-sci-hud\.dock-lateral/.test(css) && /\.mini-sci-hud\.cascade-mode:not\(:hover\)/.test(css), 'classes dock-lateral e cascade-mode ausentes');
    assert.ok(/border-bottom-width:\s*2\.5px/.test(css) && /border-bottom-width:\s*2\.5px/.test(theme), 'estilo tactil 3D para kbd');
    assert.ok(appJs.includes('katharos_hud_layout_state') && appJs.includes("e.key === 'F1'") && appJs.includes("e.key === '?'"), 'localStorage layout e atalho F1/?');
    assert.ok(appJs.includes('resetMiniLayout') && mainJs.includes('mpe:reset-mini-layout') && mainJs.includes('saveFreePosition'), 'flutuacao livre e restauracao por duplo clique');
  });
  await runCase('Visual', 'V15', 'barra recolhida no icone (56 + 3 px), clique abre em cascata; mascote muda ao procurar e guardar', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    const mascotJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'kataros3d.js'), 'utf8');
    const theme = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'styles', 'theme.css'), 'utf8');
    assert.ok(html.includes('id="kataros-bar-canvas"'), 'icone animado na barra');
    assert.ok(/BAR_COLLAPSED = \{ width: 62, height: 62 \}/.test(mainJs) && /mpe:bar-expand/.test(mainJs));
    assert.ok(/kn-cascade-in/.test(theme) && /bar-collapsed \.kataros-bar \{/.test(theme));
    assert.ok(/setModeAll/.test(mascotJs) && /targetDir = this\.mode === 'find' \? -1 : 1/.test(mascotJs), 'procurar inverte o giro');
    assert.ok(/134, 214, 160/.test(mascotJs) && /92, 200, 245/.test(mascotJs), 'pontos verdes e azuis');
    const { barBounds } = require('../src/main/cornerSnap');
    const b = barBounds('right', 100, { x: 0, y: 0, width: 1920, height: 1040 }, { width: 62, height: 62 });
    assert.deepStrictEqual(b, { x: 1858, y: 100, width: 62, height: 62 });
  });
  await runCase('Visual', 'V16', 'pastas para qualquer pessoa: saude, estudos, garantias e contas; curriculo so por comando', () => {
    const AiDocs = require('../src/main/aiDocuments');
    assert.strictEqual(AiDocs.detectCategory('hemograma', 'resultado de exame', ''), 'Saude');
    assert.strictEqual(AiDocs.detectCategory('apostila', 'aula 3 de matematica', ''), 'Estudos');
    assert.strictEqual(AiDocs.detectCategory('nota', 'certificado de garantia de 12 meses', ''), 'Garantias');
    assert.strictEqual(AiDocs.detectCategory('conta de luz', 'boleto vencimento 10/12', ''), 'Financeiro');
    const importHelper = require('../src/main/importHelper');
    assert.strictEqual(importHelper.recognizeText('Resultado de exame: hemograma completo, hemoglobina 14').label, 'Saúde');
    assert.strictEqual(importHelper.recognizeText('Experiencia profissional e formacao academica em sistemas'), null, 'curriculo nao aparece ao colar');
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'app.js'), 'utf8');
    assert.ok(!/curr[ií]culo/i.test(html) && !/curr[ií]culo/i.test(appJs), 'curriculo fora da tela');
    ['value="Saude"', 'value="Estudos"', 'value="Garantias"', 'Contas e boletos'].forEach((t) => assert.ok(html.includes(t), `faltou ${t}`));
  });
  await runCase('Visual', 'V17', '3 modos, sem caixa duplicada com o chat aberto e linha do motor no formato pedido', () => {
    const theme = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'styles', 'theme.css'), 'utf8');
    const appJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'js', 'app.js'), 'utf8');
    assert.ok(/\.size-ctrl, #btn-mini-orient, #btn-mini-cascade, #mini-hud-resizer \{ display: none !important; \}/.test(theme), 'controles extras fora do topo');
    assert.ok(/body\.chat-open:not\(\.mode-bubble\) \.mini-capsule-body/.test(theme), 'sem caixa duplicada');
    assert.ok(/`Motor: \$\{engineName\} = \$\{state\}`/.test(appJs), 'Motor: Qwen2.5-7B = Pronto');
    assert.ok(/localStorage\.removeItem\(LAYOUT_STORAGE_KEY\)/.test(appJs), 'layout salvo num lugar so');
    const short = ('Qwen2.5-7B-Instruct-Q4_K_M'.match(/^(.*?\d+(?:\.\d+)?B)\b/i) || [])[1];
    assert.strictEqual(short, 'Qwen2.5-7B');
    assert.strictEqual(KnInsights.categoryLabel('Financeiro'), 'Contas e boletos');
  });
  //@@ROTAS_NEXT@@

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const summary = {
    executedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    results
  };

  console.log('\n=== RESUMO DA BATERIA NODE/INTEGRACAO ===');
  console.log(`Total: ${summary.total} | PASS: ${passed} | FAIL: ${failed}`);
  console.log('KATHAROS_TEST_REPORT_JSON=' + JSON.stringify(summary));

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});