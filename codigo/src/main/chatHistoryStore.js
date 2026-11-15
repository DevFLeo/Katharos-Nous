const fs = require('fs');
const path = require('path');

/**
 * Historico local das conversas do Katharos Nous.
 * Um arquivo Markdown por dia em <baseDir>/Historico/AAAA-MM-DD.md, uma linha por mensagem:
 *   - HH:MM [voce|katharos][ia|local|nota] texto
 * Fica fora da pasta de documentos (padrao: codigo/data/Historico) para nao poluir a busca nem o contexto do modelo.
 * A consulta e feita pelo comando /historico.
 */

const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const LINE_RE = /^- (\d{2}:\d{2}) \[(voce|katharos)\]\[(ia|local|nota)\] (.*)$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

class ChatHistoryStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  getDir() {
    return path.join(this.baseDir, 'Historico');
  }

  append({ role, route, text, at } = {}) {
    const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date();
    const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
    const dir = this.getDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${day}.md`);
    const who = role === 'user' ? 'voce' : 'katharos';
    const safeRoute = ['ia', 'local', 'nota'].includes(route) ? route : 'ia';
    const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
    const line = `- ${pad(when.getHours())}:${pad(when.getMinutes())} [${who}][${safeRoute}] ${oneLine}\n`;
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `# Historico ${day}\n\n`, 'utf8');
    }
    fs.appendFileSync(filePath, line, 'utf8');
    return filePath;
  }

  listDays() {
    const dir = this.getDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((name) => (name.match(DAY_FILE_RE) || [])[1])
      .filter(Boolean)
      .sort()
      .reverse();
  }

  readDay(day) {
    const filePath = path.join(this.getDir(), `${day}.md`);
    if (!fs.existsSync(filePath)) return [];
    return fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => {
        const m = line.match(LINE_RE);
        return m ? { day, time: m[1], who: m[2], route: m[3], text: m[4], line } : null;
      })
      .filter(Boolean);
  }

  search(term, max = 5) {
    const q = normalize(term).trim();
    if (!q) return [];
    const out = [];
    for (const day of this.listDays()) {
      const entries = this.readDay(day).reverse();
      for (const e of entries) {
        if (normalize(e.text).includes(q)) {
          out.push({ day, line: e.line, text: e.text, time: e.time, who: e.who, route: e.route });
          if (out.length >= max) return out;
        }
      }
    }
    return out;
  }

  recentPrompts(max = 40) {
    const prompts = [];
    for (const day of this.listDays()) {
      const entries = this.readDay(day).filter((e) => e.who === 'voce').reverse();
      for (const e of entries) {
        prompts.push(e.text);
        if (prompts.length >= max) return prompts.reverse();
      }
    }
    return prompts.reverse();
  }

  // Perguntas do usuario dos ultimos dias, mais novas primeiro (para a lista de conversas em cards)
  recentQuestions(maxDays = 7, maxItems = 30) {
    const out = [];
    for (const day of this.listDays().slice(0, Math.max(1, maxDays))) {
      const entries = this.readDay(day).filter((e) => e.who === 'voce').reverse();
      for (const e of entries) {
        out.push({ day, time: e.time, route: e.route, text: e.text });
        if (out.length >= maxItems) return out;
      }
    }
    return out;
  }

  countDay(day) {
    return this.readDay(day).length;
  }
}

module.exports = ChatHistoryStore;
