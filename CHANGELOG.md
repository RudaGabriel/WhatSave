# Histórico de versões — WhatSave

Todas as mudanças relevantes do projeto ficam registradas aqui. A entrada mais
recente fica sempre no topo de cada seção. O cabeçalho de cada arquivo traz
somente a entrada da versão atual.

Autor original: Jstarzz. Edição, análise e manutenção: Ruda Gabriel.

## Versões atuais dos arquivos

| Arquivo | Versão | Data |
|---|---|---|
| `manifest.json` | 1.4.3 | 2026-11-16 |
| `package.json` | 1.4.3 | 2026-11-16 |
| `background.js` | 1.4.0 | 2026-11-13 |
| `content.js` | 1.4.0 | 2026-11-13 |
| `popup.html` | 1.4.2 | 2026-11-13 |
| `popup.js` | 1.4.3 | 2026-11-16 |
| `popup.css` | 1.4.0 | 2026-11-13 |
| `inpage/app.js` | 1.4.3 | 2026-11-16 |
| `testes/ambiente.js` | 1.4.0 | 2026-11-13 |
| `testes/fabrica.js` | 1.4.0 | 2026-11-13 |
| `testes/executar.mjs` | 1.4.0 | 2026-11-13 |
| `testes/verificar-sintaxe.mjs` | 1.4.0 | 2026-11-13 |
| `testes/datas.test.js` | 1.4.0 | 2026-11-13 |
| `testes/legendas.test.js` | 1.4.0 | 2026-11-13 |
| `testes/links.test.js` | 1.4.0 | 2026-11-13 |
| `testes/nomes.test.js` | 1.4.0 | 2026-11-13 |
| `testes/ordem.test.js` | 1.4.0 | 2026-11-13 |
| `testes/projeto.test.js` | 1.4.3 | 2026-11-16 |
| `testes/zip.test.js` | 1.4.0 | 2026-11-13 |
| `testes/navegador/popup.mjs` | 1.4.2 | 2026-11-13 |
| `testes/carregar-mais.test.js` | 1.4.3 | 2026-11-16 |
| `testes/navegador/carregar-mais.mjs` | 1.4.3 | 2026-11-16 |
| `ferramentas/gerar-firefox.mjs` | 1.4.3 | 2026-11-16 |

## Extensão 1.4.3 (2026-11-16)

- "Carregar mais mensagens" corrigido: antes, a extensão rolava a lista lateral de conversas em vez do painel da conversa e podia clicar no aviso de criptografia. Agora usa a função interna do WhatsApp Web, a rolagem do painel correto e o botão de histórico do celular, e informa quantas mensagens foram carregadas.
- O aviso "'background.scripts' requires manifest version 2 or lower" não aparece mais no Chrome: o `manifest.json` é exclusivo do Chrome/Edge, e o pacote do Firefox é gerado com `npm run firefox`.

## Extensão 1.4.2 (2026-11-13)

- Subtítulo, rótulos das opções e mensagens do registro de atividade resumidos.

## Extensão 1.4.1 (2026-11-13)

- Textos de ajuda do popup resumidos, mais claros e diretos.

## Extensão 1.4.0 (2026-11-13)

- Interface, mensagens, comentários e documentação em português do Brasil.
- ZIP dividido automaticamente em partes de até 1 GB e 65.000 itens.
- Arquivos acima de 40 MB salvos diretamente pela página (limite de mensagens da extensão).
- Salvamento em ordem com memória limitada; período invertido corrigido automaticamente.
- O WhatsApp Web passa a abrir em uma nova aba; a aba atual não é mais substituída.
- Arquivos salvos em `Downloads/WhatSave/<Conversa>/`.
- Popup adaptado a celulares e tablets.
- Novos testes automatizados (`npm test`) e teste de navegador (`npm run test:navegador`).
- Removido o arquivo sem uso `inpage/wa-injector.js`.

## Extensão 1.3.9 (2026-09-24)

- Recuperação estrita de legendas (própria mídia, resposta direta e mensagem imediatamente seguinte).
- Linha do tempo canônica antes da numeração; número sequencial no início do nome.
- Opção "Preservar a ordem do chat", formatos de data configuráveis e exportação de links em `.txt`.

## Extensão 1.2.0

- Versão original do autor (Jstarzz).

## Histórico por arquivo

### `manifest.json`

- **1.4.3** (2026-11-16): versão 1.4.3; `background` somente com `service_worker` (fim do aviso do Chrome).
- **1.4.2** (2026-11-13): versão 1.4.2.
- **1.4.1** (2026-11-13): versão 1.4.1.
- **1.4.0** (2026-11-13): descrição em português; versão 1.4.0; campos `author` e `homepage_url`; identificador do Firefox próprio deste repositório (`whatsave@rudagabriel.github.io`); título do botão da barra.
- **1.3.9** (2026-09-24): descrição atualizada para legendas e links; versão 1.3.9.
- **1.2.0**: versão original.

### `package.json`

- **1.4.3** (2026-11-16): versão 1.4.3; comando `npm run firefox`; `test:navegador` executa também o teste de carregamento de mensagens.
- **1.4.2** (2026-11-13): versão 1.4.2.
- **1.4.1** (2026-11-13): versão 1.4.1.
- **1.4.0** (2026-11-13): criado, com os comandos `npm test`, `npm run verificar` e `npm run test:navegador`; sem dependências.

### `background.js`

- **1.4.0** (2026-11-13): textos e comentários em português; nome de arquivo normalizado (sem `..`, sem barras invertidas ou segmentos vazios); registro com o prefixo `[WhatSave]`.
- **1.2.0**: versão original.

### `content.js`

- **1.4.0** (2026-11-13): textos e comentários em português; aceita somente mensagens da própria janela.
- **1.2.0**: versão original.

### `popup.html`

- **1.4.2** (2026-11-13): subtítulo e rótulos das opções resumidos.
- **1.4.1** (2026-11-13): textos de ajuda resumidos, mais claros e diretos.
- **1.4.0** (2026-11-13): interface em português; textos de ajuda revisados e fiéis ao funcionamento atual; datas com limite mínimo; créditos no rodapé.
- **1.3.9** (2026-09-24): opções de legenda, ordem do chat, formato de data e links.
- **1.2.0**: versão original.

### `popup.js`

- **1.4.3** (2026-11-16): "Carregar mais mensagens" aguarda a resposta real da página, informa quantas mensagens vieram e para quando não há mais histórico.
- **1.4.2** (2026-11-13): mensagens do registro de atividade resumidas; `APP_VERSION` 1.4.2.
- **1.4.1** (2026-11-13): `APP_VERSION` atualizada para 1.4.1.
- **1.4.0** (2026-11-13): mensagens em português; WhatsApp Web aberto em nova aba; proteção contra resposta vazia de `executeScript`; validação do período; botão "Carregar mais mensagens" sempre restaurado; preferência inválida volta ao padrão; ajuste para celulares e tablets.
- **1.3.9** (2026-09-24): novas preferências e pré-visualização do nome do arquivo.
- **1.2.0**: versão original.

### `popup.css`

- **1.4.0** (2026-11-13): comentários em português; rodapé em coluna; ajuste para celulares e tablets.
- **1.3.9** (2026-09-24): estilos das novas opções.
- **1.2.0**: versão original.

### `inpage/app.js`

- **1.4.3** (2026-11-16): `loadMoreMessages` reescrito (função interna do WhatsApp, rolagem somente de `#main`, botão do celular reconhecido pelo texto); removidas `findScrollContainer` e `findLoadEarlierButton`.
- **1.4.2** (2026-11-13): mensagens do registro de atividade resumidas; `APP_VERSION` 1.4.2.
- **1.4.1** (2026-11-13): `APP_VERSION` atualizada para 1.4.1.
- **1.4.0** (2026-11-13): textos e comentários em português; função `processarEmOrdem` (busca paralela, salvamento em ordem e memória limitada); ZIP em partes, montado como Blob sem cópias extras; arquivos acima de 40 MB salvos pela página; índice único de respostas; varreduras do DOM limitadas a uma por segundo; leitura de links em listas; nomes seguros para emoji e para o Windows; datas inválidas ignoradas e período invertido corrigido; trava de rolagem sempre liberada; mensagens aceitas somente da própria janela; pasta de destino `WhatSave`; funções internas expostas apenas no modo de teste.
- **1.3.9** (2026-09-24): recuperação estrita de legendas, ordem canônica do chat, formatos de data, exportação de links e ZIP com nomes em UTF-8.
- **1.2.0**: versão original.

### `testes/ambiente.js`

- **1.4.0** (2026-11-13): criado; carrega o `inpage/app.js` em contexto isolado do Node.

### `testes/fabrica.js`

- **1.4.0** (2026-11-13): criado; fábrica de mensagens simuladas.

### `testes/executar.mjs`

- **1.4.0** (2026-11-13): criado; executor portátil dos testes.

### `testes/verificar-sintaxe.mjs`

- **1.4.0** (2026-11-13): criado; verificação de sintaxe dos scripts.

### `testes/datas.test.js`

- **1.4.0** (2026-11-13): criado; 4 testes do filtro de período.

### `testes/legendas.test.js`

- **1.4.0** (2026-11-13): criado; 13 testes da recuperação de legendas.

### `testes/links.test.js`

- **1.4.0** (2026-11-13): criado; 8 testes da extração de links.

### `testes/nomes.test.js`

- **1.4.0** (2026-11-13): criado; 11 testes dos nomes de arquivo.

### `testes/ordem.test.js`

- **1.4.0** (2026-11-13): criado; 6 testes de ordenação e processamento em ordem.

### `testes/projeto.test.js`

- **1.4.3** (2026-11-16): 2 testes novos (manifesto sem `background.scripts` e geração do pacote do Firefox); total de 9.
- **1.4.0** (2026-11-13): criado; 7 testes de consistência de versões, cabeçalhos, CHANGELOG e README.

### `testes/zip.test.js`

- **1.4.0** (2026-11-13): criado; 4 testes do gerador de ZIP.

### `testes/navegador/popup.mjs`

- **1.4.2** (2026-11-13): verificação da nova mensagem de período inválido.
- **1.4.0** (2026-11-13): criado; valida o popup no Chromium, no computador e no celular.

### `testes/carregar-mais.test.js`

- **1.4.3** (2026-11-16): criado; 5 testes do reconhecimento do botão de mensagens antigas e da medição.

### `testes/navegador/carregar-mais.mjs`

- **1.4.3** (2026-11-16): criado; valida as três estratégias de "Carregar mais mensagens" em uma página que simula o WhatsApp Web.

### `ferramentas/gerar-firefox.mjs`

- **1.4.3** (2026-11-16): criado; gera o pacote do Firefox em `dist/firefox`.
