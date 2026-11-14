# Roteamento por ação, mascote no canto e histórico local — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada mensagem tem um destino explícito (Perguntar = IA, Procurar = índice sem IA, Guardar = Obsidian sem IA), escolhido por botão ou por código no texto; a janela flutuante gruda no canto onde foi solta e reabre ali; as conversas ficam gravadas em arquivos locais.

**Architecture:** Um módulo puro `routeResolver.js` decide o destino a partir do texto e do padrão configurado; `localAiService.chat()` passa a consultar esse módulo antes de qualquer coisa. O renderer só exibe o destino e envia `route`. O encaixe no canto vive em `main.js` (que já controla o arrasto da janela) e persiste em `mpe.config.json` sob a nova chave `ui`. O histórico é um arquivo Markdown por dia em `./arquivos/Historico`, indexado pelo mecanismo já existente.

**Tech Stack:** Electron 35, Node (CommonJS), HTML/CSS puro, testes em `scripts/run-tests.js` (Node sem Electron, `assert`).

**Spec:** Canvas de design "Katharos Nous — UI responsiva e roteamento por código" (artboards Chat com histórico, Mascote, Ajustes, Sistema) + esta conversa.

## Global Constraints

- Sem emojis em código, logs, HTML, CSS ou mensagens (AGENTS.md §1).
- Textos de interface em pt-BR, curtos, sem jargão na tela padrão: usar **Perguntar / Procurar / Guardar**; nunca "IA", "modelo", "inferência", "offline", "vault" fora de Ajustes > Avançado.
- Paleta existente: fundo `#080D16`, ciano `#56B6ED`/`#73F3FF`, dourado `#FFD584`/`#FFB833`. Cores de ação: Perguntar `#E8B04B`, Procurar `#5CC8E8`, Guardar `#86D6A0`. Cada ação sempre com cor + ícone SVG inline + palavra.
- Alvos de clique com no mínimo 44 px de altura.
- Nada sai do computador: nenhuma chamada de rede nova.
- Testes novos entram em `scripts/run-tests.js` como `runCase(...)`; `npm test` deve continuar passando.
- Commits pequenos, mensagens em pt-BR, prefixo `feat:`/`fix:`/`test:`.

## Review Focus

1. `@IA`, `@Ia`, `@nota ` com espaço duplo e `@local` seguido de quebra de linha devem resolver igual a `@ia`/`@nota`/`@local` (teste em Task 1).
2. Texto que é só o código (`"@local"`) deve devolver `cleanText === ''` e o chat deve responder "Escreva o que quer encontrar" sem chamar o modelo (teste em Task 2).
3. `mpe.config.json` antigo, sem a chave `ui`, deve carregar com os padrões sem lançar erro (teste em Task 3).
4. Canto salvo em um monitor que não existe mais deve cair para o canto inferior direito do monitor principal (teste em Task 4).
5. Mensagem enviada com destino `nota` e Obsidian inacessível deve devolver `ok:false` com texto legível, sem exceção no renderer (teste em Task 2).

---

### Task 1: Resolvedor de rota (módulo puro)

**Files:**
- Create: `codigo/src/main/routeResolver.js`
- Test: `codigo/scripts/run-tests.js` (nova suíte `ROUTE`)

**Interfaces:**
- Produces: `resolveRoute(text: string, defaultRoute: 'ia'|'local'|'nota' = 'ia') -> { route: 'ia'|'local'|'nota', cleanText: string, source: 'code'|'command'|'default' }`
- Produces: `ROUTE_LABELS = { ia: 'Perguntar', local: 'Procurar', nota: 'Guardar' }`
- Produces: `LOCAL_COMMANDS` (Set) = rapido, fast, achar, localizar, doc, buscar, arquivos, extrato, saldo, recibo, obsidian, memoria, exemplos, status, param, historico
- Produces: `NOTA_COMMANDS` (Set) = salvar, salvar-arquivo, lembrar, treinar

Regras: código reconhecido no início do texto, sem distinção de maiúsculas, com aliases: `@ia|@perguntar` → ia, `@local|@procurar` → local, `@nota|@guardar` → nota. Com código, `cleanText` é o texto sem o código e sem espaços nas pontas, `source:'code'`. Sem código e texto começando com `/`: a rota vem do comando (`LOCAL_COMMANDS` → local, `NOTA_COMMANDS` → nota, qualquer outro → ia), `source:'command'`, `cleanText` = texto original. Caso contrário `route = defaultRoute`, `source:'default'`.

- [ ] **Step 1: Escrever os testes** em `run-tests.js`, dentro de `main()`, antes das suítes existentes:

```js
await runCase('ROUTE', 'R1', 'codigo @ia define rota ia', () => {
  const r = resolveRoute('@ia qual meu saldo?', 'local');
  assert.deepStrictEqual(r, { route: 'ia', cleanText: 'qual meu saldo?', source: 'code' });
});
await runCase('ROUTE', 'R2', 'maiusculas e espacos extras', () => {
  assert.strictEqual(resolveRoute('@IA  oi').cleanText, 'oi');
  assert.strictEqual(resolveRoute('@Nota\nreceita').route, 'nota');
  assert.strictEqual(resolveRoute('@local\n').cleanText, '');
});
await runCase('ROUTE', 'R3', 'aliases em portugues', () => {
  assert.strictEqual(resolveRoute('@procurar multa').route, 'local');
  assert.strictEqual(resolveRoute('@guardar x').route, 'nota');
  assert.strictEqual(resolveRoute('@perguntar x').route, 'ia');
});
await runCase('ROUTE', 'R4', 'comandos / escolhem rota', () => {
  assert.deepStrictEqual(resolveRoute('/buscar extrato'), { route: 'local', cleanText: '/buscar extrato', source: 'command' });
  assert.strictEqual(resolveRoute('/lembrar fato').route, 'nota');
  assert.strictEqual(resolveRoute('/resumir pdf').route, 'ia');
});
await runCase('ROUTE', 'R5', 'sem codigo usa o padrao', () => {
  assert.deepStrictEqual(resolveRoute('oi', 'nota'), { route: 'nota', cleanText: 'oi', source: 'default' });
  assert.strictEqual(resolveRoute('oi').route, 'ia');
  assert.strictEqual(resolveRoute('email@local.com').source, 'default');
});
```

Adicionar no topo: `const { resolveRoute } = require('../src/main/routeResolver');`

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd codigo && node scripts/run-tests.js`
Expected: erro `Cannot find module '../src/main/routeResolver'`

- [ ] **Step 3: Implementar `routeResolver.js`** exportando `resolveRoute`, `ROUTE_LABELS`, `LOCAL_COMMANDS`, `NOTA_COMMANDS`. Regex do código: `/^\s*@(ia|perguntar|local|procurar|nota|guardar)(?=\s|$)/i`. Regex do comando: `/^\/([a-z-]+)/i`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd codigo && node scripts/run-tests.js`
Expected: `[PASS] R1` … `[PASS] R5`, demais suítes inalteradas.

- [ ] **Step 5: Commit**

```bash
git add codigo/src/main/routeResolver.js codigo/scripts/run-tests.js
git commit -m "feat: resolvedor de rota por codigo (@ia @local @nota) e por comando"
```

---

### Task 2: Rota aplicada no serviço de IA

**Files:**
- Modify: `codigo/src/main/localAiService.js:932-948` (`chat`)
- Modify: `codigo/src/main/main.js:546-558` (handler `mpe:ai-chat`)
- Modify: `codigo/src/preload/preload.js:36` (sem mudança de assinatura; `payload.route` passa junto)
- Test: `codigo/scripts/run-tests.js`

**Interfaces:**
- Consumes: `resolveRoute` (Task 1)
- Produces: `LocalAiService.chat({ message, mode, tone, route? }, cbs) -> { ok, text, source, route: 'ia'|'local'|'nota', ... }`. `route` recebido do renderer é o padrão; o código no texto tem precedência.
- Produces: `LocalAiService.saveNoteQuick(text) -> Promise<{ ok, fileName?, folder?, error? }>` (título = primeiros 40 caracteres da primeira linha; usa `this.saveToObsidian`).

Comportamento por rota, quando o texto limpo não começa com `/`:
- `ia` → fluxo atual (`runTask`).
- `local` → `this.handleCommand('/buscar ' + cleanText, ctx)`; resposta recebe `route:'local'` e o prefixo `Busca nos seus arquivos, sem passar pela inteligencia.\n\n`.
- `nota` → `saveNoteQuick(cleanText)`; `ok` → texto `Guardei em [pasta] como "[arquivo]". Nada foi enviado para a inteligencia.`; falha → `{ ok:false, text: 'Nao consegui guardar: <erro>' }`.
- `cleanText === ''` → `{ ok:false, route, text: 'Escreva o que quer ' + (route==='local' ? 'encontrar.' : route==='nota' ? 'guardar.' : 'perguntar.') }`, sem chamar nada.
- Comando `/` → `handleCommand` como hoje; resposta ganha `route` do resolvedor.

- [ ] **Step 1: Testes** (usam `svc` da suíte existente que instancia `LocalAiService` com pasta temporária; `svc.saveToObsidian` será substituído por stub no teste):

```js
await runCase('ROUTE', 'R6', 'chat @local busca sem LLM', async () => {
  let llmCalls = 0; const orig = svc.runTask; svc.runTask = async () => { llmCalls++; return { ok: true, text: 'x' }; };
  const res = await svc.chat({ message: '@local extrato' });
  svc.runTask = orig;
  assert.strictEqual(res.route, 'local'); assert.strictEqual(llmCalls, 0);
  assert.ok(res.text.startsWith('Busca nos seus arquivos'));
});
await runCase('ROUTE', 'R7', 'chat @nota grava e nao chama LLM', async () => {
  const orig = svc.saveToObsidian; svc.saveToObsidian = async ({ title }) => ({ ok: true, fileName: title + '.md', folder: 'Katharos_Notas' });
  const res = await svc.chat({ message: '@nota Bolo da vo: 3 ovos' });
  svc.saveToObsidian = orig;
  assert.strictEqual(res.route, 'nota'); assert.ok(res.ok); assert.ok(res.text.includes('Guardei'));
});
await runCase('ROUTE', 'R8', 'codigo vazio e falha ao guardar', async () => {
  const r1 = await svc.chat({ message: '@local' });
  assert.strictEqual(r1.ok, false); assert.ok(r1.text.includes('encontrar'));
  const orig = svc.saveToObsidian; svc.saveToObsidian = async () => ({ ok: false, error: 'Cofre inacessivel' });
  const r2 = await svc.chat({ message: 'texto', route: 'nota' });
  svc.saveToObsidian = orig;
  assert.strictEqual(r2.ok, false); assert.ok(r2.text.includes('Cofre inacessivel'));
});
```

- [ ] **Step 2: Rodar e ver falhar** — Expected: R6 falha (`res.route` undefined).
- [ ] **Step 3: Implementar** em `chat()` e `saveNoteQuick()`; em `main.js` repassar `route` do payload.
- [ ] **Step 4: Rodar e ver passar** — Expected: R6, R7, R8 PASS; suíte `AI` existente inalterada.
- [ ] **Step 5: Commit** — `feat: chat aplica rota (ia/local/nota) antes do modelo`

---

### Task 3: Configuração `ui` (rota padrão, canto, letras grandes)

**Files:**
- Modify: `codigo/src/main/configManager.js:27-94` (defaults) e `:148-199` (merge no `load`)
- Test: `codigo/scripts/run-tests.js`

**Interfaces:**
- Produces: `config.ui = { defaultRoute: 'ia', largeText: false, miniCorner: null | { corner: 'tl'|'tr'|'bl'|'br', displayId: number } }`

- [ ] **Step 1: Teste** na suíte `CONFIG` existente (que já cria um `ConfigManager` em pasta temporária com um JSON antigo):

```js
await runCase('CONFIG', 'C9', 'chave ui com padroes em config antigo', () => {
  assert.deepStrictEqual(loaded.ui, { defaultRoute: 'ia', largeText: false, miniCorner: null });
});
await runCase('CONFIG', 'C10', 'ui preservada ao salvar', () => {
  mgr.save({ ui: { defaultRoute: 'nota', largeText: true, miniCorner: { corner: 'tl', displayId: 7 } } });
  const again = new ConfigManager(mgr.rootDir, mgr.codeDir).load();
  assert.strictEqual(again.ui.defaultRoute, 'nota'); assert.strictEqual(again.ui.miniCorner.corner, 'tl');
});
```
(`loaded` e `mgr` são os nomes já usados nessa suíte; ajustar se diferirem.)

- [ ] **Step 2: Rodar e ver falhar** — Expected: C9 falha (`loaded.ui` undefined).
- [ ] **Step 3: Implementar**: adicionar `ui` em `getDefaults()`; em `load()`, `rootData.ui = Object.assign({}, defaults.ui, rootData.ui || {})` e validar `defaultRoute` em `['ia','local','nota']` (senão `'ia'`).
- [ ] **Step 4: Rodar e ver passar**.
- [ ] **Step 5: Commit** — `feat: config ui (rota padrao, canto da janela, letras grandes)`

---

### Task 4: Janela gruda no canto e reabre nele

**Files:**
- Create: `codigo/src/main/cornerSnap.js`
- Modify: `codigo/src/main/main.js:93-98` (`stopMiniDrag`), `:134-176` (`summonMiniAssistant`)
- Test: `codigo/scripts/run-tests.js`

**Interfaces:**
- Produces (puro, testável): `nearestCorner(bounds: {x,y,width,height}, workArea: {x,y,width,height}) -> 'tl'|'tr'|'bl'|'br'` pelo centro da janela.
- Produces: `cornerBounds(corner, size: {width,height}, workArea, margin = 12) -> {x,y,width,height}`.
- Produces: `pickDisplay(displays: Array<{id, workArea}>, primaryId, savedDisplayId) -> display` (o salvo se existir, senão o principal).

Em `main.js`:
- `stopMiniDrag()` passa a receber `{ snap = true }`: ao terminar um arrasto real, calcula `nearestCorner`, chama `mainWindow.setBounds(cornerBounds(...), true)` (animado) e grava `configManager.save({ ui: Object.assign({}, cfg.ui, { miniCorner: { corner, displayId } }) })`.
- `summonMiniAssistant()`: se `cfg.ui.miniCorner` existe, posiciona em `cornerBounds` do display escolhido por `pickDisplay`, **para qualquer `source`**; se não existe, comportamento atual. Decisão registrada: o canto salvo vence inclusive o atalho do mouse. Para voltar ao comportamento "abre no cursor" basta limitar a condição a `source !== 'mouse-hook'`.
- `resizeMiniWindow()`: quando há canto salvo, manter a janela ancorada no canto ao crescer (recalcular `x`/`y` com `cornerBounds` após definir o novo tamanho).

- [ ] **Step 1: Testes**

```js
const { nearestCorner, cornerBounds, pickDisplay } = require('../src/main/cornerSnap');
await runCase('CORNER', 'K1', 'canto mais proximo pelo centro', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.strictEqual(nearestCorner({ x: 10, y: 10, width: 576, height: 220 }, wa), 'tl');
  assert.strictEqual(nearestCorner({ x: 1300, y: 700, width: 576, height: 220 }, wa), 'br');
  assert.strictEqual(nearestCorner({ x: 1300, y: 10, width: 576, height: 220 }, wa), 'tr');
});
await runCase('CORNER', 'K2', 'bounds do canto com margem', () => {
  const wa = { x: 100, y: 50, width: 1000, height: 500 };
  assert.deepStrictEqual(cornerBounds('br', { width: 300, height: 200 }, wa), { x: 788, y: 338, width: 300, height: 200 });
  assert.deepStrictEqual(cornerBounds('tl', { width: 300, height: 200 }, wa), { x: 112, y: 62, width: 300, height: 200 });
});
await runCase('CORNER', 'K3', 'monitor salvo inexistente cai no principal', () => {
  const ds = [{ id: 1, workArea: {} }, { id: 2, workArea: {} }];
  assert.strictEqual(pickDisplay(ds, 1, 2).id, 2);
  assert.strictEqual(pickDisplay(ds, 1, 99).id, 1);
  assert.strictEqual(pickDisplay(ds, 1, null).id, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**.
- [ ] **Step 3: Implementar `cornerSnap.js`** e as mudanças em `main.js` descritas acima.
- [ ] **Step 4: Rodar testes e ver passar**; depois teste manual: `npm start`, arrastar a janela pelo cabeçalho até perto de um canto, soltar, ver deslizar; fechar com ESC; abrir pelo tray e pelo atalho e confirmar que reabre no mesmo canto; conferir `mpe.config.json` → `ui.miniCorner`.
- [ ] **Step 5: Commit** — `feat: janela flutuante gruda no canto mais proximo e reabre nele`

---

### Task 5: Chat lateral com três ações

**Files:**
- Modify: `codigo/src/renderer/index.html:149-184` (barra de entrada do chat)
- Modify: `codigo/src/renderer/js/app.js:1160-1248` (`sendSideChatMessage`), `:1384-1422` (summoned: aplicar `ui.defaultRoute` e `ui.largeText`)
- Modify: `codigo/src/renderer/styles/main.css` (novas classes `.route-bar`, `.route-btn`, `.route-btn.active`, `.route-status`, `body.large-text`)

**Interfaces:**
- Consumes: `window.mpeApi.aiChat({ message, mode, tone, requestId, route })` (Task 2); `currentConfig.ui` (Task 3); `resolveRoute` não existe no renderer: o renderer detecta o código com a mesma regex (`/^\s*@(ia|perguntar|local|procurar|nota|guardar)(?=\s|$)/i`) só para atualizar a barra enquanto digita.
- Produces: `currentRoute` (variável de módulo, `'ia'|'local'|'nota'`); função `setRoute(route, { fromText })`.

Markup, acima de `#side-chat-input`:
```html
<div class="route-bar" role="group" aria-label="O que voce quer fazer">
  <button type="button" class="route-btn" data-route="ia" aria-pressed="true">[svg balao] Perguntar</button>
  <button type="button" class="route-btn" data-route="local" aria-pressed="false">[svg lupa] Procurar</button>
  <button type="button" class="route-btn" data-route="nota" aria-pressed="false">[svg marcador] Guardar</button>
</div>
<div id="route-status" class="route-status">Vai para a inteligencia</div>
```
Textos de status: ia → `Vai para a inteligencia`; local → `Nao vai para a inteligencia. Busca nos seus arquivos`; nota → `Nao vai para a inteligencia. Guarda como anotacao`. Sufixo ` (definido pelo codigo)` quando a rota veio do texto.
`#btn-side-chat-send` passa a mostrar `Perguntar`/`Procurar`/`Guardar` e a classe `route-ia|route-local|route-nota`; `#side-chat-input` recebe `border-color` da cor da ação. A mensagem do usuário no chat ganha a etiqueta `perguntou`/`procurou`/`guardou` ao lado de `VOCE`. Os botões `Salvar Arquivo` e `Salvar no Obsidian` do rodapé passam a ficar dentro de um `<details>` "Mais" para não concorrer com a ação principal. Os selects Modo/Tom/Perfil (`.side-chat-params`) ganham `class="hidden"` por padrão e um botão `Ajustes finos` no cabeçalho do chat que os alterna.

- [ ] **Step 1: Verificação automatizada** (self-test já existente em `main.js:269-285`): acrescentar ao `chatCheck` `hasRouteBar: Boolean(document.querySelector('.route-bar'))` e `routeBtnCount: document.querySelectorAll('.route-btn').length` e exigir `routeBtnCount === 3`.
- [ ] **Step 2: Rodar `npm start -- --self-test`** e ver falhar em `routeBtnCount`.
- [ ] **Step 3: Implementar** markup, CSS e JS. `sendSideChatMessage` envia `route: currentRoute`; após resposta, se `res.route` existir, atualiza a etiqueta da mensagem do usuário. Ao receber `mpe:mini-assistant-summoned`, `setRoute(currentConfig.ui.defaultRoute)` e `document.body.classList.toggle('large-text', currentConfig.ui.largeText)`.
- [ ] **Step 4: Rodar `npm start -- --self-test`** → `KATHAROS_SELF_TEST_PASSED`; conferir `prints/Verificacao/verify_2_katharos_chat.png` a olho: três botões visíveis, status legível.
- [ ] **Step 5: Commit** — `feat: chat com acoes Perguntar/Procurar/Guardar e status do destino`

---

### Task 6: Mini assistente com três ações

**Files:**
- Modify: `codigo/src/renderer/index.html:49-73` (barra de controles do mini)
- Modify: `codigo/src/renderer/js/app.js:464-627` (`setupMiniAssistant`, handler de `btn-mini-send`)
- Modify: `codigo/src/renderer/styles/main.css`

**Interfaces:**
- Consumes: `window.mpeApi.aiChat` (Task 2), `window.mpeApi.saveToObsidian` (existente), `katarosMascot.runWithProcessing` (existente).

Mudanças: os quatro botões `Colar / Revisar / Copiar / Salvar Arquivo` e o grupo `Enviar: [select]` são substituídos por uma linha com três botões grandes `btn-mini-route-ia` (Perguntar), `btn-mini-route-local` (Procurar), `btn-mini-route-nota` (Guardar), mais um `<details>` "Mais" contendo `Colar`, `Revisar`, `Copiar`, `Salvar Arquivo` e o select antigo (Bloco de Notas / Telegram) com seu botão `Enviar`. Os campos `Título / Pasta / Tags` só aparecem com Guardar selecionado (clique em Guardar com texto preenchido salva direto; com campo vazio, mostra o toast `Escreva o que quer guardar.`).
- Perguntar → abre o drawer do chat, coloca o texto em `#side-chat-input`, `setRoute('ia')` e chama `sendSideChatMessage()`.
- Procurar → idem com `setRoute('local')`.
- Guardar → mesmo código do ramo `destination === 'obsidian'` atual.
- O mascote: `kataros-node-sub` passa a mostrar `PRONTO` / `PENSANDO` / `GUARDADO` / `MODELO PARADO` em vez de `LOCAL OK` (mapear em `refreshAiStatus`: `ready` → PRONTO, `engine === 'offline'` ou `error` → MODELO PARADO; `runWithProcessing` já troca para processamento; após salvar nota com sucesso, `GUARDADO` por 3 s via `setTimeout`).

- [ ] **Step 1: Self-test**: no `miniCheck` de `main.js:246-261`, trocar `btnReview.click()` por clicar em `btn-mini-route-nota` com `saveToObsidian` real (vault temporário já existe em `./arquivos/Obsidian_Vault`) e exigir `document.getElementById('kataros-node-sub').textContent === 'GUARDADO'` 500 ms depois; manter a verificação de `btn-mini-review` via "Mais".
- [ ] **Step 2: Rodar self-test** e ver falhar.
- [ ] **Step 3: Implementar**.
- [ ] **Step 4: Rodar self-test** → PASS; abrir `verify_1_katharos_mini.png` e conferir os três botões.
- [ ] **Step 5: Commit** — `feat: mini assistente com Perguntar/Procurar/Guardar e estados do mascote`

---

### Task 7: Ajustes básicos (rota padrão e letras grandes)

**Files:**
- Modify: `codigo/src/renderer/index.html:233-308` (modal de configurações: nova coluna "Basico" no topo da primeira coluna)
- Modify: `codigo/src/renderer/js/app.js:24-72` (`openSettingsModal`), `:74-137` (`saveSettingsFromModal`)

**Interfaces:**
- Consumes/produces: `config.ui.defaultRoute`, `config.ui.largeText` (Task 3).

Campos: `<select id="cfg-default-route">` (Perguntar/Procurar/Guardar) e `<input type="checkbox" id="cfg-large-text">` com rótulo "Letras grandes (aumenta tudo em 25%)". `body.large-text { font-size: 125% }` já criado na Task 5. A seção "Motor de I.A / Perfil de Desempenho" existente fica dentro de `<details><summary>Avancado</summary>`.

- [ ] **Step 1: Self-test**: no `settingsCheck` de `main.js:305-320`, exigir `Boolean(document.getElementById('cfg-default-route'))`.
- [ ] **Step 2: Rodar e ver falhar.** — [ ] **Step 3: Implementar.** — [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat: ajustes basicos (acao padrao, letras grandes, avancado recolhido)`

---

### Task 8: Histórico local das conversas

**Files:**
- Create: `codigo/src/main/chatHistoryStore.js`
- Modify: `codigo/src/main/localAiService.js:932-948` (gravar após cada troca), `:1916` (novo `case 'historico'`), `HELP_TEXT` e a tabela de comandos usada por `resolveSlashCommand` (adicionar `historico`)
- Modify: `codigo/src/renderer/js/app.js:670-729` (novo item `{ id: 'historico', label: '/historico', cmd: '/historico ', cat: 'docs' }`) e `:1165-1170` (carregar `sentPromptHistory` inicial de `getRecentPrompts`)
- Modify: `codigo/src/main/main.js` e `preload.js` (IPC `mpe:ai-recent-prompts` → `recentPrompts()`)
- Test: `codigo/scripts/run-tests.js`

**Interfaces:**
- Produces: `class ChatHistoryStore { constructor(rootDir); append({ role: 'user'|'assistant', route, text, at? }) -> string (caminho do arquivo); listDays() -> string[] (AAAA-MM-DD, mais recente primeiro); search(term, max = 5) -> [{ day, line, text }]; recentPrompts(max = 40) -> string[] }`
- Arquivo: `./arquivos/Historico/AAAA-MM-DD.md`, uma linha por mensagem: `- HH:MM [voce|katharos][ia|local|nota] texto` (quebras de linha do texto viram espaço). Por estar em `./arquivos` com extensão `.md`, o indexador existente passa a encontrar conversas antigas em `/rapido` e `/buscar` sem código extra.
- `/historico` → lista os últimos 7 dias com contagem de mensagens; `/historico <termo>` → `search(termo)`.

- [ ] **Step 1: Testes**

```js
const ChatHistoryStore = require('../src/main/chatHistoryStore');
await runCase('HIST', 'H1', 'append cria arquivo do dia e lista', () => {
  const dir = makeTempDir('kn-hist-'); const st = new ChatHistoryStore(dir);
  const p = st.append({ role: 'user', route: 'local', text: 'multa\ncontrato', at: new Date('2026-11-14T13:40:00') });
  assert.ok(p.endsWith(path.join('arquivos', 'Historico', '2026-11-14.md')));
  assert.ok(fs.readFileSync(p, 'utf-8').includes('- 13:40 [voce][local] multa contrato'));
  assert.deepStrictEqual(st.listDays(), ['2026-11-14']); rmSafe(dir);
});
await runCase('HIST', 'H2', 'search e recentPrompts', () => {
  const dir = makeTempDir('kn-hist-'); const st = new ChatHistoryStore(dir);
  st.append({ role: 'user', route: 'ia', text: 'quanto entrou via pix', at: new Date('2026-11-13T10:00:00') });
  st.append({ role: 'assistant', route: 'ia', text: 'R$ 2.340,00', at: new Date('2026-11-13T10:00:05') });
  st.append({ role: 'user', route: 'nota', text: 'bolo da vo', at: new Date('2026-11-14T09:00:00') });
  assert.strictEqual(st.search('pix').length, 1);
  assert.deepStrictEqual(st.recentPrompts(), ['quanto entrou via pix', 'bolo da vo']); rmSafe(dir);
});
await runCase('HIST', 'H3', 'chat grava usuario e resposta', async () => {
  const before = svc.history.recentPrompts().length;
  const orig = svc.runTask; svc.runTask = async () => ({ ok: true, text: 'resposta', source: 'llm' });
  await svc.chat({ message: 'pergunta de teste' }); svc.runTask = orig;
  assert.strictEqual(svc.history.recentPrompts().length, before + 1);
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `chatHistoryStore.js`; em `LocalAiService` constructor: `this.history = new ChatHistoryStore(rootDir)`; em `chat()`, após obter a resposta final (inclusive de comando), `append` da pergunta e da resposta (texto da resposta limitado a 2000 caracteres); `case 'historico'`; IPC e carregamento de `sentPromptHistory`.
- [ ] **Step 4: Rodar e ver passar.** Teste manual: enviar duas mensagens, fechar, reabrir, seta ↑ recupera a última; `/rapido <palavra dita antes>` encontra a conversa.
- [ ] **Step 5: Commit** — `feat: historico local das conversas em arquivos/Historico`

---

### Task 9: Documentação do contexto da IA

**Files:**
- Modify: `CONTEXTO_IA.md` (nova seção `## 0. Destinos: Perguntar, Procurar, Guardar` antes da seção 1, com os códigos `@ia @local @nota` e seus aliases, a lista de comandos que são "sem IA", e o comando `/historico`)
- Modify: `codigo/docs/2-COMO-SALVAR-ATALHOS.md` (parágrafo sobre o canto salvo em `ui.miniCorner`)

- [ ] **Step 1: Escrever as seções.** — [ ] **Step 2: `npm test`** continua verde (o teste de leitura do `CONTEXTO_IA.md`, se houver, não quebra). — [ ] **Step 3: Commit** — `docs: destinos por codigo, historico e canto da janela`

---

## Fora deste plano (próximo plano)

- Estilos de atalho B (botões ao redor do mascote) e C (barra na borda): exigem uma segunda `BrowserWindow` sempre visível; planejar depois que A estiver em uso.
- Botão de microfone (ditado): começar sugerindo `Win + H` no texto de ajuda.
- Lista de conversas na barra lateral (artboard "Chat com histórico"): depende da Task 8 e de uma reorganização maior do `index.html`.
