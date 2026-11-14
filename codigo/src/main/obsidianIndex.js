const fs = require('fs');
const path = require('path');

/**
 * Indice simples de notas do Obsidian para alimentar a I.A local (RAG por palavras-chave).
 * Sem dependencias: varre o cofre, pontua notas pela sobreposicao de termos e devolve trechos.
 */
const STOPWORDS = new Set(
  ('a o e de da do das dos em no na nos nas um uma uns umas para por com sem que se ao aos ' +
    'como mais mas ou ser ter esta este isso isto essa esse sua seu suas seus meu minha nao sim ' +
    'the and for with from this that are you your qual quais quando onde porque pra pro faca fazer ' +
    'crie criar escreva escrever funcao codigo uma preciso quero me te lhe')
    .split(/\s+/)
);

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(str) {
  return normalize(str)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

class ObsidianIndex {
  constructor() {
    this.vaultPath = null;
    this.notes = [];
    this.tokenIndex = new Map();
    this.queryCache = new Map();
    this.builtAt = 0;
  }

  build(vaultPath) {
    const now = Date.now();
    if (this.vaultPath === vaultPath && now - this.builtAt < 60000) return this.notes;

    const notes = [];
    const tokenIndex = new Map();
    const walk = (dir, depth) => {
      if (depth > 8 || notes.length >= 3000) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full, depth + 1);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          try {
            const stat = fs.statSync(full);
            if (stat.size > 512 * 1024) continue;
            const content = fs.readFileSync(full, 'utf8').slice(0, 40000);
            const title = e.name.replace(/\.md$/i, '');
            const norm = normalize(content);
            const normTitle = normalize(title);
            const noteIdx = notes.length;

            // Indexacao invertida por token unico (titulo + conteudo)
            const seenTokens = new Set(tokenize(`${title} ${content}`));
            for (const tok of seenTokens) {
              let bucket = tokenIndex.get(tok);
              if (!bucket) {
                bucket = new Set();
                tokenIndex.set(tok, bucket);
              }
              bucket.add(noteIdx);
            }

            notes.push({
              title,
              rel: path.relative(vaultPath, full),
              content,
              norm,
              normTitle,
              tokenSet: seenTokens
            });
          } catch (_) {}
        }
      }
    };

    if (vaultPath && fs.existsSync(vaultPath)) walk(vaultPath, 0);
    this.vaultPath = vaultPath;
    this.notes = notes;
    this.tokenIndex = tokenIndex;
    this.queryCache.clear();
    this.builtAt = now;
    return notes;
  }

  invalidate() {
    this.builtAt = 0;
    this.queryCache.clear();
  }

  search(vaultPath, query, limit = 3, snippetSize = 700) {
    const notes = this.build(vaultPath);
    const qNorm = normalize(query).trim();
    const terms = Array.from(new Set(tokenize(query)));
    if ((!terms.length && !qNorm) || !notes.length) return [];

    const cacheKey = `${vaultPath}|${limit}|${snippetSize}|${qNorm}`;
    if (this.queryCache.has(cacheKey)) {
      return this.queryCache.get(cacheKey).map((item) => Object.assign({}, item));
    }

    // Coleta apenas notas candidatas pelo indice invertido (O(k) em vez de varrer o cofre inteiro)
    const candidateIndices = new Set();
    for (const t of terms) {
      const bucket = this.tokenIndex.get(t);
      if (bucket) {
        for (const idx of bucket) candidateIndices.add(idx);
      }
    }

    // Fallback para consultas parciais ou numericas/monetarias sem token exato
    if (candidateIndices.size === 0 && qNorm.length >= 2) {
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.normTitle.includes(qNorm) || n.norm.includes(qNorm)) {
          candidateIndices.add(i);
        }
      }
    }

    const scored = [];
    for (const i of candidateIndices) {
      const n = notes[i];
      let score = 0;
      let firstHit = -1;
      for (const t of terms) {
        if (n.normTitle.includes(t)) score += 5;
        if (!n.tokenSet.has(t) && !n.norm.includes(t)) continue;
        let idx = n.norm.indexOf(t);
        let count = 0;
        while (idx !== -1 && count < 12) {
          if (firstHit === -1 || idx < firstHit) firstHit = idx;
          count++;
          idx = n.norm.indexOf(t, idx + t.length);
        }
        score += count;
      }
      if (score === 0 && qNorm.length >= 2) {
        const hitIdx = n.norm.indexOf(qNorm);
        if (n.normTitle.includes(qNorm)) score += 5;
        if (hitIdx !== -1) {
          score += 2;
          firstHit = hitIdx;
        }
      }
      if (score > 0) scored.push({ n, score, firstHit });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit).map(({ n, score, firstHit }) => {
      const start = Math.max(0, (firstHit === -1 ? 0 : firstHit) - Math.floor(snippetSize / 4));
      const snippet = n.content.slice(start, start + snippetSize).trim();
      return { title: n.title, rel: n.rel, score, snippet };
    });

    if (this.queryCache.size >= 64) {
      const oldestKey = this.queryCache.keys().next().value;
      this.queryCache.delete(oldestKey);
    }
    this.queryCache.set(cacheKey, results);
    return results.map((item) => Object.assign({}, item));
  }

  count(vaultPath) {
    return this.build(vaultPath).length;
  }
}

ObsidianIndex.tokenize = tokenize;
ObsidianIndex.normalize = normalize;

module.exports = ObsidianIndex;
