/**
 * Katharos Nous | katharos AI - Trazer arquivo.
 * Funcoes puras de apoio: varrer uma pasta inteira e reconhecer texto colado.
 * Nada aqui grava arquivos; quem guarda continua sendo AiDocuments.addDocument.
 */
const fs = require('fs');
const path = require('path');
const AiDocuments = require('./aiDocuments');

const TEXT_EXTS = new Set(['.ofx', '.qfx', '.csv', '.tsv', '.txt', '.md', '.json', '.js', '.ts', '.py', '.cs', '.ps1', '.sql', '.sh', '.html', '.css']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', 'Historico']);

// Nome que aparece na tela para cada categoria (a pasta continua sem acento)
const CATEGORY_LABEL = {
  Extratos: 'Extratos', Recibos: 'Recibos', Comprovantes: 'Comprovantes', Contratos: 'Contratos',
  Financeiro: 'Contas e boletos', Saude: 'Saúde', Estudos: 'Estudos', Garantias: 'Garantias e notas',
  Curriculos: 'Currículos', PDFs: 'PDFs', Codigos: 'Códigos', Modelos: 'Modelos', Geral: 'Geral'
};
// Frase curta de "Parece ..." para texto colado
const CATEGORY_PHRASE = {
  Extratos: 'um extrato do banco', Recibos: 'um recibo', Comprovantes: 'um comprovante', Contratos: 'um contrato',
  Financeiro: 'uma conta ou boleto', Saude: 'um exame ou receita', Estudos: 'material de estudo',
  Garantias: 'uma nota fiscal ou garantia', Codigos: 'um código'
};

function isSupported(filePath) {
  return AiDocuments.AUTO_INDEX_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function readSample(filePath, ext) {
  if (!TEXT_EXTS.has(ext)) return '';
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8');
  } catch (_) {
    return '';
  }
}

function categoryFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath, ext);
  return AiDocuments.detectCategory(name, readSample(filePath, ext), ext);
}

/** Varre uma pasta (ate 3 niveis) e resume o que da para guardar, por tipo. */
function scanFolder(dir, { maxFiles = 500, maxDepth = 3 } = {}) {
  const files = [];
  let skipped = 0;
  let truncated = false;
  const walk = (cur, depth) => {
    if (truncated) return;
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.isDirectory()) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(e.name)) walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      if (!isSupported(full)) {
        skipped++;
        continue;
      }
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const category = categoryFor(full);
      files.push({ path: full, name: e.name, category, label: CATEGORY_LABEL[category] || category });
    }
  };
  walk(dir, 0);
  const counts = new Map();
  files.forEach((f) => counts.set(f.label, (counts.get(f.label) || 0) + 1));
  const byType = Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  return { folder: dir, folderName: path.basename(dir), files, byType, skipped, truncated };
}

/** Reconhece texto colado: tipo, frase "Parece ..." e um detalhe quando ha numeros. */
function recognizeText(text) {
  const clean = String(text || '').trim();
  if (clean.length < 20) return null;
  const category = AiDocuments.detectCategory('', clean, '');
  const phrase = CATEGORY_PHRASE[category];
  if (!phrase) return null;
  let detail = '';
  if (category === 'Extratos') {
    const fin = AiDocuments.parseFinancialDocument(clean, '', '');
    if (fin && fin.entryCount) {
      const dates = (fin.entries || []).map((e) => e.date).filter(Boolean);
      const range = dates.length ? `, de ${dates[0].slice(0, 5)} a ${dates[dates.length - 1].slice(0, 5)}` : '';
      detail = `${fin.entryCount} ${fin.entryCount === 1 ? 'lançamento' : 'lançamentos'}${range}`;
    }
  }
  return { category, label: CATEGORY_LABEL[category] || category, phrase: `Parece ${phrase}`, detail };
}

module.exports = { isSupported, scanFolder, recognizeText, categoryFor, CATEGORY_LABEL };
