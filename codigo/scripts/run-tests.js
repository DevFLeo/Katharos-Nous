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
const { nearestCorner, cornerBounds, pickDisplay } = require('../src/main/cornerSnap');

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
      assert.deepStrictEqual(loaded.ui, { defaultRoute: 'ia', largeText: false, miniCorner: null });
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