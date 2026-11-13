# WhatSave

![Versão](https://img.shields.io/badge/vers%C3%A3o-1.4.1-e8a33d)
![Testes](https://img.shields.io/badge/testes-53%20aprovados-2ea043)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4)
![Chrome](https://img.shields.io/badge/Chrome-compat%C3%ADvel-4285F4?logo=googlechrome&logoColor=white)
![Edge](https://img.shields.io/badge/Edge-compat%C3%ADvel-0078D7?logo=microsoftedge&logoColor=white)
![Firefox](https://img.shields.io/badge/Firefox-128%2B-FF7139?logo=firefoxbrowser&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-18%2B%20(testes)-339933?logo=nodedotjs&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-teste%20de%20navegador-2EAD33?logo=playwright&logoColor=white)
![wa-js](https://img.shields.io/badge/wa--js-4.4.3-25D366?logo=whatsapp&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

Extensão de navegador gratuita e de código aberto que exporta, de uma só vez,
as **imagens, vídeos, áudios, documentos, legendas e links** de uma ou mais
conversas do WhatsApp Web — sempre na **ordem cronológica da conversa**, em
arquivos soltos ou em ZIP.

Tudo acontece no seu próprio computador: nada é enviado para servidores.

## Créditos

- **Autor original:** [Jstarzz](https://github.com/Jstarzz) — criador do WhatSave.
- **Edição, análise e manutenção desta versão:** Ruda Gabriel.

## Recursos

- **Sem limites e sem chave de licença:** todos os recursos liberados.
- **Várias conversas de uma vez:** selecione quantas quiser; elas são processadas em sequência.
- **Ordem do chat garantida:** os arquivos são numerados (0001, 0002…) da mensagem mais antiga para a mais recente.
- **Qualidade original:** cada mídia é buscada novamente no WhatsApp, e não copiada de uma prévia em baixa resolução.
- **Legendas reais:** a legenda pode vir da própria mídia, de uma resposta direta à mídia ou da mensagem imediatamente seguinte — nunca de mensagens sem relação.
- **Links:** cada mensagem com endereço da internet vira um arquivo `.txt`.
- **ZIP inteligente:** conversas grandes são divididas automaticamente em partes, sem esgotar a memória.
- **Downloads paralelos:** 2, 4, 6 ou 8 arquivos por vez.
- **Funciona no computador e no celular** (navegadores que aceitam extensões).

## Instalação

A extensão é instalada no modo de desenvolvedor, a partir desta pasta.

**Chrome ou Edge**

1. Baixe este repositório (botão **Code → Download ZIP**) e extraia a pasta.
2. Abra `chrome://extensions` (no Edge, `edge://extensions`).
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta extraída.

**Firefox (128 ou superior)**

1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em **Carregar extensão temporária** e selecione o arquivo `manifest.json`.

## Uso no dia a dia

1. Abra o [WhatsApp Web](https://web.whatsapp.com) e entre na sua conta.
   Se ele não estiver aberto, a extensão abre o WhatsApp Web em uma nova aba;
   basta reabrir a extensão quando a página terminar de carregar.
2. Clique no ícone do **WhatSave**.
3. Em **Conversas**, selecione uma ou mais conversas (segure Ctrl ou Shift para várias).
   Se a lista estiver vazia, clique em **Atualizar lista**.
4. Escolha os **Tipos de item** (imagens, vídeos, áudios, documentos e links).
5. Se quiser, defina um **Período** (De/Até). Com os dois campos vazios, todas as datas entram.
6. Ajuste as **Opções** (veja abaixo) e clique em **Exportar itens selecionados**.
7. Acompanhe o andamento em **Atividade**.

Para exportar mensagens antigas de uma conversa, selecione somente ela e use
**Carregar mais mensagens** antes de exportar.

### Opções

| Opção | O que faz |
|---|---|
| Salvar em um único ZIP por conversa | Junta tudo em um arquivo ZIP. Conversas grandes viram `_parte01`, `_parte02`… |
| Preservar a ordem do chat | Salva um arquivo por vez, do mais antigo para o mais recente. |
| Manter o nome original do arquivo | Acrescenta o nome original (por exemplo, de um PDF) ao nome final. |
| Incluir data e hora no nome | Acrescenta a data da mensagem no formato escolhido. |
| Incluir o remetente no nome | Acrescenta quem enviou (por exemplo, `VENDEDOR A`). |
| Incluir a legenda no nome da mídia | Acrescenta a legenda recuperada ao nome. |
| Usar resposta direta como legenda | Usa como legenda a resposta de texto que cita exatamente aquela mídia. |
| Usar a mensagem seguinte como legenda | Usa somente a mensagem imediatamente seguinte: texto simples, mesmo remetente e até 15 segundos depois. |
| Análise profunda | Lê mais mensagens antigas (mais lento). |
| Downloads simultâneos | Quantos arquivos são buscados ao mesmo tempo. |

### Como os arquivos são nomeados

```
0001_<Conversa>[_<Remetente>][_<Data>][_<Legenda>][_<Nome original>].<extensão>
```

Exemplo: `0001_Celular do Caixa 1_2026-09-23_15-30-45_Pedido 12.jpg`

O número sequencial fica sempre no início, para que o Explorador do Windows
mostre os arquivos na ordem da conversa. Caracteres proibidos no Windows são
trocados por `_`, e nomes reservados (como `CON`) são evitados.

Formatos de data disponíveis: `AAAA-MM-DD_HH-mm-ss`, `AAAA-MM-DD`,
`DD-MM-AAAA_HH-mm-ss`, `DD-MM-AAAA`, `AAAAMMDD_HHmmss`, `AAAAMMDD` e
`AAMMDD_HHmmss`.

### Onde os arquivos ficam

- **Arquivos soltos:** `Downloads/WhatSave/<Conversa>/`.
- **ZIP:** na raiz da pasta `Downloads`, com o nome `<Conversa>_WhatSave.zip`
  (ou `<Conversa>_WhatSave_parte01.zip`, `_parte02`… quando dividido).
- **Arquivos acima de 40 MB:** na raiz da pasta `Downloads`, com o nome da
  conversa no início. Isso acontece porque a comunicação interna da extensão
  aceita no máximo 64 MB por mensagem.

### Como as legendas são escolhidas

Uma mídia só recebe legenda de uma destas fontes, nesta ordem:

1. **Legenda própria** — o texto escrito junto com a mídia.
2. **Resposta direta** — uma mensagem de texto que cita exatamente aquela mídia.
3. **Mensagem imediatamente seguinte** — somente a próxima mensagem, se for
   texto simples, do mesmo remetente e enviada em até 15 segundos.

Se nenhuma condição for comprovada, a mídia fica sem legenda. Em documentos, o
nome do arquivo nunca é tratado como legenda.

### Links

Ao marcar **Links**, cada mensagem que contém um endereço da internet vira um
arquivo `.txt` (UTF-8) com todos os endereços encontrados. O primeiro endereço
também aparece no nome do arquivo. Somente links da conversa selecionada e do
período escolhido são exportados. Uma mídia cuja legenda contém um link
continua sendo exportada como mídia.

## Tecnologias e bibliotecas

| Tecnologia | Uso |
|---|---|
| JavaScript (ES2022) | Todo o código da extensão, sem etapa de compilação. |
| WebExtensions — Manifest V3 | Estrutura da extensão para Chrome, Edge e Firefox. |
| `chrome.downloads` | Salvamento dos arquivos na pasta Downloads. |
| `chrome.scripting` | Injeção dos scripts na página do WhatsApp Web. |
| wa-js 4.4.3 (`inpage/vendor/wppconnect-wa-wrapped.js`) | Leitura das conversas e mensagens já carregadas no WhatsApp Web. Distribuída sem alterações, sob a sua própria licença (Apache-2.0), cujo aviso de direitos autorais deve ser mantido. |
| Gerador de ZIP próprio | ZIP sem compressão (STORE), com nomes em UTF-8 e CRC32. |
| Node.js 18+ — `node:test` | Testes automatizados, sem dependências externas. |
| Playwright (opcional) | Teste do popup em navegador real, no computador e no celular. |

## Estrutura dos arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Configuração da extensão (permissões, scripts, ícones). |
| `background.js` | Service worker: único ponto que chama `chrome.downloads.download()`. |
| `content.js` | Ponte entre a página do WhatsApp Web e a extensão. |
| `inpage/app.js` | Lógica principal: lista conversas, lê mensagens, recupera legendas, baixa e salva. |
| `inpage/vendor/wppconnect-wa-wrapped.js` | Biblioteca wa-js (terceiros, sem alterações). |
| `popup.html`, `popup.js`, `popup.css` | Janela da extensão. |
| `assets/`, `icons/` | Logotipo e ícones. |
| `testes/` | Testes automatizados e teste de navegador. |
| `CHANGELOG.md` | Histórico completo das versões de cada arquivo. |
| `PRIVACY.md` | Política de privacidade. |

## Comandos internos (popup → página)

A extensão não tem servidor nem API externa. O popup conversa com a página por
mensagens internas (`popup:cmd`):

| Comando | Dados enviados | Resposta |
|---|---|---|
| `listChats` | — | Lista de conversas (`id`, `name`). |
| `getStats` | `selectedChatId` | Período e quantidade de mídias e links carregados. |
| `loadMore` | `selectedChatId` | Pede ao WhatsApp Web mensagens mais antigas. |
| `download` | `chatIds`, `types`, `dateFrom`, `dateTo`, `naming`, `pack` | Quantidade de itens exportados. |

## Desenvolvimento e testes

Requisitos: [Node.js](https://nodejs.org) 18 ou superior. Não há dependências a instalar.

```bash
npm test
```

Verifica a sintaxe dos scripts e executa os 53 testes automatizados (legendas,
links, nomes de arquivo, datas, ordem, ZIP e consistência do projeto).

```bash
npm install --no-save playwright && npx playwright install chromium
```

```bash
npm run test:navegador
```

Abre o popup no Chromium, no tamanho de computador e de celular, e confere
textos, validações e ausência de rolagem horizontal.

## Solução de problemas

| Situação | O que fazer |
|---|---|
| A lista de conversas não aparece | Aguarde o WhatsApp Web carregar por completo e clique em **Atualizar lista**. |
| "Não foi possível comunicar com a página" | Recarregue a aba do WhatsApp Web (F5) e reabra a extensão. |
| "A aba está com uma versão anterior da extensão" | A extensão recarrega o WhatsApp Web automaticamente; aguarde e reabra. |
| Faltam mídias antigas | Selecione a conversa, use **Carregar mais mensagens** e exporte novamente. Mídias muito antigas podem já ter sido removidas dos servidores do WhatsApp. |
| Uma mídia foi "ignorada" | A mídia não está disponível por completo no WhatsApp (por exemplo, expirou). Abra-a no WhatsApp Web e tente novamente. |
| O navegador pergunta se o site pode baixar vários arquivos | Ocorre com arquivos acima de 40 MB ou com ZIP em várias partes, salvos pela própria página. Clique em **Permitir**. |
| "A data De é posterior à data Até" | Corrija o período: a data inicial deve ser anterior ou igual à final. |
| Exportação lenta | Reduza ou aumente **Downloads simultâneos** conforme a conexão; vídeos grandes levam mais tempo. |

## Limitações

- A extensão só acessa conversas que você já vê no seu próprio WhatsApp Web.
- O WhatsApp Web mantém localmente cerca de um ano de histórico; mensagens mais antigas precisam ser carregadas antes.
- A qualidade é a mesma do arquivo original enviado ao WhatsApp; não existe uma cópia "HD" separada.

## Privacidade

Consulte [PRIVACY.md](PRIVACY.md). Em resumo: nenhum dado é coletado, enviado
ou vendido.

## Licença

Código sob a licença MIT (veja [LICENSE](LICENSE)). A biblioteca wa-js em
`inpage/vendor` segue a sua própria licença.
