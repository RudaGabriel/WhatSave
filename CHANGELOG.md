# Histórico de versões — WhatSave

Todas as mudanças relevantes do projeto ficam registradas aqui. A entrada mais
recente fica sempre no topo de cada seção. O cabeçalho de cada arquivo traz
somente a entrada da versão atual.

Autor original: Jstarzz. Edição, análise e manutenção: Ruda Gabriel.

## Versões atuais dos arquivos

| Arquivo | Versão | Data |
|---|---|---|
| `manifest.json` | 1.4.0 | 2026-11-13 |
| `package.json` | 1.4.0 | 2026-11-13 |
| `background.js` | 1.4.0 | 2026-11-13 |
| `content.js` | 1.4.0 | 2026-11-13 |
| `popup.html` | 1.4.0 | 2026-11-13 |
| `popup.js` | 1.4.0 | 2026-11-13 |
| `popup.css` | 1.4.0 | 2026-11-13 |
| `inpage/app.js` | 1.4.0 | 2026-11-13 |
| `testes/ambiente.js` | 1.4.0 | 2026-11-13 |
| `testes/fabrica.js` | 1.4.0 | 2026-11-13 |
| `testes/executar.mjs` | 1.4.0 | 2026-11-13 |
| `testes/verificar-sintaxe.mjs` | 1.4.0 | 2026-11-13 |
| `testes/datas.test.js` | 1.4.0 | 2026-11-13 |
| `testes/legendas.test.js` | 1.4.0 | 2026-11-13 |
| `testes/links.test.js` | 1.4.0 | 2026-11-13 |
| `testes/nomes.test.js` | 1.4.0 | 2026-11-13 |
| `testes/ordem.test.js` | 1.4.0 | 2026-11-13 |
| `testes/projeto.test.js` | 1.4.0 | 2026-11-13 |
| `testes/zip.test.js` | 1.4.0 | 2026-11-13 |
| `testes/navegador/popup.mjs` | 1.4.0 | 2026-11-13 |

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

- **1.4.0** (2026-11-13): descrição em português; versão 1.4.0; campos `author` e `homepage_url`; identificador do Firefox próprio deste repositório (`whatsave@rudagabriel.github.io`); título do botão da barra.
- **1.3.9** (2026-09-24): descrição atualizada para legendas e links; versão 1.3.9.
- **1.2.0**: versão original.

### `package.json`

- **1.4.0** (2026-11-13): criado, com os comandos `npm test`, `npm run verificar` e `npm run test:navegador`; sem dependências.

### `background.js`

- **1.4.0** (2026-11-13): textos e comentários em português; nome de arquivo normalizado (sem `..`, sem barras invertidas ou segmentos vazios); registro com o prefixo `[WhatSave]`.
- **1.2.0**: versão original.

### `content.js`

- **1.4.0** (2026-11-13): textos e comentários em português; aceita somente mensagens da própria janela.
- **1.2.0**: versão original.

### `popup.html`

- **1.4.0** (2026-11-13): interface em português; textos de ajuda revisados e fiéis ao funcionamento atual; datas com limite mínimo; créditos no rodapé.
- **1.3.9** (2026-09-24): opções de legenda, ordem do chat, formato de data e links.
- **1.2.0**: versão original.

### `popup.js`

- **1.4.0** (2026-11-13): mensagens em português; WhatsApp Web aberto em nova aba; proteção contra resposta vazia de `executeScript`; validação do período; botão "Carregar mais mensagens" sempre restaurado; preferência inválida volta ao padrão; ajuste para celulares e tablets.
- **1.3.9** (2026-09-24): novas preferências e pré-visualização do nome do arquivo.
- **1.2.0**: versão original.

### `popup.css`

- **1.4.0** (2026-11-13): comentários em português; rodapé em coluna; ajuste para celulares e tablets.
- **1.3.9** (2026-09-24): estilos das novas opções.
- **1.2.0**: versão original.

### `inpage/app.js`

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

- **1.4.0** (2026-11-13): criado; 7 testes de consistência de versões, cabeçalhos, CHANGELOG e README.

### `testes/zip.test.js`

- **1.4.0** (2026-11-13): criado; 4 testes do gerador de ZIP.

### `testes/navegador/popup.mjs`

- **1.4.0** (2026-11-13): criado; valida o popup no Chromium, no computador e no celular.
