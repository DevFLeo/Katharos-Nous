/**
 * Resolvedor de rota do Katharos Nous.
 * Decide para onde vai cada mensagem:
 *  - ia    (Perguntar): passa pelo modelo local
 *  - local (Procurar):  busca no indice de arquivos, sem passar pelo modelo
 *  - nota  (Guardar):   grava como anotacao no Obsidian, sem passar pelo modelo
 */

const ROUTES = ['ia', 'local', 'nota'];

const ROUTE_LABELS = { ia: 'Perguntar', local: 'Procurar', nota: 'Guardar' };

const CODE_TO_ROUTE = {
  ia: 'ia',
  perguntar: 'ia',
  local: 'local',
  procurar: 'local',
  nota: 'nota',
  guardar: 'nota'
};

const LOCAL_COMMANDS = new Set([
  'rapido', 'fast', 'achar', 'localizar', 'doc', 'buscar', 'arquivos', 'extrato',
  'saldo', 'recibo', 'obsidian', 'memoria', 'exemplos', 'status', 'param', 'historico'
]);

const NOTA_COMMANDS = new Set(['salvar', 'salvar-arquivo', 'lembrar', 'treinar']);

const CODE_RE = /^\s*@(ia|perguntar|local|procurar|nota|guardar)(?=\s|$)/i;
const COMMAND_RE = /^\/([a-z-]+)/i;

function normalizeRoute(route, fallback = 'ia') {
  return ROUTES.includes(route) ? route : fallback;
}

function resolveRoute(text, defaultRoute = 'ia') {
  const raw = String(text == null ? '' : text);
  const codeMatch = raw.match(CODE_RE);
  if (codeMatch) {
    return {
      route: CODE_TO_ROUTE[codeMatch[1].toLowerCase()],
      cleanText: raw.slice(codeMatch[0].length).trim(),
      source: 'code'
    };
  }

  const trimmed = raw.trim();
  const cmdMatch = trimmed.match(COMMAND_RE);
  if (cmdMatch) {
    const cmd = cmdMatch[1].toLowerCase();
    const route = LOCAL_COMMANDS.has(cmd) ? 'local' : NOTA_COMMANDS.has(cmd) ? 'nota' : 'ia';
    return { route, cleanText: trimmed, source: 'command' };
  }

  return { route: normalizeRoute(defaultRoute), cleanText: trimmed, source: 'default' };
}

module.exports = { resolveRoute, normalizeRoute, ROUTES, ROUTE_LABELS, LOCAL_COMMANDS, NOTA_COMMANDS };
