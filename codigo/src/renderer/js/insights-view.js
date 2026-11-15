/* Katharos Nous | katharos AI - Desenho dos graficos (DOM + SVG, sem innerHTML). */
(function (root) {
  const SVG = 'http://www.w3.org/2000/svg';
  const K = () => root.KnInsights;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    return n;
  }
  function fmt(spec, v) {
    return spec.money ? K().formatBRL(v) : String(v);
  }
  function fileIcon() {
    const s = svg('svg', { viewBox: '0 0 24 24', width: '14', height: '14', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linejoin': 'round' });
    s.appendChild(svg('path', { d: 'M6 3h8l4 4v14H6z' }));
    return s;
  }

  function cols(spec) {
    const wrap = el('div', 'kn-cols');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', K().describe(spec));
    const max = Math.max(...spec.items.map((i) => i.value), 1);
    spec.items.forEach((i) => {
      const c = el('div', 'kn-col');
      c.appendChild(el('span', 'kn-col-val', spec.money ? K().formatBRL(i.value).replace(',00', '') : String(i.value)));
      const bar = el('span', 'kn-col-bar' + (i.value === max ? ' is-top' : ''));
      bar.style.height = `${Math.max(4, Math.round((i.value / max) * 100))}%`;
      const track = el('span', 'kn-col-track');
      track.appendChild(bar);
      c.appendChild(track);
      c.appendChild(el('span', 'kn-col-lbl', i.label));
      wrap.appendChild(c);
    });
    return wrap;
  }

  function rank(spec) {
    const wrap = el('div', 'kn-rank');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', K().describe(spec));
    const max = Math.max(...spec.items.map((i) => i.value), 1);
    spec.items.forEach((i, idx) => {
      wrap.appendChild(el('span', 'kn-rank-lbl', i.label));
      const track = el('span', 'kn-rank-track');
      const fill = el('span', 'kn-rank-fill' + (idx === 0 ? ' is-top' : '') + (i.muted ? ' is-muted' : ''));
      fill.style.width = `${Math.max(3, Math.round((i.value / max) * 100))}%`;
      track.appendChild(fill);
      wrap.appendChild(track);
      wrap.appendChild(el('span', 'kn-rank-val', fmt(spec, i.value)));
    });
    return wrap;
  }

  function line(spec, height) {
    const H = height || 150;
    const W = 600;
    const vals = spec.items.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => [10 + (i * (W - 20)) / Math.max(1, vals.length - 1), 10 + (1 - (v - min) / span) * (H - 24)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'kn-line', role: 'img', 'aria-label': `${spec.title}: de ${fmt(spec, vals[0])} até ${fmt(spec, vals[vals.length - 1])}`, preserveAspectRatio: 'none' });
    s.appendChild(svg('line', { x1: '10', y1: String(H - 4), x2: String(W - 10), y2: String(H - 4), class: 'kn-line-base' }));
    s.appendChild(svg('path', { d: `${d} L${(W - 10).toFixed(1)} ${H - 4} L10 ${H - 4} Z`, class: 'kn-line-area' }));
    s.appendChild(svg('path', { d, class: 'kn-line-stroke', 'vector-effect': 'non-scaling-stroke' }));
    const lp = pts[pts.length - 1];
    s.appendChild(svg('circle', { cx: lp[0].toFixed(1), cy: lp[1].toFixed(1), r: '5', class: 'kn-line-dot' }));
    return s;
  }

  function trio(items) {
    const t = el('div', 'kn-trio');
    items.forEach((i) => {
      const box = el('div', 'kn-trio-item');
      const lbl = el('span', 'kn-trio-lbl');
      lbl.appendChild(el('span', `kn-dot tone-${i.tone}`));
      lbl.appendChild(document.createTextNode(i.label));
      box.appendChild(lbl);
      box.appendChild(el('span', 'kn-trio-val', i.value));
      t.appendChild(box);
    });
    return t;
  }

  function sourceRow(spec, opts) {
    const row = el('div', 'kn-insight-foot');
    const src = el('span', 'kn-insight-src');
    src.appendChild(fileIcon());
    src.appendChild(document.createTextNode(`De: ${spec.source}`));
    row.appendChild(src);
    if (spec.financial && opts && typeof opts.onOpenReport === 'function') {
      const b = el('button', 'kn-btn-outline', 'Ver lançamentos');
      b.type = 'button';
      b.addEventListener('click', () => opts.onOpenReport(spec.docId));
      row.appendChild(b);
    }
    return row;
  }

  function balance(spec) {
    const wrap = el('div', 'kn-balance');
    const total = spec.items.reduce((s, i) => s + i.value, 0) || 1;
    const bar = el('div', 'kn-balance-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', K().describe(spec));
    spec.items.forEach((i) => {
      const seg = el('span', `kn-balance-seg tone-${i.tone}`);
      seg.style.width = `${(i.value / total) * 100}%`;
      bar.appendChild(seg);
    });
    wrap.appendChild(bar);
    const legend = el('div', 'kn-balance-legend');
    spec.items.forEach((i) => {
      const l = el('span', 'kn-trio-lbl');
      l.appendChild(el('span', `kn-dot tone-${i.tone}`));
      l.appendChild(document.createTextNode(`${i.label} ${fmt(spec, i.value)}`));
      legend.appendChild(l);
    });
    wrap.appendChild(legend);
    return wrap;
  }

  function calendar(spec) {
    const grid = el('div', 'kn-cal');
    grid.setAttribute('role', 'img');
    grid.setAttribute('aria-label', `${spec.title}. ` + spec.items.filter((i) => i.value > 0).map((i) => `dia ${i.label} ${fmt(spec, i.value)}`).join(', '));
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach((d) => grid.appendChild(el('span', 'kn-cal-head', d)));
    for (let i = 0; i < (spec.firstWeekday || 0); i++) grid.appendChild(el('span', 'kn-cal-empty'));
    spec.items.forEach((i) => {
      const c = el('span', `kn-cal-day lvl-${i.level}`, i.label);
      c.title = i.value ? `dia ${i.label}: ${fmt(spec, i.value)}` : `dia ${i.label}: sem gastos`;
      grid.appendChild(c);
    });
    return grid;
  }

  function timeline(spec) {
    const wrap = el('div', 'kn-tl');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', spec.items.map((i) => `${i.label}, ${i.from} a ${i.open ? 'hoje' : i.to}`).join('; '));
    const span = Math.max(1, spec.end - spec.start);
    spec.items.forEach((i, idx) => {
      const row = el('div', 'kn-tl-row');
      row.appendChild(el('span', 'kn-tl-lbl', `${i.label} · ${i.from}–${i.open ? 'hoje' : i.to}`));
      const track = el('span', 'kn-rank-track');
      const fill = el('span', 'kn-rank-fill' + (idx === spec.items.length - 1 ? ' is-top' : ''));
      fill.style.marginLeft = `${((i.from - spec.start) / span) * 100}%`;
      fill.style.width = `${Math.max(3, ((i.to - i.from) / span) * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);
      wrap.appendChild(row);
    });
    const ends = el('div', 'kn-tl-ends');
    ends.appendChild(el('span', '', String(spec.start)));
    ends.appendChild(el('span', '', spec.items.some((i) => i.open) ? 'hoje' : String(spec.end)));
    wrap.appendChild(ends);
    return wrap;
  }

  // "Quer ver de outro jeito?" com uma pergunta e botoes de resposta
  function renderViewAsk(options, onPick) {
    if (!options || !options.length) return null;
    const box = el('div', 'kn-ask');
    box.appendChild(el('span', 'kn-ask-q', 'Quer ver de outro jeito?'));
    const row = el('div', 'kn-ask-row');
    options.forEach((o) => {
      const b = el('button', 'kn-chip-btn', o.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        b.remove();
        if (!row.children.length) box.remove();
        onPick(o.id);
      });
      row.appendChild(b);
    });
    box.appendChild(row);
    return box;
  }

  function renderInsightCard(spec, opts) {
    if (!spec) return null;
    const card = el('div', 'kn-insight');
    const head = el('div', 'kn-insight-big');
    head.appendChild(el('span', 'kn-big', spec.big));
    head.appendChild(el('span', 'kn-big-lbl', spec.bigLabel));
    card.appendChild(head);
    const box = el('div', 'kn-insight-chart');
    box.appendChild(el('span', 'kn-card-lbl', spec.title));
    if (spec.trio) box.appendChild(trio(spec.trio));
    if (spec.kind === 'cols') box.appendChild(cols(spec));
    else if (spec.kind === 'rank') box.appendChild(rank(spec));
    else if (spec.kind === 'line') box.appendChild(line(spec));
    else if (spec.kind === 'balance') box.appendChild(balance(spec));
    else if (spec.kind === 'calendar') box.appendChild(calendar(spec));
    else if (spec.kind === 'timeline') box.appendChild(timeline(spec));
    card.appendChild(box);
    card.appendChild(sourceRow(spec, opts));
    return card;
  }

  function renderReport(rep) {
    const wrap = el('div', 'kn-report');
    const glance = el('div', 'kn-report-glance');
    rep.glance.forEach((g) => {
      const b = el('div', 'kn-glance-item');
      const l = el('span', 'kn-trio-lbl');
      l.appendChild(el('span', `kn-dot tone-${g.tone}`));
      l.appendChild(document.createTextNode(g.label));
      b.appendChild(l);
      b.appendChild(el('span', 'kn-glance-val', g.value));
      glance.appendChild(b);
    });
    wrap.appendChild(glance);

    const grid = el('div', 'kn-report-grid');
    const c1 = el('div', 'kn-panel');
    c1.appendChild(el('span', 'kn-card-lbl', rep.saldo.title));
    c1.appendChild(line(rep.saldo, 160));
    grid.appendChild(c1);
    if (rep.gastos) {
      const c2 = el('div', 'kn-panel');
      c2.appendChild(el('span', 'kn-card-lbl', 'Por onde saiu'));
      c2.appendChild(rank(rep.gastos));
      grid.appendChild(c2);
    }
    if (rep.entradas.length) {
      const c3 = el('div', 'kn-panel');
      c3.appendChild(el('span', 'kn-card-lbl', 'Como entrou'));
      c3.appendChild(rank({ money: true, title: 'Como entrou', items: rep.entradas }));
      grid.appendChild(c3);
    }
    const c4 = el('div', 'kn-panel');
    c4.appendChild(el('span', 'kn-card-lbl', 'Últimos lançamentos'));
    const table = el('table', 'kn-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Dia', 'O quê', 'Valor'].forEach((h) => { const th = el('th', '', h); th.scope = 'col'; hr.appendChild(th); });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = el('tbody');
    rep.recent.forEach((r) => {
      const tr = el('tr');
      tr.appendChild(el('td', 'kn-muted', r.date));
      tr.appendChild(el('td', '', r.what));
      tr.appendChild(el('td', r.value > 0 ? 'kn-num tone-in-text' : 'kn-num', r.text));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    c4.appendChild(table);
    grid.appendChild(c4);
    wrap.appendChild(grid);
    return wrap;
  }

  function sparkline(values) {
    return line({ title: 'Saldo', money: true, items: values.map((v) => ({ value: v })) }, 60);
  }

  root.KnInsightsView = { renderInsightCard, renderReport, renderViewAsk, sparkline, el };
})(typeof self !== 'undefined' ? self : this);
