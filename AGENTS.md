# Diretrizes de Engenharia e Design do Katharos Nous | katharos AI

## 1. Invariantes de Estilo e Comunicacao
- Proibicao estrita de emojis em qualquer arquivo de codigo, logs, interfaces visuais (HTML/CSS/JS) ou mensagens de console.
- Textos da interface (Mini Assistente, Chat Lateral, modais e notificacoes) devem ser concisos, diretos e objetivos, sem explicacoes redundantes ou duplicadas.
- Manter identidade visual Sci-Fi Ciano/Azul (`#56B6ED`, `#73F3FF`, `#0A101A`, `#080D16`) com mascote 3D Giroscopio Dourado/Ambar (`#FFD584`, `#FFB833`, `#E5B84B`) e titulo `Katharos Nous | katharos AI`.
- Tokens visuais em `codigo/src/renderer/styles/theme.css` (camada sobre `main.css`): fundo `#070B12`, painel `#0D1522`, ciano `#56B6ED`/`#73F3FF`; dourado so no mascote. Acoes: Perguntar ciano `#73F3FF`, Procurar violeta `#B7A6FF`, Guardar verde `#86D6A0`, sempre com cor + icone + palavra. Rotulos em letra normal; um brilho por tela (o mascote).
- Graficos nas respostas (`js/insights.js` + `js/insights-view.js`) so aparecem quando o documento tem numeros, e sempre dizem de qual arquivo vieram; podem ser desligados em Ajustes.

## 2. Identidade Nativa no Windows e Barra de Tarefas
- Chamar explicitamente `app.setAppUserModelId('DevFLeo.KatharosNousAI')` de forma sincrona no topo de `main.js` antes de criar janelas.
- Garantir a presenca de um atalho oficial `.lnk` em `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Katharos Nous - katharos AI.lnk`, apontando para `Katharos.exe` com `assets/icon.ico` e `AppUserModelID`.
- Manter registro em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` apontando para `"...\Katharos.exe" --startup` para iniciar automaticamente junto com o Windows em coexistencia com o M.P.E.
- O processo do Katharos roda como `codigo/node_modules/electron/dist/Katharos Nous.exe`: copia do `electron.exe` com nome, descricao e icone do Katharos (e o que o Gerenciador de Tarefas mostra), gerada por `codigo/scripts/brand-electron.mjs` no `npm install` (postinstall) ou com `npm run brand`. O `Katharos.exe` abre essa copia e so usa o `electron.exe` se ela nao existir.

## 3. Foco Nativo Win32 e Entrega de Texto Entre Sistemas
- Processos em segundo plano do Windows sofrem bloqueio de foco (`LockSetForegroundWindow`). Para ativar confiavelmente a janela de destino (Telegram, Bloco de Notas, Word, etc.) antes de enviar `Ctrl+V`, manter o pulso da tecla `Alt` (`VK_MENU`), seguida de `AttachThreadInput` e `SetForegroundWindow`, com desarme previo de modificadores (`KEYEVENTF_KEYUP`).
- Ao enviar texto para um sistema que nao esteja aberto no momento, iniciar o executavel correspondente e aguardar via polling a janela surgir antes de colar o conteudo.

## 4. Hook Win32 Exclusivo do Katharos Nous
- Interceptar no hook de mouse de baixo nivel (`WH_MOUSE_LL`):
  - `Shift + Ctrl + Botao Direito` (sem `Alt`): Convocacao imediata do Mini Assistente Flutuante (`TRIGGER_MINI|`), permanecendo persistente ate que `ESC` ou o botao fechar sejam acionados.
  - Nao interceptar nem bloquear `Shift + Ctrl + Alt + Botao Direito` (com `Alt`), reservado ao projeto irmao M.P.E (Mouse Performatico Estrelado).

## 5. Assistente Local Offline & Integracao Obsidian
- Manter chat lateral local offline (Mozilla `llamafile`, Ollama, LM Studio e motor gramatical embutido ~2ms), comandos rapidos `/`, controle de perfil `/boost`, parser financeiro de documentos em `./arquivos` e notas Markdown com frontmatter YAML no Obsidian Vault (`./arquivos/Obsidian_Vault`).

## 6. Contexto Raiz da I.A (CONTEXTO_IA.md) e Capacidades de Consulta Rapida
- Ler automaticamente `CONTEXTO_IA.md` da raiz de `c:\Projetos\katharos nous` (com cache por `mtimeMs`) como contexto permanente da I.A no chat.
- Garantir auto-indexacao leve de documentos em `./arquivos` (incluindo PDFs com streams `FlateDecode`, extratos, curriculos, codigos e modelos) e comandos dedicados de busca ultra-rapida (`/rapido`), consulta de PDFs (`/pdf`), consulta de curriculo (`/curriculo`) e automacao de textos no chat (`/modelo`, `/editar`).
