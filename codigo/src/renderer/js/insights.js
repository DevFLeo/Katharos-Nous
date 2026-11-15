/* Katharos Nous | katharos AI - Respostas com grafico.
   Funcoes puras: escolhem o grafico a partir da pergunta e dos documentos guardados.
   Regra: sem numeros no documento, sem grafico. Todo grafico diz de qual arquivo veio. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KnInsights = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function norm(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function formatBRL(v) {
    const n = Number(v) || 0;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${sign}R$ ${abs}`;
  }

  // Ordem importa: perguntas mais especificas primeiro
  const INTENTS = [
    { id: 'pix', rx: /\bpix\b/ },
    { id: 'gastos', rx: /(maior gasto|maiores gastos|gastos?\b|gastei|despesas?|por onde saiu|\bsaidas?\b|quanto saiu)/ },
    { id: 'entradas', rx: /(entradas?\b|quanto entrou|\bentrou\b|recebi|receitas?\b)/ },
    { id: 'saldo', rx: /(\bsaldo\b|^\/saldo)/ },
    { id: 'extrato', rx: /(^\/extrato|\bextrato\b|lancamentos)/ },
    { id: 'docs', rx: /(quantos (documentos|arquivos)|meus (documentos|arquivos)|^\/arquivos\b|documentos guardados|arquivos guardados)/ }
  ];

  function detectIntent(prompt) {
    const p = norm(prompt).trim();
    if (!p) return null;
    for (const it of INTENTS) if (it.rx.test(p)) return it.id;
    return null;
  }

  function isFinancialIntent(id) {
    return id === 'pix' || id === 'gastos' || id === 'entradas' || id === 'saldo' || id === 'extrato';
  }

  function parseDate(str) {
    const m = String(str || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return new Date(y, Number(m[2]) - 1, Number(m[1])).getTime();
    }
    const iso = Date.parse(str);
    return Number.isFinite(iso) ? iso : NaN;
  }

  function shortDay(str) {
    const m = String(str || '').match(/(\d{1,2})\/(\d{1,2})/);
    return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}` : String(str || '').slice(0, 5);
  }

  function pickFinancialDoc(docs) {
    const fin = (docs || []).filter(
      (d) => d && d.parsedFinancial && d.parsedFinancial.isFinancial && Array.isArray(d.parsedFinancial.entries) && d.parsedFinancial.entries.length
    );
    if (!fin.length) return null;
    fin.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    return fin[0];
  }

  function sourceName(doc) {
    return (doc && (doc.fileName || doc.title)) || 'documento';
  }

  function sortedEntries(fin) {
    return fin.entries
      .map((e, i) => ({ ...e, _t: parseDate(e.date), _i: i }))
      .sort((a, b) => (Number.isFinite(a._t) && Number.isFinite(b._t) ? a._t - b._t : a._i - b._i));
  }

  function cleanDesc(desc) {
    let s = String(desc || 'Outro')
      .replace(/\s+/g, ' ')
      .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, '')
      .trim()
      .slice(0, 28);
    // Banco escreve tudo em maiusculas: deixa mais facil de ler
    if (s && s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    return s || 'Outro';
  }

  function buildPix(doc) {
    const fin = doc.parsedFinancial;
    const items = sortedEntries(fin)
      .filter((e) => e.amount > 0 && /pix/i.test(e.description || ''))
      .map((e) => ({ label: shortDay(e.date), value: e.amount }));
    if (!items.length) return null;
    const total = items.reduce((s, i) => s + i.value, 0);
    return {
      kind: 'cols', money: true, title: 'Cada coluna é um Pix recebido',
      big: formatBRL(total), bigLabel: `entrou via Pix em ${items.length} ${items.length === 1 ? 'vez' : 'vezes'}`,
      items: items.slice(-12)
    };
  }

  function buildEntradas(doc) {
    const fin = doc.parsedFinancial;
    const byDay = new Map();
    sortedEntries(fin).filter((e) => e.amount > 0).forEach((e) => {
      const k = shortDay(e.date) || '-';
      byDay.set(k, (byDay.get(k) || 0) + e.amount);
    });
    if (!byDay.size) return null;
    return {
      kind: 'cols', money: true, title: 'Entradas por dia',
      big: formatBRL(fin.totalCredits), bigLabel: 'entrou no período',
      items: Array.from(byDay, ([label, value]) => ({ label, value })).slice(-12)
    };
  }

  function buildGastos(doc) {
    const fin = doc.parsedFinancial;
    const groups = new Map();
    fin.entries.filter((e) => e.amount < 0).forEach((e) => {
      const k = cleanDesc(e.description);
      groups.set(k, (groups.get(k) || 0) + Math.abs(e.amount));
    });
    if (!groups.size) return null;
    const all = Array.from(groups, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const top = all.slice(0, 5);
    const rest = all.slice(5).reduce((s, i) => s + i.value, 0);
    if (rest > 0) top.push({ label: 'Outros', value: rest, muted: true });
    return {
      kind: 'rank', money: true, title: 'Maiores gastos',
      big: formatBRL(all[0].value), bigLabel: `${all[0].label}, o maior gasto`,
      items: top
    };
  }

  function buildSaldo(doc) {
    const fin = doc.parsedFinancial;
    const list = sortedEntries(fin);
    const net = list.reduce((s, e) => s + e.amount, 0);
    const hasBal = fin.balance !== null && fin.balance !== undefined && Number.isFinite(fin.balance);
    let run = hasBal ? fin.balance - net : 0;
    const points = [{ label: 'inicio', value: run }];
    list.forEach((e) => {
      run += e.amount;
      points.push({ label: shortDay(e.date), value: run });
    });
    const last = points[points.length - 1].value;
    return {
      kind: 'line', money: true, title: hasBal ? 'Saldo ao longo do período' : 'Movimento acumulado no período',
      big: formatBRL(hasBal ? fin.balance : last), bigLabel: hasBal ? `saldo${fin.balanceDate ? ` em ${fin.balanceDate}` : ''}` : 'entrou menos saiu',
      items: points,
      trio: [
        { label: 'Entrou', value: formatBRL(fin.totalCredits), tone: 'in' },
        { label: 'Saiu', value: formatBRL(fin.totalDebits), tone: 'out' },
        { label: 'Sobrou', value: formatBRL(fin.totalCredits - fin.totalDebits), tone: 'net' }
      ]
    };
  }

  function buildDocs(docs) {
    const counts = new Map();
    (docs || []).forEach((d) => {
      const k = (d && d.category) || 'Geral';
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    if (!counts.size) return null;
    const items = Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const total = items.reduce((s, i) => s + i.value, 0);
    return {
      kind: 'rank', money: false, title: 'Documentos por tipo',
      big: String(total), bigLabel: total === 1 ? 'documento guardado' : 'documentos guardados',
      items: items.slice(0, 8), source: 'pasta arquivos'
    };
  }

  function buildInsight(prompt, docs, { route } = {}) {
    if (route === 'nota') return null;
    const intent = detectIntent(prompt);
    if (!intent) return null;
    if (intent === 'docs') return buildDocs(docs);
    const doc = pickFinancialDoc(docs);
    if (!doc) return null;
    const builders = { pix: buildPix, gastos: buildGastos, entradas: buildEntradas, saldo: buildSaldo, extrato: buildSaldo };
    const spec = builders[intent](doc);
    if (!spec) return null;
    spec.source = sourceName(doc);
    spec.docId = doc.id;
    spec.financial = true;
    return spec;
  }

  function describe(spec) {
    if (!spec) return '';
    const fmt = (v) => (spec.money ? formatBRL(v) : String(v));
    return `${spec.title}: ` + spec.items.map((i) => `${i.label} ${fmt(i.value)}`).join(', ');
  }

  // Relatorio completo (Ver lancamentos)
  function buildReport(doc) {
    if (!doc || !doc.parsedFinancial || !doc.parsedFinancial.isFinancial) return null;
    const fin = doc.parsedFinancial;
    const saldo = buildSaldo(doc);
    const gastos = buildGastos(doc);
    const pixIn = fin.entries.filter((e) => e.amount > 0 && /pix/i.test(e.description || '')).reduce((s, e) => s + e.amount, 0);
    const recent = sortedEntries(fin).slice(-10).reverse().map((e) => ({ date: shortDay(e.date), what: cleanDesc(e.description), value: e.amount, text: (e.amount > 0 ? '+ ' : '- ') + formatBRL(Math.abs(e.amount)) }));
    return {
      title: doc.title || sourceName(doc), source: sourceName(doc), accountInfo: fin.accountInfo || '',
      glance: [
        { label: 'Entrou', value: formatBRL(fin.totalCredits), tone: 'in' },
        { label: 'Saiu', value: formatBRL(fin.totalDebits), tone: 'out' },
        { label: 'Sobrou', value: formatBRL(fin.totalCredits - fin.totalDebits), tone: 'net' },
        { label: fin.balance !== null && Number.isFinite(fin.balance) ? 'Saldo' : 'Lançamentos', value: fin.balance !== null && Number.isFinite(fin.balance) ? formatBRL(fin.balance) : String(fin.entryCount), tone: 'bal' }
      ],
      saldo, gastos,
      entradas: [
        { label: 'Pix', value: pixIn },
        { label: 'Outras entradas', value: Math.max(0, fin.totalCredits - pixIn) }
      ].filter((i) => i.value > 0),
      recent
    };
  }

  function homeSummary(docs) {
    const list = docs || [];
    const sorted = list.slice().sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    const finDoc = pickFinancialDoc(list);
    let saldo = null;
    if (finDoc) {
      const s = buildSaldo(finDoc);
      saldo = { big: s.big, label: s.bigLabel, points: s.items.map((p) => p.value), source: sourceName(finDoc) };
    }
    return {
      total: list.length,
      byType: (buildDocs(list) || { items: [] }).items.slice(0, 4),
      last: sorted[0] ? { title: sorted[0].title || sourceName(sorted[0]), category: sorted[0].category || 'Geral', createdAt: sorted[0].createdAt || '' } : null,
      saldo
    };
  }

  // ===== Outros jeitos de ver (oferecidos como pergunta abaixo da resposta) =====
  function buildBalanceBar(doc) {
    const fin = doc && doc.parsedFinancial;
    if (!fin || !fin.isFinancial || !(fin.totalCredits || fin.totalDebits)) return null;
    const net = fin.totalCredits - fin.totalDebits;
    return {
      kind: 'balance', money: true, title: 'Entrou × saiu',
      big: formatBRL(Math.abs(net)), bigLabel: net >= 0 ? 'sobrou no período' : 'faltou no período',
      items: [{ label: 'Entrou', value: fin.totalCredits, tone: 'in' }, { label: 'Saiu', value: fin.totalDebits, tone: 'out' }],
      source: sourceName(doc), docId: doc.id, financial: true
    };
  }

  function buildCalendar(doc) {
    const fin = doc && doc.parsedFinancial;
    if (!fin || !fin.isFinancial) return null;
    const byDay = new Map();
    let month = null;
    fin.entries.filter((e) => e.amount < 0).forEach((e) => {
      const m = String(e.date || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!m) return;
      const key = `${m[3]}-${m[2]}`;
      if (!month) month = { key, m: Number(m[2]), y: Number(m[3].length === 2 ? `20${m[3]}` : m[3]) };
      if (key !== month.key) return;
      const d = Number(m[1]);
      byDay.set(d, (byDay.get(d) || 0) + Math.abs(e.amount));
    });
    if (!month || !byDay.size) return null;
    const days = new Date(month.y, month.m, 0).getDate();
    const max = Math.max(...byDay.values());
    const items = [];
    for (let d = 1; d <= days; d++) {
      const v = byDay.get(d) || 0;
      items.push({ label: String(d), value: v, level: v === 0 ? 0 : Math.max(1, Math.ceil((v / max) * 3)) });
    }
    const top = Array.from(byDay).sort((a, b) => b[1] - a[1])[0];
    const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    return {
      kind: 'calendar', money: true, title: `Gastos por dia em ${nomes[month.m - 1]}: quanto mais claro, mais gastou`,
      big: formatBRL(top[1]), bigLabel: `dia ${top[0]}, o dia que mais gastou`,
      items, firstWeekday: new Date(month.y, month.m - 1, 1).getDay(),
      source: sourceName(doc), docId: doc.id, financial: true
    };
  }

  // Linha do tempo a partir do texto do curriculo: linhas com periodo "2018 - 2020" ou "2023 - atual"
  function buildCvTimeline(doc) {
    const text = doc && (doc.textContent || doc.summary || '');
    if (!text) return null;
    const nowY = new Date().getFullYear();
    const rx = /((?:19|20)\d{2})\s*(?:-|–|—|a|ate|até)\s*((?:19|20)\d{2}|atual|hoje|presente|o momento|atualmente)/i;
    const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    lines.forEach((line, i) => {
      const m = line.match(rx);
      if (!m) return;
      const from = Number(m[1]);
      const to = /^\d+$/.test(m[2]) ? Number(m[2]) : nowY;
      if (to < from || to - from > 50) return;
      let label = line.replace(m[0], '').replace(/[|·•\-–—,()]+\s*$/, '').replace(/^\s*[|·•\-–—,()]+/, '').trim();
      if (label.length < 3 && i > 0) label = lines[i - 1];
      items.push({ label: label.slice(0, 48) || 'Experiência', from, to, open: !/^\d+$/.test(m[2]) });
    });
    if (!items.length) return null;
    items.sort((a, b) => a.from - b.from);
    const start = items[0].from;
    const end = Math.max(...items.map((i) => i.to));
    return {
      kind: 'timeline', money: false, title: 'Linha do tempo do currículo',
      big: `${end - start} ${end - start === 1 ? 'ano' : 'anos'}`, bigLabel: `de ${start} até ${items.some((i) => i.open) ? 'hoje' : end}`,
      items: items.slice(0, 8), start, end, source: sourceName(doc), docId: doc.id
    };
  }

  function pickCvDoc(docs) {
    const cv = (docs || []).filter((d) => d && norm(d.category) === 'curriculos');
    cv.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    return cv[0] || null;
  }

  function isCvPrompt(prompt) {
    return /(^\/(curriculo|cv|resume)\b|curriculo|experiencias?\b|trajetoria|formacao)/.test(norm(prompt));
  }

  /** Opcoes "Quer ver de outro jeito?" para colocar abaixo da resposta. */
  function viewOptions(prompt, docs, { route, shown } = {}) {
    if (route === 'nota') return [];
    const intent = detectIntent(prompt);
    const out = [];
    if (isFinancialIntent(intent)) {
      const doc = pickFinancialDoc(docs);
      if (doc) {
        if (shown !== 'balance' && buildBalanceBar(doc)) out.push({ id: 'balance', label: 'Entrou × saiu' });
        if (buildCalendar(doc)) out.push({ id: 'calendar', label: 'Gastos por dia' });
        if (intent !== 'gastos' && buildGastos(doc)) out.push({ id: 'gastos', label: 'Maiores gastos' });
      }
    } else if (isCvPrompt(prompt)) {
      const cv = pickCvDoc(docs);
      if (cv && buildCvTimeline(cv)) out.push({ id: 'timeline', label: 'Linha do tempo' });
    }
    return out;
  }

  function buildView(id, docs) {
    if (id === 'timeline') return buildCvTimeline(pickCvDoc(docs));
    const doc = pickFinancialDoc(docs);
    if (!doc) return null;
    if (id === 'balance') return buildBalanceBar(doc);
    if (id === 'calendar') return buildCalendar(doc);
    if (id === 'gastos') {
      const g = buildGastos(doc);
      if (g) Object.assign(g, { source: sourceName(doc), docId: doc.id, financial: true });
      return g;
    }
    return null;
  }

  return { norm, formatBRL, detectIntent, isFinancialIntent, pickFinancialDoc, buildInsight, buildReport, homeSummary, describe, viewOptions, buildView, buildCalendar, buildBalanceBar, buildCvTimeline };
});
